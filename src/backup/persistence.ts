export type PersistenceStatus = { supported: boolean; persisted: boolean };

/**
 * Requests that the browser keep this site's storage even under memory
 * pressure. Browser storage (IndexedDB) is eviction-prone by default; for a
 * single-device ledger app that IS the source of truth, eviction would be
 * catastrophic. Errors are swallowed — persisting is a request, not a
 * guarantee, and the app should still function if it's denied.
 */
export async function ensurePersistentStorage(): Promise<PersistenceStatus> {
  if (!storageApiAvailable()) return { supported: false, persisted: false };
  try {
    const persisted = await navigator.storage.persist();
    return { supported: true, persisted };
  } catch {
    return { supported: true, persisted: false };
  }
}

/**
 * Read-only variant for the UI — reports current status without making (or
 * re-making) the persist request.
 */
export async function getPersistenceStatus(): Promise<PersistenceStatus> {
  if (!storageApiAvailable()) return { supported: false, persisted: false };
  try {
    const persisted = await navigator.storage.persisted();
    return { supported: true, persisted };
  } catch {
    return { supported: true, persisted: false };
  }
}

function storageApiAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.persist === 'function' &&
    typeof navigator.storage.persisted === 'function'
  );
}
