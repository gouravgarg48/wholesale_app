# Wholesale App — Development Log

Session-by-session record of decisions, debugging journeys, and lessons learned
while building this app. Read this if you want the *why* behind a choice or
you're hunting for a bug you vaguely remember hitting before.

For "how do I set this up and what's the current state," see `README.md`
instead — this file is a history, not a getting-started guide.

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

- [ ] Sale UI (mirrors AddProductForm's shape: CASH vs RETAIL toggle, item
      picker, refresh-on-create wiring into InventoryList)
- [ ] Retailer CRUD (needed before RETAIL sales can be tested end-to-end through
      the UI — currently only testable with a raw `retailerId` string)
- [ ] Configure ESLint + Prettier compatibility (`eslint-config-prettier`) —
      still pending, low priority

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

## 14. Restock UI

Closed a real gap flagged at the end of the last session: `createRestock()` had
automated test coverage but had never been exercised through the actual app —
every inventory item visible in the browser still showed `quantity: 0`, since
nothing existed to add real stock through the UI.

`src/features/inventory/RestockForm.tsx` — picks from *existing* inventory items
(doesn't create new ones, unlike `AddProductForm`), supports multiple line items
per delivery matching the schema's batch shape, wired into `App.tsx` sharing the
same `refreshTrigger` pattern as the other forms.

A couple of deliberate details:
- **Switching the product mid-row resets the selected unit.** Without this, a
  unit valid for one product (e.g. "bag") could silently carry over to a
  different product that has no such conversion defined, and get submitted
  as-is.
- **Empty trailing rows are silently skipped on submit, but partially-filled
  rows throw a real validation error** — lets you leave a blank row at the
  bottom without blocking submission, while still catching genuinely
  incomplete entries.

✅ Manually confirmed end-to-end: create a product → record a restock →
correct non-zero quantity renders in the inventory table. First time real stock
numbers (not just `0`) have been seen on screen rather than only in test
assertions.

## 15. Retailer UI, balance display, sale UI, and payment flow

Built in sequence: `RetailerForm`/`RetailerList` (with live balance shown per
retailer, derived from `getRetailerBalance()` rather than stored), `SaleForm`
(CASH/RETAIL toggle, retailer picker, sale price pre-filled from
`marketPrice` but editable), and `createPayment()`.

Retailer table shows balance in red/bold when it exceeds credit limit — first
real UI signal that the credit-limit rule means something, not just a stored
number nobody looks at.

## 16. Payment allocation — FIFO, and a real timestamp bug

`createPayment()` allocates a payment across a retailer's unpaid sales,
oldest first (FIFO), same atomic-transaction pattern as restock/sale. Sales
are sorted by `date` to determine "oldest."

### Bug caught by the FIFO test, not by us

The FIFO test (pay ₹400 across two ₹300 sales — first should fully settle,
second should end up ₹100 paid) failed on first run: `expect(paid).toBe('paid')`
got `'partial'` instead. Both sales were created via `createSale()` calls with
no real time gap between them in the test — meaning both got the exact same
`Date.now()` millisecond timestamp. Once two records tie on `date`, sort order
between them falls back to whatever IndexedDB's index cursor happens to return
first — not creation order. So "oldest first" silently broke exactly in the
one case that matters: sales entered in rapid succession, which is completely
normal at a real shop counter, not just a test artifact.

**Fix:** a monotonic clock (`src/db/clock.ts`) that guarantees strictly
increasing timestamps even within the same millisecond:

```ts
let lastTimestamp = 0;
export function monotonicNow(): number {
  const now = Date.now();
  if (now <= lastTimestamp) {
    lastTimestamp += 1;
    return lastTimestamp;
  }
  lastTimestamp = now;
  return now;
}
```

Replaced every stored `date`/`createdAt` field across `inventory.ts`,
`restock.ts`, `sales.ts`, `retailers.ts`, and `payments.ts` with this instead
of raw `Date.now()`.

**Lesson, worth remembering for the upcoming aging view:** any code that
orders records by a stored timestamp needs a monotonicity guarantee, not just
"usually different values." Wall-clock time is not a safe sort key when
records can be created faster than 1ms apart — and in an interactive app,
that's not a rare edge case, it's Tuesday.

### Test coverage (`src/db/payments.test.ts`, 7 tests)

- Payment exactly covering one sale settles it fully
- Partial payment applied correctly
- **FIFO split test**: ₹400 across two ₹300 sales — first fully paid, second
  partially paid with the exact remainder — this is the test that caught the
  timestamp bug above
- Payment exceeding total owed is rejected
- CASH sales and already-paid sales are correctly skipped during allocation
- Non-positive amount rejected
- Payment against a retailer with nothing owed is rejected

✅ 41/41 tests passing across all six test files after the clock fix.

## 17. Aging report

`src/db/aging.ts` — `getAgingReport(asOf = Date.now())`. For every retailer
with an unpaid/partial sale, computes days-outstanding per sale, buckets into
`current | 7+ | 15+ | 30+`, and sorts the whole report worst-bucket-first (then
by total outstanding) so the most overdue retailers surface at the top rather
than requiring a scan of the whole list.

**Deliberate design choice: `asOf` is a parameter, not read internally from
`Date.now()`.** This is what makes "20 days later" and "sort by severity"
testable deterministically at all — without it, every aging test would depend
on the actual wall-clock moment it happens to run.

### A second test-timing bug, different flavor from the FIFO one

The "sorts retailers with the most overdue bucket first" test failed on first
run — but this time the *function* was correct; the *test* was wrong. The test
created two sales back-to-back (a few milliseconds apart via `monotonicNow()`)
and computed a single shared `asOf` meant to make one "5 days old" and the
other "40 days old" — but both sales actually landed at roughly the same age
relative to that `asOf`, since the only real time difference between them was
milliseconds, not days. Both fell into the same `30+` bucket with identical
outstanding amounts, so the sort had a genuine tie and picked arbitrarily.

**Fix:** stopped relying on incidental timing between `createSale()` calls
entirely — directly overwrote each sale's `date` field in the test to set up
the exact age difference under test, then ran the assertion against that.

**Broader lesson, now confirmed twice in one project (see also the FIFO
payment bug in section 16):** any test whose premise is "record A happened
before/after record B" needs to control that relationship explicitly, not
infer it from call order or incidental timing. This isn't the same bug
repeating — the FIFO case was a real production bug (the code was wrong), this
one was a test-authoring bug (the code was fine, the test's setup didn't
actually create the condition it claimed to). Worth being precise about which
one it is each time, since the fix location differs.

### Test coverage (`src/db/aging.test.ts`, 5 tests)

- Retailers with zero outstanding balance are excluded from the report
- A sale's age in days is bucketed correctly
- `totalOutstanding` sums unpaid amounts, not full sale totals (respects
  partial payments already applied)
- **Sort test**: retailer with a 30+ day debt sorts ahead of one with a
  current debt — this is the test that caught the timing bug above
- Multiple unpaid sales for one retailer are ordered oldest-first within that
  retailer's entry list

✅ 46/46 tests passing across all seven test files.

## 18. Real-device phone install check — started, not yet complete

Prompted by noticing this was actually part of Phase 1's original checkpoint
("app shell installs on your phone... opens offline") but had only ever been
verified via desktop DevTools network throttling — never on an actual device.

Process: `npm run build` (compiles — no `--host` flag here, that's a `preview`
option not a `build` option, corrected after an initial mix-up), then
`npm run preview -- --host` to serve on the local network rather than just
localhost. Confirmed working — terminal shows both `Local:` and `Network:`
URLs.

**Stopped here for the session** — next step is opening the network URL on
the phone (same Wi-Fi), adding to home screen, launching standalone, and the
actual checkpoint: airplane mode with the app already open, confirming the
shell still loads. None of that's been done yet.

## 19. Return flow

`src/db/returns.ts` — `createReturn()` and `getReturnableQuantities()`. Same
atomic-transaction pattern as restock/sale, but touches three stores
(`['returns', 'inventory', 'sales']`) since it both restores stock and adjusts
the sale's payment status.

### Design decisions

- **Refund at sale-time price, not current market price.** Each return line
  computes `quantity * salePrice` using the original `salePrice` from the sale
  record — this is what makes a return the true inverse of a sale, not a
  best-effort approximation using today's price.
- **Over-return prevention across multiple returns.** `computeRemainingReturnable()`
  is a pure function that takes the sale's items and a list of prior return
  items, then returns the remaining returnable quantity per line. This avoids
  cross-transaction reads inside `createReturn()` — each return is
  self-contained, checking its own limits against already-returned amounts
  without needing to lock other in-flight returns.
- **RETAIL payment status adjustment.** For RETAIL sales, the refund amount is
  subtracted from `amountPaid` (not `totalAmount`), and `paymentStatus` is
  recomputed — so a partially-paid sale that gets fully returned ends up with
  `paymentStatus: 'paid'` and `amountPaid: 0`, not some phantom balance. CASH
  sales are left untouched since they never touched the ledger.
- **UI is embedded inline, not a separate route.** `ReturnForm` lives inside
  `SalesList` — a "Return" button on each active sale row opens the form
  inline, passing `saleId` and an `onCreated` callback that refreshes the list.

### Test coverage (`src/db/returns.test.ts`, 10 tests)

- Inventory quantity restored by correctly converted amount
- Refund computed at sale-time price (not market price)
- RETAIL sale's `amountPaid` adjusted correctly after return
- CASH sale payment fields left untouched
- Over-returning a single line is rejected
- Overflow across multiple returns (returning more than remaining) is rejected
- Return against a cancelled sale is rejected
- Multi-item rollback: valid item first, failing item second — valid item's
  quantity fully restored (proves the transaction unwinds, same pattern as
  restock/sale rollback tests)
- Empty reason is rejected
- Return against a nonexistent sale is rejected

✅ 56/56 tests passing across all eight test files.

## 20. Billing / print — A5 bill view and sequential invoice numbers

Phase 4. `src/features/billing/BillPrintView.tsx` renders a sale as a printed
A5 bill, opened from a "Print" button in `SalesList`.

### Business identity is hardcoded for now

The bill header shows Shri Ram Enterprises, 88826 36888, Naharpur Rohini —
stored as a `BUSINESS` constant at the top of `BillPrintView.tsx`. Deliberate
stopgap: Phase 6 (UI pass) is where this becomes an editable settings record.
Un-printing that decision means touching both the bill view and adding a
settings store to the schema — wait for Phase 6, it's on the plan.

### Sequential invoice numbers — one per sale, stable across reprints

`src/db/invoices.ts` — `assignInvoiceNumber(saleId)` issues the next number in
sequence and stores a `{ saleId, invoiceNumber, createdAt }` record in a new
`invoices` store. Two design points that came out of the Phase 4 questions:

- **Numbers are assigned once per sale, not once per print.** A sale that's
  printed twice must show the same invoice number both times — renumbering a
  reprint would make the paper trail untrustworthy. `assignInvoiceNumber` is
  idempotent: if the sale already has a number, it returns that number without
  advancing the sequence counter.
- **The sequence counter lives in a separate `counters` store**, keyed
  `'invoiceNumber'`, allocated in the same atomic transaction as the `invoices`
  record (same abort/rethrow pattern as every other transaction in this app).
  `getInvoiceNumberForSale()` is a read-only lookup that never advances it — so
  merely viewing a sale doesn't burn a number.

Schema went to **DB version 2** with a tested upgrade path: the store-creation
logic is now guarded with `objectStoreNames.contains(...)` so an existing v1
database upgrades cleanly instead of trying to recreate already-existing
stores (which throws). Tested implicitly by every test that reconnects after
`closeDB()` — the v1→v2 upgrade is what those guard checks exercise.

### Printing: the browser dialog does the work

The plan says print via the browser print dialog to the shop's existing
printer — no thermal printer, no special hardware. v1 renders **one clean A5
bill** and the copies count is set in the dialog (that's the "single bill +
manual copies" choice — the 3-copy *physical* output is a print-dialog setting,
not three differently-labeled pages, at least for now).

`@media print` in `src/index.css`:
- `@page { size: A5; margin: 10mm }` — A5 page geometry
- `body * { visibility: hidden }` then re-enable `.print-area, .print-area *` —
  the standard "print only this subtree" trick (visibility rather than
  display:none so the bill keeps its layout)
- `.print-area { position: absolute; left: 0; top: 0; width: 148mm }` pins the
  bill to the page top-left. The screen-mode toolbar (Back / Print) is hidden
  with Tailwind's `print:hidden`.

### Template cutbacks after the first real look

The first version included an Amount / Received / Balance summary box and a
PAID / PARTIALLY PAID / UNPAID status badge at the bottom. Removed at the
user's request while reviewing the rendered bill: this business prints the
bill *before* money changes hands on the ledger, so a balance figure baked
into the sheet would just be wrong by print time, and the payment-status badge
similarly describes ledger state that doesn't belong on a paper invoice. The
bill now ends at Total with the two signature blocks.

### Test coverage (`src/db/invoices.test.ts`, 5 tests)

- Sequential allocation starts at 1 and increments across sales
- Reprinting the same sale returns the same number
- Numbers persist across a DB reconnect
- A never-printed sale returns `undefined` from the read-only lookup
- **Blank-page guard**: the read-only lookup doesn't advance the sequence

✅ 61/61 tests passing across all nine test files (was 56/56 before the invoices file).

### Backlogged: real-printer checkpoint (not done)

The Phase 4 checkpoint is "a real bill prints correctly on the actual shop
printer" — margins, paper size, and browser print quirks are exactly the kind
of thing that only shows up on hardware. The view is built and verifiable in a
pilot, but the checkpoint itself requires a physical print run from the shop
printer. Not done yet, and deliberately the next thing to check after this is
in a real browser.

## 21. ESLint + Prettier cleanup (the long-pending "low priority" item)

The Phase 3 list had been carrying "Configure ESLint + Prettier compatibility
(`eslint-config-prettier`)" since the scaffolding days. It stayed pending
because it was genuinely low priority — the app only had one developer, and
formatting disagreements between humans aren't a thing when there's one human
— but it's the kind of debt that compounds the moment a second person (or an
AI) starts committing to the same repo. Settled it:

- **Prettier wasn't installed at all**, so the setup was: `prettier` +
  `eslint-config-prettier` as dev deps, a `.prettierrc` (`singleQuote: true`,
  `semi: true`, `printWidth: 100` — matches the existing hand-written style),
  a `.prettierignore` (`dist`, `node_modules`, `package-lock.json`, the
  checklist HTML, and **`*.md`**), and `format` / `format:check` scripts.
- **`eslint-config-prettier` (v10) goes last in the flat config** in
  `eslint.config.js` — that's the whole point, it *disables* ESLint's
  formatting rules so ESLint and Prettier can't fight. (For v10 the flat
  config is just the module's default export; no `eslint-config-prettier/flat`
  subpath needed anymore.)
- One-time `prettier --write .` reformatted the whole `src` tree plus the
  config files (which had drifted — `vite.config.ts` imported without
  semicolons and lacked a trailing newline).

**Two deliberate scope decisions:**

1. **Markdown is not formatted.** Prettier rewrites prose (`*why*` →
   `_why_`, inserts blank lines, etc.) — that's churn without value on a
   history file like DEVLOCK that's written for humans. Code and config only.
2. **A pre-existing lint failure got fixed in the same pass, because the
   cleanup's point is a green `npm run lint`.** Two files tripped the new
   `react-hooks/set-state-in-effect` rule:
   - `InventoryList`: `load()` called `setLoading(true)` synchronously inside
     the effect. Now "Loading…" shows only on initial mount (initial state is
     already `true`) and refreshes happen silently; the synchronous setState
     is gone.
   - `PaymentForm`: the effect did a synchronous `setBalance(null)` when no
     retailer was selected. Moved that reset into the select's `onChange`
     handler instead — same behavior, and it incidentally removes a stale-
     balance flash window when switching retailers (the reset now happens at
     input time, not one render later).

**Lesson worth remembering:** a one-time `eslint-config-prettier` setup
quickly surfaces whether the repo's lint was actually green before. These two
new-rule errors predated this pass — `npm run lint` had just never been run
against code since the react-hooks v7 rule landed.

✅ `npm run lint` clean, `npm run test` 64/64 across 9 files, `npm run build`
clean.

## 22. Phase 5 — backup and persistence

The next build phase after the ESLint/Prettier cleanup. Five checklist items,
none of which need the user's Google credentials to *build* — the last mile
(sign-in against real Google, restore on the actual phone) is config-blocked
but the whole pipeline is written and tested. Summary of the shape:

### 22.1 What's where

- **`src/db/db-snapshot.ts`** — the foundation everything else sits on.
  `exportSnapshot()` reads every store into one versioned JSON document
  (`{ format, version, exportedAt, stores }`); `restoreSnapshot()` validates
  it, then clears + rewrites every store inside a **single transaction** with
  the same abort/rethrow pattern as every other transaction in this app. A
  failed restore can't leave the DB half-old/half-new.
  - **A stricter-than-obvious design decision:** a snapshot must contain
    *every* store, not just a subset. Exports always include all stores, so
    requiring them makes restore total (nothing half-merged) and makes
    `parseSnapshot` reject obviously-made-up files.
  - Validation rejects: wrong format string, unknown version, missing or
    unknown stores, non-array stores, and records missing their keyPath
    field (`saleId` for invoices, `id` everywhere else).
  - **The restore also rewrites the `backup` store** — which carries the
    Google token. A restored backup brings back the auth state that produced
    it. That's intentional (tokens travel with the data).

- **`src/backup/backup-state.ts`** — the backup ledger: last successful
  backup, last attempt, consecutive-failure count, in a `backup` store (DB
  **version 3**). Pure decision helpers `isBackupOverdue()` and
  `shouldAttemptBackup()` (48-hour nag threshold; 1-hour back-off after
  consecutive failures) are the tested core.

- **`src/backup/scheduler.ts`** — `runBackup(force)` orchestrates: is it due?
  online? configured? → export → upload → record success (or failure). The
  ledger only ever changes here — the single-writer discipline, same idea as
  inventory.quantity. Dependency injection (`now/isOnline/isConfigured/
  upload`) is what makes it testable in Node where there's no navigator or
  real upload path.

- **`src/backup/drive.ts`** — the Google client: PKCE OAuth via a full-page
  redirect (works in standalone PWAs, dodges popup blockers), token store in
  the `backup` store with refresh handling, and Drive file create/list/
  download scoped to a "Wholesale App Backups" folder via the `drive.file`
  scope (app only ever sees its own files).

- **`src/backup/config.ts`** — one constant file with an empty `clientId`.
  The single manual setup step; the UI and scheduler notice the empty value
  and degrade to the no-OAuth path ("not configured") rather than throwing.

- **`src/backup/persistence.ts`** + `main.tsx` — `navigator.storage.persist()`
  is requested at startup (that's the "don't let the browser evict my ledger"
  call from the checklist) and the resulting status is shown in the panel.

- **`src/features/backup/BackupPanel.tsx`** — status + the 48-hour nag (red
  border, plain-language warning), Sign in / Back up now, storage-persistence
  status, manual file download/restore, and the auth-callback handler that
  cleans the `?code=...` params out of the URL after a redirect.

### 22.2 Two bugs caught by our own rules, before the browser did

1. **The snapshot-required-stores rule caught an eager test.** I first wrote
   the "wipe the DB" test with `stores: {}` and expected restore to clear
   everything. It doesn't (nothing to write = nothing cleared) — which is
   exactly why `parseSnapshot` now rejects missing stores instead of silently
   merging. The test forced the API to be honest.
2. **The type system caught a widening bug.** `STORES` was declared as
   `readonly StoreName[]` where `StoreName = keyof WholesaleDB`; spreading it
   into `db.transaction(...)` widened the union to `string` and broke idb's
   per-store typing. Declared the tuple `as const` and derived the union from
   it instead — no casts needed at the call site, and the build is stricter
   than it was before.

### 22.3 The react-hooks v7 lint rules are strict — worth the match

The BackupPanel triggers `react-hooks/set-state-in-effect` easily because it
does a lot of loading on mount. The pattern that satisfies the rule: **all
setState that runs on mount goes through `.then()` callbacks, timers, or the
interval callback — never synchronously in the effect body.** Computed-from-
now state (the "is it overdue?" flag) is computed in the loading callback and
stored as state rather than calling `Date.now()` during render (`react-hooks/
purity` flags impure calls in render). This is the third time the new-rule-set
has made the code better rather than just quieter — see §21.

### 22.4 What's deliberately not done yet

- The Google client ID is empty; nothing can be tested against real Google
  until `src/backup/config.ts` is filled in. The pure parts (PKCE verifier/
  challenge, auth-URL construction, multipart body) are unit-tested; the
  network calls are not.
- The **p5 checkpoint** ("kill the app, clear cache, restore from a Drive
  backup") needs the above plus a real device.

✅ 103/103 tests across 13 files, `npm run lint` clean, `npm run build` clean.
