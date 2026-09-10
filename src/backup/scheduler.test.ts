import { describe, it, expect, afterEach } from 'vitest';
import { closeDB } from '../db/schema';
import { recordBackupSuccess, getBackupInfo } from './backup-state';
import { runBackup } from './scheduler';
import type { BackupDeps } from './scheduler';
import { SNAPSHOT_FORMAT, SNAPSHOT_VERSION } from '../db/db-snapshot';

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

function makeDeps(overrides: Partial<BackupDeps> = {}): BackupDeps {
  return {
    now: () => 1000,
    isOnline: () => true,
    isConfigured: () => true,
    upload: async () => {
      /* ok */
    },
    ...overrides,
  };
}

// A realistic snapshot for the fake exportSnap to return.
function fakeSnapshot() {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: 1000,
    stores: {},
  };
}

describe('runBackup', () => {
  it("doesn't upload when nothing is due — reports 'skipped'", async () => {
    await recordBackupSuccess(1000);
    let uploaded = false;
    const result = await runBackup(
      makeDeps({
        now: () => 1000 + 2 * HOUR, // only 2h after a success → not overdue
        upload: async () => {
          uploaded = true;
        },
      }),
    );
    expect(result).toBe('skipped');
    expect(uploaded).toBe(false);
  });

  it("reports 'offline' and doesn't attempt an upload", async () => {
    let uploaded = false;
    const result = await runBackup(
      makeDeps({
        isOnline: () => false,
        upload: async () => {
          uploaded = true;
        },
      }),
    );
    expect(result).toBe('offline');
    expect(uploaded).toBe(false);
  });

  it("reports 'not-configured' when Drive isn't set up", async () => {
    const result = await runBackup(makeDeps({ isConfigured: () => false }));
    expect(result).toBe('not-configured');
  });

  it('uploads the serialized snapshot and records a success', async () => {
    let uploadedJson = '';
    const result = await runBackup(
      makeDeps({
        exportSnap: async () => fakeSnapshot() as never,
        upload: async (json: string) => {
          uploadedJson = json;
        },
      }),
    );

    expect(result).toBe('uploaded');
    expect(JSON.parse(uploadedJson).format).toBe(SNAPSHOT_FORMAT);
    const state = await getBackupInfo();
    expect(state.lastSuccessAt).toBe(1000);
    expect(state.consecutiveFailures).toBe(0);
  });

  it('records a failure with backoff when the upload throws, then retries after the interval', async () => {
    const failingDeps = makeDeps({ upload: async () => throwError() });
    expect(await runBackup(failingDeps)).toBe('failed');

    let state = await getBackupInfo();
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastSuccessAt).toBe(0);

    // Immediately retrying should back off.
    expect(await runBackup(failingDeps)).toBe('skipped');

    // After the 1h retry interval, it tries again (and fails again).
    const later = makeDeps({ now: () => 1000 + HOUR, upload: async () => throwError() });
    expect(await runBackup(later)).toBe('failed');
    state = await getBackupInfo();
    expect(state.consecutiveFailures).toBe(2);
  });

  it('a forced run bypasses the "due" gate but still respects the ledger', async () => {
    await recordBackupSuccess(1000);
    const result = await runBackup(makeDeps({ now: () => 1000 + 1 * HOUR }), { force: true });
    expect(result).toBe('uploaded');
    expect((await getBackupInfo()).lastSuccessAt).toBe(1000 + 1 * HOUR);
  });

  it('a forced failing run still backs off for the next scheduled attempt', async () => {
    await recordBackupSuccess(1000);
    const deps = makeDeps({ now: () => 1000 + 1 * HOUR, upload: async () => throwError() });
    expect(await runBackup(deps, { force: true })).toBe('failed');
    expect((await getBackupInfo()).consecutiveFailures).toBe(1);
  });
});

function throwError(): never {
  throw new Error('upload boom');
}
