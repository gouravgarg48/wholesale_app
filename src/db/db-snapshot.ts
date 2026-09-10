import { getDB } from './schema';
import { monotonicNow } from './clock';

export const SNAPSHOT_FORMAT = 'wholesale-app-snapshot';
export const SNAPSHOT_VERSION = 1;

/**
 * A full serializable image of every object store in the database. Stored
 * values are plain JSON-able objects, so the snapshot can be written to a
 * file, uploaded to Drive, or pasted into a restore UI.
 */
export type BackupSnapshot = {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  exportedAt: number;
  stores: Partial<Record<StoreName, unknown[]>>;
};

// Deterministic store order so serialized snapshots are stable across runs.
const STORES = [
  'retailers',
  'inventory',
  'sales',
  'restock',
  'returns',
  'payments',
  'invoices',
  'counters',
  'backup',
] as const;

// Exact literal union of every store — same set idb's transaction() expects,
// so we can span them all in one transaction without type gymnastics.
export type StoreName = (typeof STORES)[number];

// Key path per store is part of the schema contract; 'invoices' is keyed by
// saleId, everything else by id. Used to sanity-check each record on restore.
function keyPathForStore(store: StoreName): string {
  return store === 'invoices' ? 'saleId' : 'id';
}

export async function exportSnapshot(): Promise<BackupSnapshot> {
  const db = await getDB();
  const stores: BackupSnapshot['stores'] = {};

  for (const name of STORES) {
    stores[name] = (await db.getAll(name)) as unknown[];
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: monotonicNow(),
    stores,
  };
}

/**
 * Validates an unknown value and returns it as a BackupSnapshot, or throws
 * with a message describing the problem. Kept separate from restoreSnapshot
 * so the same checks can back both the restore path and anything that wants
 * to preview a backup file before committing to it.
 */
export function parseSnapshot(raw: unknown): BackupSnapshot {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error("Backup isn't a snapshot: expected an object");
  }

  const candidate = raw as Record<string, unknown>;

  if (candidate.format !== SNAPSHOT_FORMAT) {
    throw new Error('Backup is not a wholesale-app snapshot');
  }
  if (candidate.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Backup version ${String(candidate.version)} doesn't match current version ${SNAPSHOT_VERSION}`,
    );
  }
  if (typeof candidate.exportedAt !== 'number' || !Number.isFinite(candidate.exportedAt)) {
    throw new Error('Backup is missing a valid exportedAt timestamp');
  }
  if (typeof candidate.stores !== 'object' || candidate.stores === null) {
    throw new Error('Backup is missing its stores object');
  }

  const stores = candidate.stores as Record<string, unknown>;

  for (const name of STORES) {
    // Real exports always include every store, and restore replays every
    // store — requiring them all makes restore total (nothing is left
    // half-merged) and distinguishes a genuine snapshot from a made-up one.
    if (!(name in stores)) {
      throw new Error(`Backup is missing store "${name}"`);
    }
  }

  for (const [name, records] of Object.entries(stores)) {
    if (!STORES.includes(name as StoreName)) {
      throw new Error(`Backup contains unknown store "${name}"`);
    }
    if (!Array.isArray(records)) {
      throw new Error(`Backup store "${name}" isn't an array of records`);
    }

    const keyField = keyPathForStore(name as StoreName);
    for (const record of records) {
      if (typeof record !== 'object' || record === null || Array.isArray(record)) {
        throw new Error(`Backup store "${name}" contains a non-record value`);
      }
      if (!(keyField in (record as Record<string, unknown>))) {
        throw new Error(`Backup store "${name}" contains a record missing "${keyField}"`);
      }
    }
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: candidate.exportedAt,
    stores: stores as BackupSnapshot['stores'],
  };
}

/**
 * Replaces the entire database contents with a validated snapshot. All stores
 * are cleared and rewritten inside a single transaction, so a failure partway
 * through unwinds the whole restore — the database is never left half-old /
 * half-new. Note this also replaces the 'backup' store (which carries the
 * Google token), so restoring a backup restores the auth that produced it.
 */
export async function restoreSnapshot(raw: unknown): Promise<void> {
  const snapshot = parseSnapshot(raw);
  const db = await getDB();

  const tx = db.transaction([...STORES], 'readwrite');
  try {
    for (const name of STORES) {
      const records = snapshot.stores[name];
      const store = tx.objectStore(name);
      await store.clear();
      if (records) {
        for (const record of records) {
          // idb types `put` per-store; across stores this is inherently a
          // runtime-typed write, and parseSnapshot already validated shape.
          await store.put(record as never);
        }
      }
    }
    await tx.done;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // already finished/aborted — safe to ignore
    }
    tx.done.catch(() => {});
    throw err;
  }
}
