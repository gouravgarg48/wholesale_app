import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { assertSellableUnit } from './inventory';
import { monotonicNow } from './clock';
import { generateId } from './id';

type RestockInput = {
  items: { inventoryId: string; unit: string; quantity: number; costPricePerUnit: number }[];
};

type RestockRecord = WholesaleDB['restock']['value'];

export async function createRestock(input: RestockInput): Promise<RestockRecord> {
  if (input.items.length === 0) {
    throw new Error('Restock must include at least one item');
  }

  const db = await getDB();
  const tx = db.transaction(['restock', 'inventory'], 'readwrite');
  const restockStore = tx.objectStore('restock');
  const inventoryStore = tx.objectStore('inventory');

  try {
    let totalCost = 0;

    for (const item of input.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error('Restock quantity must be a positive number');
      }
      if (!Number.isFinite(item.costPricePerUnit) || item.costPricePerUnit < 0) {
        throw new Error('Restock cost price cannot be negative');
      }

      const inventoryItem = await inventoryStore.get(item.inventoryId);
      if (!inventoryItem) {
        throw new Error(`Inventory item ${item.inventoryId} not found`);
      }

      assertSellableUnit(inventoryItem, item.unit);
      inventoryItem.quantity += item.quantity;
      await inventoryStore.put(inventoryItem);

      totalCost += item.quantity * item.costPricePerUnit;
    }

    const restockRecord: RestockRecord = {
      id: generateId(),
      date: monotonicNow(),
      items: input.items,
      totalCost,
      createdAt: monotonicNow(),
    };

    await restockStore.add(restockRecord);
    await tx.done;

    return restockRecord;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // already finished/aborted — safe to ignore
    }
    // tx.abort() causes tx.done to reject with AbortError. We already have
    // the real error in `err` and are about to rethrow it below, so this
    // rejection is expected and handled — without this line, it surfaces
    // as an unhandled rejection even though the abort itself worked correctly.
    tx.done.catch(() => {});
    throw err;
  }
}
