import { getDB } from '../db/schema';

export const BACKUP_OVERDUE_MS = 48 * 60 * 60 * 1000; // checklist: '48-hour fallback nag'
export const BACKUP_RETRY_INTERVAL_MS = 60 * 60 * 1000; // don't hammer connectivity/Drive on a failing loop

export type BackupInfo = {
  lastSuccessAt: number; // 0 = never succeeded
  lastAttemptAt: number; // 0 = never attempted
  consecutiveFailures: number;
};

const BACKUP_STATE_ID = 'state';

export const FRESH_BACKUP_STATE: BackupInfo = {
  lastSuccessAt: 0,
  lastAttemptAt: 0,
  consecutiveFailures: 0,
};

/**
 * Pure decision: is the stored backup old enough that the user should hear
 * about it? Includes the never-backed-up case — a brand-new app with no
 * success yet must nag immediately, not silently wait 48 hours.
 */
export function isBackupOverdue(state: BackupInfo, now: number): boolean {
  if (state.lastSuccessAt === 0) return true;
  return now - state.lastSuccessAt > BACKUP_OVERDUE_MS;
}

/**
 * Pure decision: should the scheduler attempt a backup right now? Three
 * gates: no point retrying immediately after a failure (backoff via
 * consecutiveFailure gating is handled by retry interval below), no point
 * uploading when nothing is due, and never-attempted states need a first
 * attempt.
 */
export function shouldAttemptBackup(
  state: BackupInfo,
  now: number,
  opts: { retryIntervalMs?: number } = {},
): boolean {
  const retryIntervalMs = opts.retryIntervalMs ?? BACKUP_RETRY_INTERVAL_MS;

  // After a recent failure, back off rather than hammering a failing upload.
  if (state.consecutiveFailures > 0 && state.lastAttemptAt > 0) {
    if (now - state.lastAttemptAt < retryIntervalMs) return false;
    return true;
  }

  // No failures in play: attempt only when overdue (or never attempted).
  return isBackupOverdue(state, now);
}

/**
 * Records a backup attempt (success or failure) and stores it in the
 * 'backup' store. Deliberately two functions rather than one
 * recordBackup(result) — the scheduler calls these explicitly so the state
 * transitions are the only path to changing the ledger (same discipline as
 * inventory.quantity only changing inside transactions).
 */
export async function recordBackupSuccess(now: number = Date.now()): Promise<BackupInfo> {
  return writeBackupState({
    lastSuccessAt: now,
    lastAttemptAt: now,
    consecutiveFailures: 0,
  });
}

export async function recordBackupFailure(now: number = Date.now()): Promise<BackupInfo> {
  const current = await getBackupInfo();
  return writeBackupState({
    ...current,
    lastAttemptAt: now,
    consecutiveFailures: current.consecutiveFailures + 1,
  });
}

async function writeBackupState(partial: BackupInfo): Promise<BackupInfo> {
  const db = await getDB();
  const next: BackupInfo = { ...FRESH_BACKUP_STATE, ...partial };
  await db.put('backup', { id: BACKUP_STATE_ID, ...next });
  return next;
}

export async function getBackupInfo(): Promise<BackupInfo> {
  const db = await getDB();
  const record = await db.get('backup', BACKUP_STATE_ID);
  if (!record) return { ...FRESH_BACKUP_STATE };
  return {
    lastSuccessAt: Number(record.lastSuccessAt ?? 0),
    lastAttemptAt: Number(record.lastAttemptAt ?? 0),
    consecutiveFailures: Number(record.consecutiveFailures ?? 0),
  };
}
