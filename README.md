# Wholesale App

Internal PWA for ledger, inventory, and billing management for a rice/condiments
wholesale business — replacing a manual Tally/Busy-style process. Offline-first,
single-device v1, React + TypeScript + Vite.

For the story behind decisions, debugging journeys, and lessons learned along
the way, see `DEVLOG.md`. This file only covers current setup and state.

## Setup

**Requirements:** Node 20+ LTS via nvm-windows (or your platform's nvm), npm 10+.

```powershell
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build (required to test PWA/service worker)
npm run preview   # serve the production build locally
npm run test      # run the test suite (Vitest)
npm run lint      # ESLint (formatting-conflicting rules disabled via eslint-config-prettier)
npm run format    # format all code with Prettier
npm run format:check  # verify formatting without modifying files
```

## Deployment

**Live URL:** https://gouravgarg48.github.io/wholesale_app/

Pushes to `main` auto-deploy to GitHub Pages via the workflow in
`.github/workflows/deploy.yml`. Vite's `base: '/wholesale_app/'` in
`vite.config.ts` rewrites all asset paths for the subdirectory — don't change
the repo name without updating it.

Manual deploy (no push): run "Deploy to GitHub Pages" → workflow_dispatch in
the repo's Actions tab.

The phone installs this as a standalone PWA — add to home screen and it opens
offline with no server running.

## Architecture

- **Vite + React + TypeScript**, PWA via `vite-plugin-pwa` (offline-capable,
  installable — confirmed working via DevTools Application tab + offline
  network throttling test)
- **IndexedDB** (via the `idb` wrapper) for local, offline-first storage —
  schema in `src/db/schema.ts`
- **Tailwind CSS v4** for styling, using arbitrary-value color syntax
  (`text-[#6b6555]`) to keep a specific warm-paper palette rather than
  Tailwind's generic defaults
- **Vitest + fake-indexeddb** for testing — unit tests for pure logic (unit
  conversion), integration tests for transaction-boundary code (restock, sale)
- **Multi-user behavior:** the app has no backend — every browser/install is a
  fully isolated data store. Data lives in that device's IndexedDB, and Drive
  backups (scoped by `drive.file`) go to *each user's own* Google Drive. No
  shared state, no cross-user sync.

### Folder structure

```
src/
  db/                    — schema + all IndexedDB access (data layer)
  backup/                — Phase 5: snapshot, scheduler, Drive client, persistence
  features/
    inventory/           — inventory list, add-product, restock UI
    ledger/              — retailers, sales, payments, returns, aging UI
    billing/             — A5 bill print view + invoice numbering
    backup/              — Backup panel UI (status, backlog nag, Drive, manual file)
  components/            — shared UI (not yet populated)
```

## Data model

Full schema in `src/db/schema.ts`. Key design points:

- **Sales are immutable once created.** Each line item snapshots its own
  `salePrice` (₹/kg) and `weightPerUnitKg` at time of sale — later price or
  weight changes never affect historical bills. Cancellation is a status flag,
  not an edit; corrections happen via a separate `Return` record.
- **Billing is weight-based.** Stock is counted in whole bag/packet units; a
  line's gross weight = `quantity × weightPerUnitKg`, and its amount =
  gross weight × `salePrice` (₹/kg). The bill prints base qty, weight/unit,
  gross weight, rate, and gross price.
- **No per-retailer price overrides** — pricing is decided per sale, not
  pre-configured per retailer.
- **`saleType: 'CASH' | 'RETAIL'`** — CASH sales need only a `buyerName` and
  are marked paid immediately, no ledger involvement. RETAIL sales need a
  `retailerId` and start unpaid.
- **Payments store allocations inline** (`{ saleId, amountApplied }[]`), no
  separate join table. Each `Sale` carries `amountPaid`/`paymentStatus` so
  aging (who owes what, since when) can be computed directly.
- **`Inventory.quantity` is a cached running total** — never edited directly.
  It only changes inside the same IndexedDB transaction as creating a `Sale`,
  `Restock`, or `Return` record. This is the one place in the app where a bug
  would silently corrupt real data, so every write here is covered by an
  integration test that proves the transaction actually rolls back on failure,
  not just that the function throws.
- **Products are counted in whole bag/packet units** — `baseUnit` is `'bag'` or
  `'packet'` (no kg/quintal), `quantity` is stored raw in that unit, and every
  product requires `weightPerUnitKg` (e.g. 50 for a 50kg rice bag).
  `marketPrice` is ₹ per kg. **`baseUnit` is not editable after creation** —
  changing it would silently reinterpret existing stock; delete and recreate
  the product instead.
- Waste/loss tracking was cut from v1 scope (can be added back later as its own
  store, same shape as `restock`).
- **Timestamps use a monotonic clock (`src/db/clock.ts`), not raw `Date.now()`.**
  Any two records created within the same millisecond would otherwise get
  identical timestamps, breaking anything that orders by date — this bit
  payment FIFO allocation directly (see Known gotchas). `monotonicNow()` is a
  drop-in replacement wherever a stored `date`/`createdAt` field is set.

## Current state

**Phase 1 (foundation) — complete.** Scaffold, PWA + verified offline caching,
git/GitHub, folder structure, IndexedDB schema.

**Phase 2 (inventory core) — complete.**

Done:
- Inventory CRUD: create, edit (`marketPrice` ₹/kg, `productName`,
  `weightPerUnitKg` only — `quantity`/`baseUnit` are not editable, enforced at
  the type level). Product entry requires a weight per bag/packet to enable
  weight-based billing.
- Restock flow: data layer + UI, atomic transaction proven by tests
- Sale flow: data layer + UI, CASH/RETAIL types, stock-check rule (can't sell
  more than exists)
- Retailer CRUD: data layer + UI, including live balance shown per retailer
  (derived from unpaid sales, not stored)

**Phase 3 (ledger core) — complete.**

Done:
- Payment entry: FIFO allocation across a retailer's oldest unpaid sales
  first, updates each sale's `amountPaid`/`paymentStatus`, atomic transaction
  proven by tests (including an exact-split case across two sales)
- Aging report: buckets each retailer's unpaid sales by days outstanding
  (current / 7+ / 15+ / 30+), sorted worst-bucket-first so the most overdue
  retailers surface at the top
- Cancel/return flow: `createReturn()` reverses a sale's amount and restores
  inventory atomically, with over-return prevention across multiple returns,
  refund at sale-time price (not current market price), and RETAIL payment
  status adjustment. UI embedded inline in `SalesList`. 10 tests.

**Phase 3 — complete.** All ledger-core items done (including ESLint + Prettier
compatibility — see DEVLOG §21).

**Phase 4 (billing/print) — in progress.**

Done:
- Weight-based A5 printable bill view (`BillPrintView`) — hardcoded business
  header (Shri Ram Enterprises, Naharpur Rohini — to be made editable in Phase
  6), itemized lines showing base qty, weight/unit, gross weight, rate (₹/kg)
  and gross price, totals row incl. net weight, signature blocks, 3-copy print
  via browser dialog (single clean bill; copies set in the dialog)
- Sequential invoice numbering: `assignInvoiceNumber()` in `src/db/invoices.ts`
  assigns once per sale, reused on reprint (stable bill numbers), backed by
  `invoices` + `counters` stores (DB version 3). 5 tests.
- Print CSS: the on-screen preview copies the bill into a body-level portal
  (`#print-scaffold`) and printing hides the whole `#root` — this is what
  keeps a one-page bill from spilling across multiple A5 pages. The URL footer
  seen on paper is the browser/printer's own chrome and can't be removed by the
  app.

Deferred by choice (not blocking):
- [ ] Test on the actual shop printer — margins, paper size, browser print
      quirks (the p4 checkpoint). Parking this until the pilot; printing is
      working in the browser, only real-hardware sizing needs a physical run.

**Phase 5 (backup/persistence) — in progress.**

Done:
- `navigator.storage.persist()` requested on load (`src/backup/persistence.ts`),
  status surfaced in the Backup panel
- Full-database snapshot export + restore (`src/db/db-snapshot.ts`) — a
  versioned, validated JSON image of every store; restore clears + rewrites
  everything inside one transaction (rollback on failure). **Snapshot format is
  v2** (weight-based model); v1 snapshot files are refused with a clear
  version error rather than being restored corruptly. 17 tests.
- Google Drive backup: **working end-to-end.** PKCE OAuth (redirect flow,
  refresh-token handling), upload/list/download against a dedicated "Wholesale
  App Backups" folder (`src/backup/drive.ts`). Config lives in
  `src/backup/config.ts` (client ID + secret). Requires a **Web application**
  OAuth client in Google Cloud Console with both redirect URIs registered
  (`http://localhost:5173/wholesale_app/` and
  `https://gouravgarg48.github.io/wholesale_app/`) — a Desktop client only
  accepts loopback redirects, so it breaks on the hosted origin. The token
  exchange enforces `client_secret` even for Web clients, and since this is a
  client-side app the secret ships in the bundle (limited to a `drive.file`
  scope). Uploads go to the dedicated upload host
  `https://www.googleapis.com/upload/drive/v3/files` — the plain
  `/drive/v3/files` endpoint rejects `uploadType=multipart` with a JSON parse
  error.
- Background sync: `runBackup()` scheduler tries on load and every 30 min,
  back-off on repeated failure, offline-aware; the Backup panel shows a red
  48-hour "back up now" nag when nothing has succeeded recently. Scheduler +
  ledger logic covered by tests.
- Manual fallback that needs no Google account: download the whole DB as a
  JSON file and restore from it. An optional **device label** is stamped into
  the exported file and its filename (`wholesale-backup-<label>-<date>.json`),
  so backups from different users/devices can be told apart when routed to a
  developer for manual data editing.
- **Erase all local data** button in the Backup panel (two-step confirm) —
  iOS home-screen webapps have no Safari "clear site data" menu, so this
  in-app reset is how the p5 checkpoint (restore after clearing the app) gets
  run on a phone. It deletes the IndexedDB database and reloads.

Remaining for p5 (needs the real phone again):
- [ ] The p5 checkpoint: restore a Drive backup after erasing the app's
      local data, on the actual phone (erase via the Backup panel, then
      restore from Drive)

## Real-device phone install check — done

Confirmed on the actual phone with the home-screen webapp: data persists across
app kills, it opens/works in airplane mode (offline), and Google Drive stays
linked. Two findings from that run:

- iOS home-screen webapps have no Safari "clear site data" menu — solved with
  the in-app **Erase all local data** button (Backup panel) so the p5 restore
  checkpoint can be run on-device.
- Printing a bill from the home-screen app once spilled one page of content
  onto 5 sheets; fixed by rendering the preview into a body-level print portal
  and hiding the app root instead of the old `visibility` trick (DEVLOG §23).

## Decision: multi-device sync deferred to v2 (locked in)

Confirmed during phone-install testing: the phone check surfaced a real
architecture question (`crypto.randomUUID` fails over insecure LAN origins —
fixed with `src/db/id.ts`'s fallback), which led to explicitly deciding
**v1 ships as originally planned**: one device is the single source of truth,
Google Drive is backup/disaster-recovery only, **not** live sync between
devices. Don't reopen this without new information — it was a deliberate,
numbers-backed decision, not an oversight.

**Why:** using Drive snapshot-backup as if it were sync would silently
overwrite one device's data with another's on conflict (e.g. two devices
selling the same stock offline) — exactly the class of silent data corruption
this project's whole testing discipline exists to prevent. Real multi-device
sync needs either a real backend (Firebase/Supabase) or a hand-built
conflict-resolution protocol — genuinely new architecture, not a small
addition.

**Estimated cost comparison** (for reference if this gets revisited):
Path 1 (v1 now, sync as a deliberate v2 later) ≈ 220-230 hrs to a real
usable v1, +60-100 hrs for v2 sync whenever taken on. Path 2 (build sync in
now) ≈ 340-370 hrs before anything ships — 3+ weeks later for the *first*
usable version, with roughly the same eventual total either way. Path 1 wins
because it gets real usage feedback ~3 weeks sooner, which should inform what
v2 sync actually needs rather than guessing now.

**Migration note for whenever v2 happens:** smaller than it might sound —
Phase 5's Drive backup work already requires a full-database export function;
migrating to a real backend later mostly means pointing that same export at a
different destination, plus a new import routine and one cutover dry-run.
Given the business's small data volume (a shop's worth of daily transactions),
this is a one-time mechanical migration (~10-20 hrs), not an ongoing cost —
already folded into the v2 estimate above, not an extra surprise on top of it.

## Testing strategy

Per the project plan: cut UI polish before cutting tests, since ledger/
inventory bugs silently corrupt real business data. Scoped as:

- **Unit tests** for pure functions (weight/stock math, bill totals,
  aging-bucket math, balance derivation)
- **Integration tests** for transaction-boundary code (`inventory.quantity`
  writes via restock/sale/return, payment allocation, return) — these are the
  highest-stakes spots in the app
- **Skipped for now**: UI component tests, end-to-end tests — not worth it
  before the Phase 6 UI polish pass

Run `npm run test`. Currently 112 tests passing across the data-layer and
backup test files (`inventory`, `inventory-update`, `restock`, `sales`,
`retailers`, `payments`, `returns`, `aging`, `invoices`, `db-snapshot`,
`backup-state`, `drive`, `scheduler`).

## Known gotchas

- **Vite's TS template requires type-only imports** for anything imported
  purely as a type alongside real values (`verbatimModuleSyntax`). If you see
  `TS1484`, split the import: `import { openDB } from 'idb'` +
  `import type { DBSchema } from 'idb'`.
- **`vite.config.ts` must import `defineConfig` from `'vitest/config'`**, not
  `'vite'`, or TypeScript won't recognize the `test` field.
- **Test files must be excluded from the production type-check** —
  `tsconfig.app.json` has `"exclude": ["src/**/*.test.ts"]`.
- **Production build required to test PWA behavior** — `npm run dev` does not
  activate the service worker; use `npm run build && npm run preview`.
- **Raw `Date.now()` isn't safe for anything that orders records by
  timestamp.** Two records created in the same millisecond get identical
  timestamps, and sort order between ties falls back to unspecified index
  behavior — not creation order. This broke FIFO payment allocation in
  testing (two sales created back-to-back tied on `date`, and the "oldest
  first" allocation picked the wrong one). Fixed with a monotonic clock
  (`src/db/clock.ts`) — use `monotonicNow()` instead of `Date.now()` for any
  stored `date`/`createdAt` field, anywhere in the app.
