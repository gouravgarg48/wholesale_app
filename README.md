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

- [ ] Configure ESLint + Prettier compatibility (`eslint-config-prettier`) —
      still pending, low priority
- [ ] Sale UI (mirrors AddProductForm's shape: CASH vs RETAIL toggle, item
      picker, refresh-on-create wiring into InventoryList)
- [ ] Retailer CRUD (needed before RETAIL sales can be tested end-to-end through
      the UI — currently only testable with a raw `retailerId` string)

## 7. Testing strategy

Given the plan's explicit guidance ("cut UI polish before cutting testing —
testing protects against ledger bugs that cost real money"), settled on a scoped
approach rather than skipping tests or over-investing:

- **Unit tests**, written alongside each pure function as it's built: unit
  conversion, later bill totals, aging-bucket math, balance derivation.
- **Integration tests** for transaction-boundary code specifically — anything
  touching `inventory.quantity` (restock/sale/return) and payment allocation
  logic. These are the highest-stakes spots since a bug there silently corrupts
  real data.
- **Skipped for now**: UI component tests, end-to-end tests — not worth it before
  the Phase 6 UI pass, since the UI doesn't have final shape yet.

Set up with Vitest (shares Vite's config, near-zero setup):
```powershell
npm install -D vitest
```
Added `"test": "vitest"` to `package.json` scripts, and a `test` block to
`vite.config.ts` (`environment: 'node'` — no DOM needed for pure logic tests).

**Real bug caught during setup, worth remembering:** a test asserting a function
throws (`expect(() => fn()).toThrow()`) can pass for the *wrong* reason — calling
an `undefined` function also throws a `TypeError`, which satisfies a
no-argument `.toThrow()` check. First test run showed 2/7 passing this way
because `inventory.ts` hadn't actually been saved yet, masking the real failure.
**Lesson: a passing "throws" test isn't proof by itself — confirm it's throwing
for the right reason, not just throwing.**

## 8. Inventory data-access layer

`src/db/inventory.ts` — `createInventoryItem`, `getInventoryItem`,
`listInventory`, plus `convertToBaseUnit`/`convertFromBaseUnit` for unit
conversion. Key decisions:

- New items always start at `quantity: 0` — stock only ever enters through a
  restock record, which enforces the "quantity only changes via a real
  transaction" rule from day one rather than relying on remembering it later.
- Unit conversion **throws** on an undefined unit rather than silently returning
  `NaN` or an unconverted number — fails loud instead of quietly corrupting stock
  counts.

`src/db/inventory.test.ts` — 7 tests covering both conversion functions
including a round-trip check (catches the case where one direction of a
conversion is fixed but its inverse isn't). ✅ All passing, confirmed for the
right reasons.

## 9. Restock flow — the first proven atomic transaction

`src/db/restock.ts` — `createRestock()`. Takes a batch of items, converts each to
the item's base unit, updates `inventory.quantity` for each, and writes a
`restock` record — all inside one IndexedDB transaction
(`db.transaction(['restock', 'inventory'], 'readwrite')`), with an explicit
`tx.abort()` in the catch block if anything fails partway through the batch.

**Why explicit abort matters:** wrapping code in a transaction doesn't make it
atomic by itself. Without `tx.abort()`, any `inventoryStore.put()` calls already
made earlier in the loop would auto-commit once the transaction goes idle,
silently leaving quantity partially updated. The explicit abort is the actual
mechanism that makes this safe.

### Refactor: `getDB()` is now a cached singleton

Added `closeDB()` alongside it (needed for tests to cleanly reset between runs;
also useful later for a "reset local data" feature).

### Testing infrastructure — three real issues hit and fixed, in order

1. **`vite.config.ts` needs `defineConfig` from `'vitest/config'`**, not `'vite'`
   — Vite's own `defineConfig` type doesn't know about the `test` field Vitest
   adds, which throws a confusing "test does not exist" TS error otherwise.
2. **Test files must be excluded from the production build's type-check** — added
   `"exclude": ["src/**/*.test.ts"]` to `tsconfig.app.json`. `tsc -b` (used by
   `npm run build`) doesn't need to resolve `vitest` at all; Vitest handles its
   own compilation separately at runtime.
3. **`fake-indexeddb`** installed as a polyfill, since Vitest runs in Node and
   Node has no real IndexedDB. Wired up via `src/test-setup.ts`
   (`import 'fake-indexeddb/auto'`) referenced in `vite.config.ts`'s
   `test.setupFiles`.

Also hit (and worth remembering): a combined `npm install -D vitest fake-indexeddb`
silently failed to install `vitest` specifically, with no visible error in the
truncated terminal output — `fake-indexeddb` landed, `vitest` didn't.
**Lesson: when "cannot find module X" persists after what looks like a
successful install, check `npm list X` directly rather than assuming it's a
config problem** — install failures and config failures throw near-identical
errors.

### Real bug caught by Vitest itself, not by us

First test run: all 11 tests reported "passed," but Vitest also flagged an
**unhandled rejection** (`AbortError`) after the rollback test. Root cause:
`tx.abort()` causes `idb`'s `tx.done` promise to reject, and the `catch` block
only awaited `tx.done` on the success path — the rejection from `tx.abort()`
was never caught. Fixed by adding `tx.done.catch(() => {})` before rethrowing
the original error. The rollback itself was always working correctly (that's why
the test's assertion passed) — but an unhandled rejection is a real bug that can
cause flaky results later, even while the test count says "all green."
**Lesson: a fully green test run can still have a bug flagged elsewhere in the
output — check for warnings/unhandled-error sections, not just the pass count.**

### Test coverage (`src/db/restock.test.ts`, 4 tests)

- Inventory quantity increases by the correctly converted amount
- `totalCost` computed correctly across multiple line items
- **Rollback test**: a batch with one valid item followed by one invalid item
  (nonexistent `inventoryId`) leaves the valid item's quantity at 0, not
  partially updated — proves the transaction actually rolls back, not just that
  the function throws
- Empty items array is rejected

✅ 11/11 tests passing, confirmed with no unhandled errors.

## 10. First UI screen: inventory list + add-product form

`src/features/inventory/InventoryList.tsx` and `AddProductForm.tsx`, wired into
`App.tsx`. Deliberately functional-first, not a final design pass — Phase 6 is
where visual polish gets real attention.

- **Empty state confirmed working** before any write path existed — proved
  `listInventory()` + the loading/error/empty branches render correctly with a
  genuinely empty store, not just with data present.
- **Refresh-on-create wiring**: `App.tsx` holds a `refreshTrigger` counter,
  passed down to `InventoryList` as a prop and bumped by `AddProductForm`'s
  `onCreated` callback. This is the standard React pattern for "sibling
  component needs to know data changed elsewhere" — worth remembering, since
  it'll repeat for sale-form → inventory refresh, payment-form → ledger refresh,
  etc.
- Form validates client-side before writing: name required, price must be a
  positive number, conversion units can't collide with the base unit or repeat.

**Bug hit and fixed:** blank white screen on first load — actually a
`SyntaxError` (missing export), not a silent failure. Root cause: the
`formatQuantityDisplay` helper was described in chat but not yet saved into
`inventory.ts` before the importing component was created. **Lesson: always
check the browser console before assuming a blank screen means "nothing
rendered" — it usually means something crashed, and the console says
why.**

## 11. Styling: Tailwind CSS (v4)

Started with hand-written CSS files per component; switched to Tailwind once a
second component made it clear two competing styling systems (hand-written CSS
+ inline utility-style choices) would get confusing fast.

Setup (Tailwind v4 — notably simpler than older tutorials floating around
online, which reference a `tailwind.config.js`/PostCSS flow from v3 that no
longer applies):
```powershell
npm install -D tailwindcss @tailwindcss/vite
```
Added `tailwindcss()` to the `plugins` array in `vite.config.ts` alongside
`react()` and `VitePWA()`. Replaced `src/index.css` entirely with:
```css
@import "tailwindcss";
```
No config file needed for this basic setup.

**Design choice:** using Tailwind's arbitrary-value syntax (e.g.
`text-[#6b6555]`, `bg-[#faf7f2]`) instead of Tailwind's built-in palette
(`text-gray-500`, etc.) to keep the warm-paper aesthetic specific to this app
rather than drifting toward Tailwind's generic defaults. Worth formalizing into
named theme tokens (a `@theme` block) once 3-4 screens repeat the same colors —
premature right now with only two components.

Both `InventoryList.tsx` and `AddProductForm.tsx` converted to Tailwind
utilities; the two original `.css` files deleted. ✅ Confirmed visually
identical after the conversion — a system swap, not a redesign.

## 12. Sale flow

`src/db/sales.ts` — `createSale()`. Same atomic-transaction pattern as restock
(`db.transaction(['sales', 'inventory'], 'readwrite')`, explicit `tx.abort()` +
`tx.done.catch(() => {})` on failure), decrementing `inventory.quantity` instead
of incrementing it.

**One genuinely new business rule vs restock:** a sale can't take more stock
than exists. Checked *inside* the transaction, against the live record just
read from the store — not against a value cached earlier — so it's correct even
if another write touched the same item concurrently.

**CASH vs RETAIL handled at creation time:**
- `CASH` → requires `buyerName`, marked `paymentStatus: 'paid'` and
  `amountPaid: totalAmount` immediately (no ledger involvement, per the earlier
  schema decision).
- `RETAIL` → requires `retailerId`, starts `paymentStatus: 'unpaid'` and
  `amountPaid: 0` until a future payment allocates against it.

### Test coverage (`src/db/sales.test.ts`, 7 tests)

- Inventory quantity decreases by the correctly converted amount
- CASH sale marked fully paid on creation
- RETAIL sale marked unpaid on creation
- Sale exceeding available stock is rejected, **and stock is confirmed
  untouched** afterward (not just that it throws)
- **Rollback test**: a multi-item sale with a valid deduction first and an
  insufficient-stock failure second leaves the first item's quantity fully
  restored — proves the transaction actually unwinds, not just that the
  function errors
- CASH sale without a buyer name is rejected
- Empty items array is rejected

✅ 18/18 tests passing across all three test files (`inventory`, `restock`,
`sales`), clean production build, no unhandled errors.

## 13. Editable product fields

Market price changes frequently in practice, so needed a real edit path — but
not every field on a product is safe to edit after creation:

- **Safe to edit anytime**: `productName`, `marketPrice`, `unitConversions`.
  These are forward-looking defaults; past sales already snapshotted their own
  `salePrice` at time of sale, so editing these never touches historical
  records.
- **Never editable**: `quantity` (only changes via restock/sale/return, per the
  standing rule) and `baseUnit`. The latter is subtle — `quantity` is stored as
  a raw number *in* `baseUnit`; changing `baseUnit` after stock exists would
  silently reinterpret that number in the new unit without converting it. If a
  product's base unit was set wrong, delete and recreate it rather than editing
  in place.

`updateInventoryItem()` added to `src/db/inventory.ts`. Its input type simply
omits `quantity` and `baseUnit` as fields — TypeScript makes editing them
impossible to wire up by accident, not just a runtime check that could be
forgotten. 5 tests in `src/db/inventory-update.test.ts` cover: price update
leaves quantity untouched, non-positive price rejected, empty name rejected,
conversion unit colliding with base unit rejected, nonexistent item rejected.

**UI**: inline edit on each `InventoryList` row ("Edit price" → input + Save/
Cancel). Deliberately refetches from the DB after save rather than optimistically
updating local state, so the table always reflects what's actually persisted.

✅ 23/23 tests passing overall. Manually confirmed: create, edit price, and
persistence across a page refresh all working correctly.