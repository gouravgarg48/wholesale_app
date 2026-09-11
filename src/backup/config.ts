/**
 * Google Drive integration config. Everything here is deliberately a plain
 * constant file rather than a settings screen — this is a v1 single-device
 * app, and the OAuth client ID is a one-time Google Cloud Console setup that
 * belongs in code (like the hardcoded BUSINESS header in the bill view).
 *
 * To enable Drive backups:
 *   1. Google Cloud Console → create a project → enable the Drive API.
 *   2. Create an OAuth client ID of type "Desktop application" (NOT "Web
 *      application" — a web client forces Google to require a differently
 *      issued secret, and confuses redirect handling for a client-side app).
 *      Desktop clients need no authorized redirect URIs; localhost and the
 *      deployed origin both work.
 *   3. Paste the client ID and its client secret below. Although Google's
 *      docs call the secret "optional" for Desktop clients, the token
 *      endpoint in practice rejects a code exchange without it. It is shipped
 *      in the bundle, which Google explicitly treats as acceptable for
 *      installed apps ("obviously not treated as a secret"). The scope
 *      (drive.file) only ever sees files this app itself creates.
 */
export const GOOGLE_DRIVE_CONFIG = {
  clientId: '470885015745-0fgb9ltcgs18bdv74q6bqafd3cu52ua9.apps.googleusercontent.com',
  // From the same Desktop application client's details page in Google Cloud
  // Console. Never leave this empty — the token exchange fails without it
  // even though the docs describe it as optional.
  clientSecret: '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',
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
