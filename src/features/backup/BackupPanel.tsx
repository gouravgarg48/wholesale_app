import { useCallback, useEffect, useState } from 'react';
import { exportSnapshot, restoreSnapshot } from '../../db/db-snapshot';
import { getBackupInfo, isBackupOverdue, type BackupInfo } from '../../backup/backup-state';
import { runBackup } from '../../backup/scheduler';
import type { BackupResult } from '../../backup/scheduler';
import { isDriveConfigured } from '../../backup/config';
import { beginGoogleSignIn, getGoogleToken, handleAuthCallback } from '../../backup/drive';
import { getPersistenceStatus, type PersistenceStatus } from '../../backup/persistence';

const REFRESH_MS = 60 * 1000;
const BACKUP_ATTEMPT_MS = 30 * 60 * 1000;

const STATUS_TEXT: Record<BackupResult, string> = {
  uploaded: 'Backup uploaded to Google Drive.',
  failed: 'Backup failed — will retry automatically.',
  offline: 'You appear to be offline — backup skipped.',
  'not-configured': "Google Drive backup isn't set up yet.",
  skipped: 'Nothing due right now.',
};

const buttonClass =
  'px-4 py-2 bg-[#2b2620] text-[#faf7f2] border-none text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

export function BackupPanel() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [configured] = useState(() => isDriveConfigured());
  const [overdue, setOverdue] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [state, persistence, token] = await Promise.all([
      getBackupInfo(),
      getPersistenceStatus(),
      getGoogleToken(),
    ]);
    setInfo(state);
    setPersistence(persistence);
    setSignedIn(token !== null);
    setOverdue(isBackupOverdue(state, Date.now()));
  }, []);

  // Refresh status on load and every minute.
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  // Background sync: attempt a backup shortly after load, then every 30 min.
  useEffect(() => {
    const attempt = () => {
      runBackup().then((result) => {
        if (result !== 'skipped') setMessage(STATUS_TEXT[result]);
        void refresh();
      });
    };
    const first = setTimeout(attempt, 1000);
    const id = setInterval(attempt, BACKUP_ATTEMPT_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  // Handle an OAuth redirect back into the app (code + state in the URL).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    handleAuthCallback(params).then((result) => {
      if (result === 'success') {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);
        setSignedIn(true);
        setMessage('Connected to Google Drive.');
      } else if (result === 'error' || result === 'state-mismatch') {
        setMessage("Google sign-in didn't complete. Please try again.");
      }
    });
  }, []);

  async function handleBackupNow() {
    setBusy(true);
    setMessage(null);
    const result = await runBackup({}, { force: true });
    setMessage(STATUS_TEXT[result]);
    await refresh();
    setBusy(false);
  }

  async function handleDownload() {
    setBusy(true);
    try {
      const snapshot = await exportSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wholesale-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    if (!window.confirm('Replace all current data with this backup file? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    try {
      await restoreSnapshot(JSON.parse(text));
      window.location.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Restore failed.');
      setBusy(false);
    }
  }

  const persistenceNote =
    persistence === null
      ? ''
      : persistence.persisted
        ? 'This browser has agreed to keep your data even on low disk space.'
        : persistence.supported
          ? "The browser didn't guarantee persistence — your data could be evicted under memory pressure."
          : "Persistent storage isn't available in this browser.";

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 font-sans text-[#2b2620]">
      <h1 className="font-serif text-2xl font-semibold mb-3">Backup</h1>

      <div
        className={`bg-[#faf7f2] border border-[#e4dccb] p-4 mb-4 ${overdue ? 'border-l-4 border-l-[#b54b3a]' : ''}`}
      >
        <div className="flex justify-between items-baseline mb-2">
          <span className="font-serif text-lg">Google Drive backup</span>
          {signedIn ? (
            <span className="text-sm text-[#3f5d43] font-semibold">Signed in</span>
          ) : (
            <span className="text-sm text-[#6b6555]">
              {configured ? 'Not signed in' : 'Not configured'}
            </span>
          )}
        </div>

        <p className="text-sm text-[#6b6555] mb-3">
          {info?.lastSuccessAt
            ? `Last successful backup: ${new Date(info.lastSuccessAt).toLocaleString()}`
            : 'No backup has succeeded yet.'}
        </p>

        {overdue && (
          <p className="text-[#b54b3a] font-semibold text-sm mb-3">
            No successful backup in the last 48 hours — back up now so your ledger isn't at risk.
          </p>
        )}

        {configured && !signedIn && (
          <button type="button" onClick={() => void beginGoogleSignIn()} className={buttonClass}>
            Sign in to Google Drive
          </button>
        )}
        {configured && signedIn && (
          <button
            type="button"
            onClick={() => void handleBackupNow()}
            disabled={busy}
            className={buttonClass}
          >
            {busy ? 'Backing up…' : 'Back up now'}
          </button>
        )}
        {!configured && (
          <p className="text-xs text-[#6b6555]">
            Drive uploads are off until a Google client ID is added in src/backup/config.ts (see
            DEVLOG §22). Manual backup below works regardless.
          </p>
        )}
      </div>

      <div className="bg-[#faf7f2] border border-[#e4dccb] p-4 mb-4">
        <div className="flex justify-between items-baseline mb-2">
          <span className="font-serif text-lg">Storage protection</span>
          {persistence?.persisted ? (
            <span className="text-sm text-[#3f5d43] font-semibold">Persistent</span>
          ) : (
            <span className="text-sm text-[#6b6555]">
              {persistence?.supported ? 'Not persistent' : 'Unavailable'}
            </span>
          )}
        </div>
        <p className="text-sm text-[#6b6555]">{persistenceNote}</p>
      </div>

      <div className="bg-[#faf7f2] border border-[#e4dccb] p-4">
        <span className="font-serif text-lg">Manual backup</span>
        <p className="text-sm text-[#6b6555] mb-3">
          Works without any Google setup — save a copy of your data, or restore a saved copy.
          Restoring replaces everything on this device.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={busy}
            className={buttonClass}
          >
            Download backup file
          </button>
          <label className={`${buttonClass} inline-block`}>
            Restore from file
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleRestoreFile(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      {message && (
        <p className="mt-4 text-sm text-[#2b2620] bg-[#f4f0e6] border border-[#e4dccb] px-4 py-3">
          {message}
        </p>
      )}
    </div>
  );
}
