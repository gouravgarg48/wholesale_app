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
    ledger/              — (not yet built)
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

## Current state

**Phase 1 (foundation) — complete.** Scaffold, PWA + verified offline caching,
git/GitHub, folder structure, IndexedDB schema.

**Phase 2 (inventory core) — in progress.**

Done:
- Inventory CRUD: create, edit (`marketPrice`, `productName`,
  `unitConversions` only — `quantity`/`baseUnit` are not editable, enforced at
  the type level)
- Restock flow: data layer + UI, atomic transaction proven by tests
- Sale flow: data layer only (`src/db/sales.ts`), including the stock-check
  rule (can't sell more than exists) — **no UI yet**

Not yet built:
- [ ] Sale UI
- [ ] Retailer CRUD (needed before RETAIL sales are usable end-to-end through
      the UI)
- [ ] ESLint + Prettier compatibility (`eslint-config-prettier`) — low priority

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

Run `npm run test`. Currently 23 tests passing across `inventory`, `restock`,
and `sales` test files.

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