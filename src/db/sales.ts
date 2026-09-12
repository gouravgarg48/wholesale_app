import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { assertSellableUnit } from './inventory';
import { monotonicNow } from './clock';
import { generateId } from './id';

// salePrice is ₹ per kg (weight-based billing). quantity is in whole units
// (bag/packet); weightPerUnitKg is snapshotted here so bill math stays
// stable even if the product's weight or price changes later.
type SaleItemInput = {
  inventoryId: string;
  unit: string;
  quantity: number;
  salePrice: number;
};

type SaleInput =
  | { saleType: 'CASH'; buyerName: string; items: SaleItemInput[] }
  | { saleType: 'RETAIL'; retailerId: string; items: SaleItemInput[] };

type SaleRecord = WholesaleDB['sales']['value'];

export async function createSale(input: SaleInput): Promise<SaleRecord> {
  if (input.items.length === 0) {
    throw new Error('Sale must include at least one item');
  }

  if (input.saleType === 'CASH' && !input.buyerName.trim()) {
    throw new Error('Cash sale requires a buyer name');
  }
  if (input.saleType === 'RETAIL' && !input.retailerId) {
    throw new Error('Retail sale requires a retailer');
  }

  const db = await getDB();
  const tx = db.transaction(['sales', 'inventory'], 'readwrite');
  const salesStore = tx.objectStore('sales');
  const inventoryStore = tx.objectStore('inventory');

  try {
    let totalAmount = 0;
    const salesItems: (SaleItemInput & { weightPerUnitKg: number })[] = [];

    for (const item of input.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error('Sale quantity must be a positive number');
      }
      if (!Number.isFinite(item.salePrice) || item.salePrice < 0) {
        throw new Error('Sale price cannot be negative');
      }

      const inventoryItem = await inventoryStore.get(item.inventoryId);
      if (!inventoryItem) {
        throw new Error(`Inventory item ${item.inventoryId} not found`);
      }

      assertSellableUnit(inventoryItem, item.unit);

      const grossWeightKg = item.quantity * inventoryItem.weightPerUnitKg;

      // The one genuinely new business rule vs restock: can't sell what
      // isn't there. Checked inside the transaction so it's evaluated
      // against the current committed state, not a stale read from before
      // some other write happened.
      if (item.quantity > inventoryItem.quantity) {
        throw new Error(
          `Insufficient stock for "${inventoryItem.productName}": have ${inventoryItem.quantity} ${inventoryItem.baseUnit}, need ${item.quantity}`,
        );
      }

      inventoryItem.quantity -= item.quantity;
      await inventoryStore.put(inventoryItem);

      salesItems.push({
        inventoryId: item.inventoryId,
        unit: item.unit,
        quantity: item.quantity,
        weightPerUnitKg: inventoryItem.weightPerUnitKg,
        salePrice: item.salePrice,
      });

      totalAmount += grossWeightKg * item.salePrice;
    }

    const saleRecord: SaleRecord = {
      id: generateId(),
      saleType: input.saleType,
      buyerName: input.saleType === 'CASH' ? input.buyerName.trim() : undefined,
      retailerId: input.saleType === 'RETAIL' ? input.retailerId : undefined,
      date: monotonicNow(),
      items: salesItems,
      totalAmount,
      status: 'active',
      // CASH sales are paid in full at time of sale, by definition (no ledger).
      // RETAIL sales start unpaid until a payment allocates against them.
      amountPaid: input.saleType === 'CASH' ? totalAmount : 0,
      paymentStatus: input.saleType === 'CASH' ? 'paid' : 'unpaid',
      createdAt: monotonicNow(),
    };

    await salesStore.add(saleRecord);
    await tx.done;

    return saleRecord;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // already finished/aborted
    }
    tx.done.catch(() => {});
    throw err;
  }
}

/**
 * A retailer's current balance is derived, not stored — sum of
 * (totalAmount - amountPaid) across their active sales. Cancelled sales
 * don't count toward balance.
 */
export async function getRetailerBalance(retailerId: string): Promise<number> {
  const db = await getDB();
  const sales = await db.getAllFromIndex('sales', 'by-retailer', retailerId);
  return sales
    .filter((s) => s.status === 'active')
    .reduce((sum, s) => sum + (s.totalAmount - s.amountPaid), 0);
}

export async function listSales(): Promise<SaleRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('sales', 'by-date');
  return all.reverse(); // most recent first
}
