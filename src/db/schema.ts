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
  inventory: {
    key: string;
    value: {
      id: string;
      productName: string;
      baseUnit: 'kg' | 'bag' | 'quintal';
      unitConversions: Record<string, number>; // e.g. { bag: 50 } = 1 bag is 50 kg
      quantity: number; // always in baseUnit
      marketPrice: number; // default per-baseUnit price, overridable per bill line
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
        unit: string;
        quantity: number;
        salePrice: number; // per-bill price, snapshotted — may differ from marketPrice
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
}

const DB_NAME = 'wholesale-app-db';
const DB_VERSION = 1;

export async function getDB(): Promise<IDBPDatabase<WholesaleDB>> {
  return openDB<WholesaleDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const retailers = db.createObjectStore('retailers', { keyPath: 'id' });
      retailers.createIndex('by-name', 'name');

      const inventory = db.createObjectStore('inventory', { keyPath: 'id' });
      inventory.createIndex('by-name', 'productName');

      const sales = db.createObjectStore('sales', { keyPath: 'id' });
      sales.createIndex('by-retailer', 'retailerId');
      sales.createIndex('by-date', 'date');
      sales.createIndex('by-status', 'status');
      sales.createIndex('by-payment-status', 'paymentStatus');

      const restock = db.createObjectStore('restock', { keyPath: 'id' });
      restock.createIndex('by-date', 'date');

      const returns = db.createObjectStore('returns', { keyPath: 'id' });
      returns.createIndex('by-sale', 'saleId');

      const payments = db.createObjectStore('payments', { keyPath: 'id' });
      payments.createIndex('by-retailer', 'retailerId');
      payments.createIndex('by-date', 'date');
    },
  });
}