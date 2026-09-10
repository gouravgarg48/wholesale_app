import { exportSnapshot } from '../db/db-snapshot';
import type { BackupSnapshot } from '../db/db-snapshot';
import {
  getBackupInfo,
  recordBackupFailure,
  recordBackupSuccess,
  shouldAttemptBackup,
} from './backup-state';
import { isDriveConfigured } from './config';
import { uploadBackupToDrive } from './drive';

export type BackupResult = 'not-configured' | 'offline' | 'skipped' | 'uploaded' | 'failed';

/**
 * Dependency injection seam, so scheduler behavior is testable in Node
 * (which has no navigator or real upload path). Every caller in the app uses
 * the defaults; tests override what they need.
 */
export type BackupDeps = {
  now?: () => number;
  isOnline?: () => boolean;
  isConfigured?: () => boolean;
  exportSnap?: () => Promise<BackupSnapshot>;
  upload?: (snapshotJson: string) => Promise<unknown>;
};

function defaultIsOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Runs the backup pipeline if it's due. Returns what actually happened so the
 * UI can react. The ledger (recordBackupSuccess/Failure) is only updated here
 * — the same single-writer discipline as inventory.quantity.
 *
 * `force` skips the "is it due?" gate for an explicit "Back up now" button,
 * but still records attempts normally so a forced failure backs off too.
 */
export async function runBackup(
  deps: BackupDeps = {},
  opts: { force?: boolean } = {},
): Promise<BackupResult> {
  const now = deps.now?.() ?? Date.now();

  if (!opts.force) {
    const info = await getBackupInfo();
    if (!shouldAttemptBackup(info, now)) return 'skipped';
  }

  const isOnline = deps.isOnline ?? defaultIsOnline;
  if (!isOnline()) return 'offline';

  const isConfigured = deps.isConfigured ?? (() => isDriveConfigured());
  if (!isConfigured()) return 'not-configured';

  const exportSnap = deps.exportSnap ?? exportSnapshot;
  const upload = deps.upload ?? uploadBackupToDrive;

  try {
    const snapshot = await exportSnap();
    await upload(JSON.stringify(snapshot));
    await recordBackupSuccess(now);
    return 'uploaded';
  } catch {
    await recordBackupFailure(now);
    return 'failed';
  }
}
