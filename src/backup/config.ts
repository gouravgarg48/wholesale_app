/**
 * Google Drive integration config. Everything here is deliberately a plain
 * constant file rather than a settings screen — this is a v1 single-device
 * app, and the OAuth client ID is a one-time Google Cloud Console setup that
 * belongs in code (like the hardcoded BUSINESS header in the bill view).
 *
 * To enable Drive backups:
 *   1. Google Cloud Console → create a project → enable the Drive API.
 *   2. Create an OAuth client ID (Web application). Set the Authorized
 *      JavaScript origins and Authorized redirect URIs to where the app is
 *      actually served (both need the full base path, trailing slash):
 *        - http://localhost:5173/wholesale_app/ (dev)
 *        - https://gouravgarg48.github.io/wholesale_app/ (deployed)
 *      The redirect URI must match getRedirectUri() below exactly.
 *   3. Paste the client ID below. The scope (drive.file) only ever sees
 *      files this app itself creates — not the user's whole Drive.
 */
export const GOOGLE_DRIVE_CONFIG = {
  clientId: '470885015745-q12nsuoo8s0mencsdm76e1fgjuv3b7cv.apps.googleusercontent.com',
  // Redirect target for the OAuth flow. Defaults to the current origin +
  // "/" but can be pinned here if it ever differs from where the app runs.
  redirectUri: '',
  scope: 'https://www.googleapis.com/auth/drive.file',
  backupFolderName: 'Wholesale App Backups',
} as const;

export function isDriveConfigured(): boolean {
  return GOOGLE_DRIVE_CONFIG.clientId.trim().length > 0;
}

export function getRedirectUri(): string {
  if (GOOGLE_DRIVE_CONFIG.redirectUri) return GOOGLE_DRIVE_CONFIG.redirectUri;
  // Must land exactly where the app is actually served — including Vite's
  // base path. On GitHub Pages that's
  // https://gouravgarg48.github.io/wholesale_app/, not the origin root.
  // BASE_URL always has a trailing slash (e.g. "/wholesale_app/").
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}
