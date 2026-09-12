import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

export interface WholesaleDB extends DBSchema {
  retailers: {
    key: string;
    value: {
      id: string;
      name: string;
      phone?: string;
      address?: string;
      creditLimit: number;
      createdAt: number;
    };
    indexes: { 'by-name': string };
  };

  // Inventory.quantity is a CACHED running total — never edited directly.
  // It only changes inside the same transaction as a Sale, Restock, or
  // Return write. Cost price lives on Restock (sourced at different
  // times/prices), not here — this only holds a default sale-facing price.
  //
  // Stock is counted in "base units" of whole bag/packet, and every product
  // has a mandatory weight in kg per unit. Selling is by weight: the bill
  // shows qty (bags/packets) × weight per unit = gross weight, priced at
  // ₹/kg (marketPrice). Gross price = gross weight × ₹/kg.
  inventory: {
    key: string;
    value: {
      id: string;
      productName: string;
      baseUnit: 'bag' | 'packet';
      weightPerUnitKg: number; // mandatory, > 0 — e.g. 50 means 1 bag = 50 kg
      quantity: number; // number of bag/packet units
      marketPrice: number; // default ₹/kg price, overridable per bill line
      createdAt: number;
    };
    indexes: { 'by-name': string };
  };

  // Immutable once created — only 'cancelled' via status flag, or
  // countered by a separate Return record. Never edited otherwise.
  sales: {
    key: string;
    value: {
      id: string;
      saleType: 'CASH' | 'RETAIL';
      buyerName?: string; // required if CASH
      retailerId?: string; // required if RETAIL
      date: number;
      items: {
        inventoryId: string;
        unit: string; // 'bag' | 'packet' — copied from the product at sale time
        quantity: number; // number of units (bags/packets)
        weightPerUnitKg: number; // snapshotted kg per unit, so bill math is stable
        salePrice: number; // per-kg price, snapshotted — may differ from marketPrice
      }[];
      totalAmount: number;
      status: 'active' | 'cancelled';
      amountPaid: number; // updated as payments allocate against this sale
      paymentStatus: 'unpaid' | 'partial' | 'paid';
      createdAt: number;
    };
    indexes: {
      'by-retailer': string;
      'by-date': number;
      'by-status': string;
      'by-payment-status': string;
    };
  };

  restock: {
    key: string;
    value: {
      id: string;
      date: number;
      items: {
        inventoryId: string;
        unit: string;
        quantity: number;
        costPricePerUnit: number; // sourced at different times/prices, so per-batch
      }[];
      totalCost: number;
      createdAt: number;
    };
    indexes: { 'by-date': number };
  };

  returns: {
    key: string;
    value: {
      id: string;
      saleId: string;
      items: { inventoryId: string; unit: string; quantity: number }[];
      refundAmount: number;
      reason: string;
      date: number;
    };
    indexes: { 'by-sale': string };
  };

  // allocations stored inline — no separate join table. Each entry
  // says how much of this payment applied to which sale.
  payments: {
    key: string;
    value: {
      id: string;
      retailerId: string;
      amount: number;
      method: 'cash' | 'upi' | 'cheque' | 'other';
      allocations: { saleId: string; amountApplied: number }[];
      date: number;
    };
    indexes: { 'by-retailer': string; 'by-date': number };
  };

  // Bill / invoice numbers, assigned once per sale at first print and
  // reused on every reprint — a printed bill number must stay stable.
  invoices: {
    key: string; // saleId — one invoice number per sale
    value: {
      saleId: string;
      invoiceNumber: number;
      createdAt: number;
    };
  };

  // sequential counters (e.g. the invoice-number sequence)
  counters: {
    key: string; // counter id, e.g. 'invoiceNumber'
    value: { id: string; value: number };
  };

  // Backup persistence state + OAuth tokens. Grows with v3 (Phase 5).
  // Separate records keyed by purpose rather than one big document, so a
  // token refresh doesn't rewrite the whole backup ledger (and vice versa).
  backup: {
    key: string; // e.g. 'state', 'google-token', 'pkce'
    value: {
      id: string;
      [key: string]: number | string | boolean | undefined;
    };
  };
}

const DB_NAME = 'wholesale-app-db';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<WholesaleDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<WholesaleDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WholesaleDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('retailers')) {
          const retailers = db.createObjectStore('retailers', { keyPath: 'id' });
          retailers.createIndex('by-name', 'name');
        }

        if (!db.objectStoreNames.contains('inventory')) {
          const inventory = db.createObjectStore('inventory', { keyPath: 'id' });
          inventory.createIndex('by-name', 'productName');
        }

        if (!db.objectStoreNames.contains('sales')) {
          const sales = db.createObjectStore('sales', { keyPath: 'id' });
          sales.createIndex('by-retailer', 'retailerId');
          sales.createIndex('by-date', 'date');
          sales.createIndex('by-status', 'status');
          sales.createIndex('by-payment-status', 'paymentStatus');
        }

        if (!db.objectStoreNames.contains('restock')) {
          const restock = db.createObjectStore('restock', { keyPath: 'id' });
          restock.createIndex('by-date', 'date');
        }

        if (!db.objectStoreNames.contains('returns')) {
          const returns = db.createObjectStore('returns', { keyPath: 'id' });
          returns.createIndex('by-sale', 'saleId');
        }

        if (!db.objectStoreNames.contains('payments')) {
          const payments = db.createObjectStore('payments', { keyPath: 'id' });
          payments.createIndex('by-retailer', 'retailerId');
          payments.createIndex('by-date', 'date');
        }

        if (!db.objectStoreNames.contains('invoices')) {
          db.createObjectStore('invoices', { keyPath: 'saleId' });
        }

        if (!db.objectStoreNames.contains('counters')) {
          db.createObjectStore('counters', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('backup')) {
          db.createObjectStore('backup', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// for tests, and any future "reset local data" feature
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

/**
 * Destroys every store on this device and returns the app to a clean slate.
 * Used by the in-app "Erase all local data" button — the iPhone home-screen
 * webapp has no built-in Safari menu to clear site data, so this is the
 * only reliable way to exercise the restore path (Phase 5) or bail out of a
 * misconfigured state. Also wipes the Google token, so Drive requires a
 * fresh sign-in afterwards.
 */
export async function resetLocalData(): Promise<void> {
  await closeDB();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // If another tab holds the DB open, deletion stays blocked. We only
    // have one app instance per tab; if it ever blocks, forget it and let
    // the caller surface the failure.
    req.onblocked = () => reject(new Error('Another tab is keeping the database open.'));
  });
}
