import { getDB } from '../db/schema';
import { GOOGLE_DRIVE_CONFIG, getRedirectUri } from './config';
import { generateId } from '../db/id';
import { monotonicNow } from '../db/clock';

const TOKEN_KEY = 'google-token';
const PKCE_KEY = 'google-pkce';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
// Uploads must go to the dedicated upload host — the /drive/v3/files endpoint
// has no multipart handling and returns a JSON parse error on the boundary.
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';

export type GoogleToken = {
  accessToken: string;
  refreshToken: string;
  expiryAt: number; // epoch ms — access tokens are short-lived (~1h)
};

export type DriveFile = { id: string; name: string; createdTime: string; size?: string };

// ---------------------------------------------------------------- helpers

const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PKCE code verifier, per RFC 7636: 43–128 chars from the unreserved set.
 * Uses crypto.getRandomValues (works even on non-secure http origins, unlike
 * crypto.randomUUID — same reason generateId() has a fallback).
 */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let verifier = '';
  for (const byte of bytes) verifier += VERIFIER_CHARSET[byte % VERIFIER_CHARSET.length];
  return verifier;
}

/**
 * The challenge is SHA-256(verifier), base64url-encoded (no padding). Needs
 * crypto.subtle (secure context) — which OAuth itself also requires, since
 * Google won't redirect to a plain-http origin anyway. Fails loudly.
 */
export async function generatePkceChallenge(verifier: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'PKCE challenge requires a secure context (the app must be served over HTTPS or localhost)',
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Pure URL builder — kept separate from the network calls so it's testable. */
export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope?: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: params.scope ?? GOOGLE_DRIVE_CONFIG.scope,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
    access_type: 'offline', // needed to receive a refresh token
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${query.toString()}`;
}

export function buildDriveMultipart(
  metadata: Record<string, unknown>,
  media: string,
): { boundary: string; body: string } {
  const boundary = `wholesale-app-${Math.random().toString(36).slice(2)}`;
  return {
    boundary,
    body:
      `--${boundary}\r\n` +
      'Content-Type: application/json\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json\r\n\r\n' +
      `${media}\r\n` +
      `--${boundary}--`,
  };
}

// ---------------------------------------------------------------- token store

async function saveGoogleToken(token: GoogleToken): Promise<void> {
  const db = await getDB();
  await db.put('backup', {
    id: TOKEN_KEY,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiryAt: token.expiryAt,
  });
}

export async function getGoogleToken(): Promise<GoogleToken | null> {
  const db = await getDB();
  const record = await db.get('backup', TOKEN_KEY);
  if (!record) return null;
  if (typeof record.accessToken !== 'string' || typeof record.refreshToken !== 'string') {
    return null;
  }
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    expiryAt: Number(record.expiryAt ?? 0),
  };
}

export async function clearGoogleToken(): Promise<void> {
  const db = await getDB();
  await db.delete('backup', TOKEN_KEY);
}

export function isSignedIn(token: GoogleToken | null): boolean {
  return token !== null;
}

// ---------------------------------------------------------------- OAuth flow

type PkceRecord = { verifier: string; state: string };

async function savePkceRecord(record: PkceRecord): Promise<void> {
  const db = await getDB();
  await db.put('backup', { id: PKCE_KEY, ...record });
}

async function getPkceRecord(): Promise<PkceRecord | null> {
  const db = await getDB();
  const record = await db.get('backup', PKCE_KEY);
  if (!record || typeof record.verifier !== 'string') return null;
  return { verifier: record.verifier, state: String(record.state ?? '') };
}

async function clearPkceRecord(): Promise<void> {
  const db = await getDB();
  await db.delete('backup', PKCE_KEY);
}

async function postTokenRequest(body: URLSearchParams): Promise<GoogleToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error('Token exchange returned no access token');
  return {
    accessToken: json.access_token,
    // Refresh tokens are only issued on the first code exchange, so keep any
    // previously-stored one if a later refresh/consent cycle omits it.
    refreshToken: json.refresh_token ?? '',
    expiryAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/**
 * Redirect-based OAuth. Kicks off the flow by storing PKCE state and sending
 * the user to Google; the app's own origin is the redirect target (see
 * handleAuthCallback below). A full-page redirect works in standalone PWAs
 * and avoids popup blockers entirely.
 */
export async function beginGoogleSignIn(): Promise<void> {
  const verifier = generateCodeVerifier();
  const [challenge, state] = await Promise.all([
    generatePkceChallenge(verifier),
    Promise.resolve(generateId()),
  ]);
  await savePkceRecord({ verifier, state });
  const url = buildAuthUrl({
    clientId: GOOGLE_DRIVE_CONFIG.clientId,
    redirectUri: getRedirectUri(),
    codeChallenge: challenge,
    state,
  });
  window.location.href = url;
}

/** Result of re-entering the app from an OAuth redirect. */
export type AuthCallbackResult =
  | 'no-code'
  | 'success'
  | 'error'
  | 'state-mismatch';

/** Human-readable error detail when result is 'error'. */
let lastAuthError = '';
export function getLastAuthError(): string {
  return lastAuthError;
}

/**
 * Called on app load. If the URL carries OAuth code/state, exchanges the
 * code for tokens, cleans the URL, and reports what happened. Safe to call
 * on every ordinary load (it no-ops when there's no code in the URL).
 *
 * PKCE record is only cleared after a successful token exchange so that
 * transient failures (network, redirect_uri mismatch) are retryable.
 */
export async function handleAuthCallback(
  params: URLSearchParams,
): Promise<AuthCallbackResult> {
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  if (error) {
    lastAuthError = `Google returned error: ${error}`;
    return 'error';
  }
  if (!code || !state) return 'no-code';

  const stored = await getPkceRecord();
  if (!stored || stored.state !== state) {
    lastAuthError = 'PKCE state mismatch — possibly a page reload cleared the record.';
    return 'state-mismatch';
  }

  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_DRIVE_CONFIG.clientId,
    client_secret: GOOGLE_DRIVE_CONFIG.clientSecret,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
    code_verifier: stored.verifier,
  });

  try {
    const token = await postTokenRequest(body);
    await saveGoogleToken(token);
    await clearPkceRecord();
    lastAuthError = '';
    return 'success';
  } catch (e) {
    lastAuthError =
      e instanceof Error ? e.message : String(e);
    return 'error';
  }
}

/** Returns a usable access token, refreshing first if near expiry. */
export async function getAccessToken(): Promise<string> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Not signed in to Google Drive');

  if (token.expiryAt - Date.now() > 60_000) return token.accessToken;

  const body = new URLSearchParams({
    client_id: GOOGLE_DRIVE_CONFIG.clientId,
    client_secret: GOOGLE_DRIVE_CONFIG.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
  });
  const refreshed = await postTokenRequest(body);
  const merged: GoogleToken = {
    ...refreshed,
    refreshToken: refreshed.refreshToken || token.refreshToken,
  };
  await saveGoogleToken(merged);
  return merged.accessToken;
}

// ---------------------------------------------------------------- Drive API

async function driveFetch(
  path: string,
  init: RequestInit = {},
  baseUrl: string = DRIVE_FILES_ENDPOINT,
): Promise<Response> {
  const accessToken = await getAccessToken();
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
}

async function ensureDriveError(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API error (${res.status}): ${text.slice(0, 200)}`);
  }
  return res;
}

async function ensureBackupFolder(): Promise<string> {
  const query = new URLSearchParams({
    q:
      "name='" +
      GOOGLE_DRIVE_CONFIG.backupFolderName +
      "' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
    pageSize: '1',
  });
  const res = await driveFetch(`?${query.toString()}`);
  const json = (await (await ensureDriveError(res)).json()) as { files: { id: string }[] };
  if (json.files.length > 0) return json.files[0].id;

  const create = await driveFetch('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: GOOGLE_DRIVE_CONFIG.backupFolderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const created = (await (await ensureDriveError(create)).json()) as { id: string };
  return created.id;
}

function backupFileName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `wholesale-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

/**
 * Uploads a snapshot (already serialized to a JSON string) as a new file in
 * the backup folder. Uses multiply-related multipart so name + parent + media
 * land in one request.
 */
export async function uploadBackupToDrive(snapshotJson: string): Promise<DriveFile> {
  const folderId = await ensureBackupFolder();
  const metadata = { name: backupFileName(monotonicNow()), parents: [folderId] };
  const { boundary, body } = buildDriveMultipart(metadata, snapshotJson);

  const res = await driveFetch(
    '?uploadType=multipart',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
    DRIVE_UPLOAD_ENDPOINT,
  );
  return (await (await ensureDriveError(res)).json()) as DriveFile;
}

export async function listDriveBackups(): Promise<DriveFile[]> {
  const folderId = await ensureBackupFolder();
  const query = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, createdTime, size)',
    orderBy: 'createdTime desc',
    pageSize: '10',
  });
  const res = await driveFetch(`?${query.toString()}`);
  const json = (await (await ensureDriveError(res)).json()) as { files: DriveFile[] };
  return json.files;
}

export async function downloadDriveBackup(fileId: string): Promise<string> {
  const res = await driveFetch(`/${fileId}?alt=media`);
  return (await ensureDriveError(res)).text();
}
