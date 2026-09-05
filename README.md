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
```

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

### Folder structure

```
src/
  db/                    — schema + all IndexedDB access (data layer)
  features/
    inventory/           — inventory list, add-product, restock UI
    ledger/              — retailers, sales, payments UI
    billing/             — (not yet built)
  components/            — shared UI (not yet populated)
```

## Data model

Full schema in `src/db/schema.ts`. Key design points:

- **Sales are immutable once created.** Each line item snapshots its own
  `salePrice` at time of sale — later price changes never affect historical
  bills. Cancellation is a status flag, not an edit; corrections happen via a
  separate `Return` record.
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
- **`baseUnit` is not editable after creation** — quantity is stored as a raw
  number in that unit; changing it later would silently reinterpret existing
  stock. Delete and recreate the product instead if the unit was wrong.
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
- Inventory CRUD: create, edit (`marketPrice`, `productName`,
  `unitConversions` only — `quantity`/`baseUnit` are not editable, enforced at
  the type level)
- Restock flow: data layer + UI, atomic transaction proven by tests
- Sale flow: data layer + UI, CASH/RETAIL types, stock-check rule (can't sell
  more than exists)
- Retailer CRUD: data layer + UI, including live balance shown per retailer
  (derived from unpaid sales, not stored)

**Phase 3 (ledger core) — in progress.**

Done:
- Payment entry: FIFO allocation across a retailer's oldest unpaid sales
  first, updates each sale's `amountPaid`/`paymentStatus`, atomic transaction
  proven by tests (including an exact-split case across two sales)

Done (continued):
- Aging report: buckets each retailer's unpaid sales by days outstanding
  (current / 7+ / 15+ / 30+), sorted worst-bucket-first so the most overdue
  retailers surface at the top

Not yet built:
- [ ] Cancel/return flow (`createReturn()` — reverses a sale's amount, restores
      inventory atomically)
- [ ] ESLint + Prettier compatibility (`eslint-config-prettier`) — low priority

## Outstanding: real-device phone install check

**In progress, not yet confirmed.** This was actually part of Phase 1's
original checkpoint ("app shell installs on your phone... opens offline") but
was only ever verified via desktop DevTools network throttling, never on an
actual phone. Currently mid-flow:

- [x] `npm run build` then `npm run preview -- --host` (serves on the local
      network, not just localhost — confirmed working)
- [ ] Open the network URL on phone (same Wi-Fi required)
- [ ] Add to home screen (Android Chrome / iOS Safari)
- [ ] Launch from home-screen icon, confirm standalone (no browser chrome)
- [ ] **The actual checkpoint**: airplane mode on the phone, confirm app shell
      still loads and is navigable

Resume from "open the network URL on phone" next session.

## Testing strategy

Per the project plan: cut UI polish before cutting tests, since ledger/
inventory bugs silently corrupt real business data. Scoped as:

- **Unit tests** for pure functions (unit conversion, later: bill totals,
  aging-bucket math, balance derivation)
- **Integration tests** for transaction-boundary code (`inventory.quantity`
  writes via restock/sale/return, payment allocation) — these are the
  highest-stakes spots in the app
- **Skipped for now**: UI component tests, end-to-end tests — not worth it
  before the Phase 6 UI polish pass

Run `npm run test`. Currently 46 tests passing across `inventory`, `restock`,
`sales`, `retailers`, `payments`, and `aging` test files.

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
