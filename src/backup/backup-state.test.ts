import { describe, it, expect, afterEach } from 'vitest';
import { closeDB } from '../db/schema';
import {
  BACKUP_OVERDUE_MS,
  FRESH_BACKUP_STATE,
  getBackupInfo,
  isBackupOverdue,
  recordBackupFailure,
  recordBackupSuccess,
  shouldAttemptBackup,
} from './backup-state';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

const HOUR = 60 * 60 * 1000;

describe('isBackupOverdue', () => {
  it('is overdue when the backup has never succeeded', () => {
    expect(isBackupOverdue({ ...FRESH_BACKUP_STATE }, 1000)).toBe(true);
  });

  it('is overdue only after 48 hours have passed', () => {
    const state = { lastSuccessAt: 1000, lastAttemptAt: 1000, consecutiveFailures: 0 };
    expect(isBackupOverdue(state, 1000 + BACKUP_OVERDUE_MS)).toBe(false); // exactly at boundary: not yet
    expect(isBackupOverdue(state, 1000 + BACKUP_OVERDUE_MS + 1)).toBe(true); // just past: overdue
    expect(isBackupOverdue(state, 1000 + 47 * HOUR)).toBe(false);
  });
});

describe('shouldAttemptBackup', () => {
  it('attempts when never backed up and never failed', () => {
    expect(shouldAttemptBackup({ ...FRESH_BACKUP_STATE }, 1000)).toBe(true);
  });

  it('skips when a recent backup exists and nothing is overdue', () => {
    const state = { lastSuccessAt: 1000, lastAttemptAt: 1000, consecutiveFailures: 0 };
    expect(shouldAttemptBackup(state, 1000 + 2 * HOUR)).toBe(false);
  });

  it('attempts again once an existing backup goes overdue', () => {
    const state = { lastSuccessAt: 1000, lastAttemptAt: 1000, consecutiveFailures: 0 };
    expect(shouldAttemptBackup(state, 1000 + BACKUP_OVERDUE_MS + 1)).toBe(true);
  });

  it('backs off after a recent failure', () => {
    const failed = { lastSuccessAt: 5000, lastAttemptAt: 1000, consecutiveFailures: 2 };
    expect(shouldAttemptBackup(failed, 1000 + 30 * 60 * 1000)).toBe(false); // 30min < 1h
    expect(shouldAttemptBackup(failed, 1000 + HOUR)).toBe(true); // back off over
  });

  it('honors a custom retry interval', () => {
    const failed = { lastSuccessAt: 5000, lastAttemptAt: 1000, consecutiveFailures: 1 };
    expect(
      shouldAttemptBackup(failed, 1000 + 5 * 60 * 1000, { retryIntervalMs: 60 * 60 * 1000 }),
    ).toBe(false);
    expect(shouldAttemptBackup(failed, 1000 + 5 * 60 * 1000, { retryIntervalMs: 60 * 1000 })).toBe(
      true,
    );
  });
});

describe('backup ledger persistence', () => {
  it('starts fresh with no recorded state', async () => {
    expect(await getBackupInfo()).toEqual(FRESH_BACKUP_STATE);
  });

  it('records a success', async () => {
    const state = await recordBackupSuccess(12345);
    expect(state).toEqual({ lastSuccessAt: 12345, lastAttemptAt: 12345, consecutiveFailures: 0 });
    expect(await getBackupInfo()).toEqual(state);
  });

  it('increments consecutive failures and preserves last success', async () => {
    await recordBackupSuccess(1000);
    await recordBackupFailure(2000);
    await recordBackupFailure(3000);
    const state = await getBackupInfo();
    expect(state.lastSuccessAt).toBe(1000);
    expect(state.consecutiveFailures).toBe(2);
    expect(state.lastAttemptAt).toBe(3000);
  });

  it('a success resets the failure counter', async () => {
    await recordBackupFailure(2000);
    const state = await recordBackupSuccess(4000);
    expect(state.consecutiveFailures).toBe(0);
  });
});
