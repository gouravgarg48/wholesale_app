/**
 * Google Drive integration config. Everything here is deliberately a plain
 * constant file rather than a settings screen — this is a v1 single-device
 * app, and the OAuth client ID is a one-time Google Cloud Console setup that
 * belongs in code (like the hardcoded BUSINESS header in the bill view).
 *
 * To enable Drive backups:
 *   1. Google Cloud Console → create a project → enable the Drive API.
 *   2. Create an OAuth client ID of type "Web application". (A "Desktop
 *      application" client only accepts localhost/loopback redirects, so it
 *      works in dev but fails on the real hosted origin with a
 *      redirect_uri_mismatch — this app is served from a public HTTPS origin,
 *      which only Web clients can target.)
 *   3. Under Authorized redirect URIs, register BOTH, exactly as written
 *      (scheme, host, port, trailing slash all matter — Google matches the
 *      full string, no prefixes/wildcards):
 *        - http://localhost:5173/wholesale_app/   (dev)
 *        - https://gouravgarg48.github.io/wholesale_app/  (deployed)
 *   4. Paste this Web client's ID and secret below. Although the token
 *      endpoint labels the secret "optional", it rejects a code exchange
 *      without it in practice — and a client-side app must ship it in the
 *      bundle anyway, so there's no way around including it here. The scope
 *      (drive.file) only ever sees files this app itself creates.
 */
export const GOOGLE_DRIVE_CONFIG = {
  // Web application OAuth client (see above). Paste the ID + secret from the
  // client's details page in Google Cloud Console ("GOCSPX-..." secret).
  clientId: '470885015745-q12nsuoo8s0mencsdm76e1fgjuv3b7cv.apps.googleusercontent.com',
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
