# Wholesale App — Setup Log

Internal PWA for ledger, inventory, and billing management. This file tracks the exact setup steps and commands used, starting from a blank Windows machine, so the environment can be reproduced or debugged later.

## 1. Install Node & npm (Windows)

Windows needs **nvm-windows** (not the Mac/Linux `nvm`) to manage Node versions.

Check if it's already installed:
```powershell
nvm version
```

If not found, install via winget:
```powershell
winget install CoreyButler.NVMforWindows
```

Close and reopen the terminal, then install and switch to the latest LTS Node:
```powershell
nvm install lts
nvm use lts
```

Verify versions:
```powershell
node -v
npm -v
```

### Troubleshooting: `node -v` works but `npm -v` doesn't

This came up during setup and took a few steps to resolve. In order of what to check:

1. **Re-run `nvm use`** — this is what actually wires up the npm symlink:
   ```powershell
   nvm use lts
   ```

2. **Check npm files exist** in the nvm-windows install folder:
   ```powershell
   dir C:\nvm4w\nodejs\npm*
   ```
   Should show `npm`, `npm.cmd`, and `npm.ps1`.

3. **Check for a PATH conflict** — a plain, extensionless `npm` file sits in the same
   folder as `npm.cmd`, and Windows command resolution can grab the extensionless one
   first (meant for Git Bash/WSL, not native PowerShell), then fail to execute it and
   never fall through to `npm.cmd`.
   ```powershell
   where.exe npm
   ```
   If the extensionless `npm` appears before `npm.cmd` in the output, rename it out of
   the way (don't delete, in case Git Bash relies on it):
   ```powershell
   Rename-Item C:\nvm4w\nodejs\npm npm.bak
   ```

4. **The actual root cause in this case**: PowerShell prioritizes `npm.ps1` (a
   PowerShell script) over `npm.cmd`, and by default Windows blocks running local
   unsigned scripts. The fix — allow locally-created scripts to run for the current
   user (still blocks unsigned scripts downloaded from the internet):
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
   Confirm with `Y` when prompted. Then `npm -v` resolves correctly.

Result: `npm -v` → `11.19.0`.

## 2. Scaffold the project (Vite + React + TypeScript)

```powershell
cd C:\Users\<you>\projects
npm create vite@latest wholesale-app -- --template react-ts
```

- Confirm installing `create-vite` when prompted.
- When asked to choose a linter: **ESLint** (not Oxlint) — more mature rule coverage
  and ecosystem compatibility (e.g. `eslint-config-prettier`, added later).

Install dependencies and verify the dev server runs:
```powershell
cd wholesale-app
npm install
npm run dev
```

**Checkpoint:** `http://localhost:5173` shows the default Vite + React starter page
(spinning logo, counter button). ✅ Confirmed working.

## 3. Add PWA tooling

Install the plugin:
```powershell
npm install -D vite-plugin-pwa
```

Update `vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Wholesale Manager',
        short_name: 'Wholesale',
        theme_color: '#1e293b',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
```

Place `pwa-192x192.png` and `pwa-512x512.png` in the `public/` folder (same folder as
`vite.svg`). Placeholder icons (text "SRE RICE" on a dark background) generated for
now — swap for a real logo during the Phase 6 UI pass.

**Checkpoint:** run a production build and preview, then check DevTools →
Application tab for a registered manifest and active service worker:
```powershell
npm run build
npm run preview
```
`npm run dev` alone does not fully activate the service worker — that requires a
production build. ✅ Confirmed: `npm run build` output shows `dist/registerSW.js`
and `dist/manifest.webmanifest`, and DevTools → Application shows both a detected
Manifest and an active Service Worker.

> Note: if `npm run build` doesn't show these two files in its output, the
> `vite.config.ts` edit likely wasn't saved before the build ran — save the file
> and re-run the build.

## 4. Git init and GitHub remote

```powershell
git init
git add -A
git commit -m "Initial scaffold with PWA setup"
```

### Pushing to GitHub — auth note

Password auth over HTTPS is no longer supported by GitHub. Use a Personal Access
Token (PAT) instead:

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens
   (classic) → Generate new token (classic), or go directly to
   `https://github.com/settings/tokens/new`.
2. Check the top-level **repo** scope, set an expiry (90 days is a reasonable
   default), generate, and copy the token immediately — it's shown only once.
3. Connect the remote and push, using the token as the password when prompted
   (not your GitHub account password):
   ```powershell
   git remote add origin https://github.com/gouravgarg48/wholesale_app.git
   git branch -M main
   git push -u origin main
   ```
4. To avoid re-entering the token every push, cache it via Git Credential Manager
   (usually bundled with Git for Windows):
   ```powershell
   git config --global credential.helper manager
   ```

**Reminder:** confirm the GitHub repo is set to **private**, not public — worth
locking down now before real ledger/inventory logic and any business-adjacent
test data end up in commits.

## Next steps

- [x] Confirm PWA checkpoint (manifest + service worker visible in DevTools)
- [x] `git init`, first commit, and remote configured
- [ ] **Pending confirmation:** did `git push -u origin main` succeed after
      setting up the PAT? Re-run it if not yet confirmed working.
- [ ] Add IndexedDB wrapper (`idb`)
- [ ] Set up folder structure (`src/db`, `src/features/ledger`,
      `src/features/inventory`, `src/features/billing`, `src/components`)
- [ ] Configure ESLint + Prettier compatibility (`eslint-config-prettier`)
- [ ] Design IndexedDB schema (retailers, sales, payments, bills, inventory
      events, products) — next major piece of Phase 1