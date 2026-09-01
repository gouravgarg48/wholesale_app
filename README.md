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

## 5. IndexedDB schema design

Went through a few iterations before landing here. Key decisions and why, in case
they need revisiting later:

- **No per-retailer price overrides.** Instead, each sale line item snapshots its
  own `salePrice` at time of sale. Simpler and more flexible — pricing is decided
  per bill, not pre-configured per retailer.
- **Cash sales supported without a retailer record** — `saleType: 'CASH'` +
  `buyerName`, vs `saleType: 'RETAIL'` + `retailerId`. Cash sales are implicitly
  paid in full at time of sale and never touch the ledger.
- **No separate `paymentAllocations` join table.** Allocations are stored inline
  on each `Payment` as an array (`{ saleId, amountApplied }[]`). Each `Sale`
  carries `amountPaid` and `paymentStatus` so the aging view (who owes what, since
  when) can be computed directly from sales, without a reverse-lookup table this
  scale doesn't need.
- **No separate inventory event log.** `Inventory.quantity` is a cached running
  total instead. The audit trail requirement is satisfied by `Sale`, `Restock`,
  and `Return` each being their own immutable, timestamped resource — as long as
  every write to `quantity` happens inside the same transaction as creating one of
  those records, never as a standalone edit.
- **Waste/loss tracking deliberately cut from v1 scope** (originally planned as a
  third inventory event type). Can be added back later as its own store, same
  shape as `restock`, without touching anything else — tracking manually for now.
- **Dates stored as `number`** (epoch ms via `Date.now()`), not `Date` objects or
  ISO strings — clean index range queries and simple arithmetic for aging buckets.

Final schema lives in `src/db/schema.ts`. ✅ Builds clean, no TypeScript errors.

**Important write-discipline note for later phases:** any code that creates a
Sale, Restock, or Return must update `inventory.quantity` inside the *same*
IndexedDB transaction (e.g. `db.transaction(['sales', 'inventory'], 'readwrite')`).
Two separate transactions risk inventory drifting out of sync with what was
actually sold if a crash happens between them — this is the one spot in the app
where a subtle bug costs real money.

## 6. Offline caching test

Built + previewed production build, loaded once online (service worker installed
and cached the app shell), then switched DevTools → Network to "Offline" and
reloaded. ✅ App shell rendered fully offline — no browser error page.

### Gotcha: `verbatimModuleSyntax` and type-only imports

Vite's TS template enables `verbatimModuleSyntax`, which requires types imported
from a library to be explicitly marked as type-only if mixed with real
values/functions in the same import line. Hit this with `idb`:

```ts
// ❌ fails: DBSchema and IDBPDatabase are types, openDB is a function
import { openDB, DBSchema, IDBPDatabase } from 'idb';

// ✅ split them
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
```

Worth remembering for any future library import that mixes types and values.

## Phase 1 — COMPLETE ✅

All checkpoints verified, not just tasks completed:
- Project scaffold builds and runs
- PWA manifest + service worker confirmed active in DevTools
- App shell confirmed working fully offline (DevTools network throttling)
- Git initialized, GitHub remote pushed
- IndexedDB schema designed, discussed, and building with no TS errors
- Folder structure in place: `src/db`, `src/features/{ledger,inventory,billing}`,
  `src/components`

## Next steps — Phase 2: Inventory core

- [ ] Build inventory data-access functions in `src/db` (create/read inventory
      items, apply unit conversions)
- [ ] Restock flow: create a `restock` record + atomically update
      `inventory.quantity` in the same transaction
- [ ] Basic inventory list UI (in `src/features/inventory`)
- [ ] Confirm the write-discipline rule holds: every quantity change happens
      inside the same transaction as the resource that causes it
- [ ] Configure ESLint + Prettier compatibility (`eslint-config-prettier`) —
      still pending from Phase 1, low priority, fold in whenever convenient