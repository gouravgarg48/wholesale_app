import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { assertSellableUnit } from './inventory';
import { generateId } from './id';
import { monotonicNow } from './clock';

type ReturnItemInput = { inventoryId: string; unit: string; quantity: number };
type ReturnInput = { saleId: string; items: ReturnItemInput[]; reason: string };
type ReturnRecord = WholesaleDB['returns']['value'];

/**
 * Pure calculation, no DB access — this is what's actually shared between
 * createReturn() and getReturnableQuantities(), NOT a function that reads
 * the database itself. Sharing a DB-reading function across two different
 * transaction contexts is what caused the original bug: calling one
 * transaction's read function from inside a different active transaction
 * lets the original transaction go idle and auto-commit before we're done
 * with it.
 */
function computeRemainingReturnable(
  saleItems: { inventoryId: string; unit: string; quantity: number }[],
  priorReturnItemLists: { inventoryId: string; unit: string; quantity: number }[][],
): Map<string, number> {
  const alreadyReturned = new Map<string, number>();
  for (const items of priorReturnItemLists) {
    for (const item of items) {
      const key = `${item.inventoryId}:${item.unit}`;
      alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + item.quantity);
    }
  }

  const remaining = new Map<string, number>();
  for (const saleItem of saleItems) {
    const key = `${saleItem.inventoryId}:${saleItem.unit}`;
    remaining.set(key, saleItem.quantity - (alreadyReturned.get(key) ?? 0));
  }
  return remaining;
}

/**
 * Standalone read for the UI — safe to call on its own since it opens and
 * fully resolves its own transaction, not nested inside another one.
 */
export async function getReturnableQuantities(saleId: string): Promise<Map<string, number>> {
  const db = await getDB();
  const sale = await db.get('sales', saleId);
  if (!sale) {
    throw new Error(`Sale ${saleId} not found`);
  }
  const priorReturns = await db.getAllFromIndex('returns', 'by-sale', saleId);
  return computeRemainingReturnable(
    sale.items,
    priorReturns.map((r) => r.items),
  );
}

export async function createReturn(input: ReturnInput): Promise<ReturnRecord> {
  if (input.items.length === 0) {
    throw new Error('Return must include at least one item');
  }
  if (!input.reason.trim()) {
    throw new Error('A reason is required for a return');
  }

  const db = await getDB();
  const tx = db.transaction(['returns', 'inventory', 'sales'], 'readwrite');
  const returnsStore = tx.objectStore('returns');
  const inventoryStore = tx.objectStore('inventory');
  const salesStore = tx.objectStore('sales');

  try {
    const sale = await salesStore.get(input.saleId);
    if (!sale) {
      throw new Error(`Sale ${input.saleId} not found`);
    }
    if (sale.status !== 'active') {
      throw new Error('Cannot return items against a cancelled sale');
    }

    // Read prior returns through THIS transaction's own returnsStore, not
    // via getReturnableQuantities() — that's the fix, see comment above.
    const priorReturns = await returnsStore.index('by-sale').getAll(input.saleId);
    const remainingReturnable = computeRemainingReturnable(
      sale.items,
      priorReturns.map((r) => r.items),
    );

    let refundAmount = 0;

    for (const returnItem of input.items) {
      if (!Number.isFinite(returnItem.quantity) || returnItem.quantity <= 0) {
        throw new Error('Return quantity must be a positive number');
      }

      const saleItem = sale.items.find(
        (i) => i.inventoryId === returnItem.inventoryId && i.unit === returnItem.unit,
      );
      if (!saleItem) {
        throw new Error(
          `Sale did not include ${returnItem.quantity} ${returnItem.unit} of item ${returnItem.inventoryId}`,
        );
      }

      const key = `${returnItem.inventoryId}:${returnItem.unit}`;
      const remaining = remainingReturnable.get(key) ?? 0;

      if (returnItem.quantity > remaining) {
        throw new Error(
          `Cannot return ${returnItem.quantity} ${returnItem.unit} — only ${remaining} remaining returnable from this sale`,
        );
      }

      const inventoryItem = await inventoryStore.get(returnItem.inventoryId);
      if (!inventoryItem) {
        throw new Error(`Inventory item ${returnItem.inventoryId} not found`);
      }

      assertSellableUnit(inventoryItem, returnItem.unit);
      inventoryItem.quantity += returnItem.quantity;
      await inventoryStore.put(inventoryItem);

      refundAmount += returnItem.quantity * (saleItem.weightPerUnitKg ?? 1) * saleItem.salePrice;
    }

    if (sale.saleType === 'RETAIL') {
      sale.amountPaid = Math.min(sale.amountPaid + refundAmount, sale.totalAmount);
      sale.paymentStatus =
        sale.amountPaid >= sale.totalAmount ? 'paid' : sale.amountPaid > 0 ? 'partial' : 'unpaid';
      await salesStore.put(sale);
    }

    const returnRecord: ReturnRecord = {
      id: generateId(),
      saleId: input.saleId,
      items: input.items,
      refundAmount,
      reason: input.reason.trim(),
      date: monotonicNow(),
    };

    await returnsStore.add(returnRecord);
    await tx.done;

    return returnRecord;
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
