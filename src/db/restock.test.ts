import { describe, it, expect, afterEach } from 'vitest';
import { getDB, closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('createRestock', () => {
  it('increases inventory quantity by the converted amount', async () => {
    const item = await createInventoryItem({
      productName: 'Basmati Rice',
      baseUnit: 'kg',
      unitConversions: { bag: 50 },
      marketPrice: 60,
    });

    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 2, costPricePerUnit: 2000 }],
    });

    const db = await getDB();
    const updated = await db.get('inventory', item.id);
    expect(updated?.quantity).toBe(100); // 2 bags * 50kg
  });

  it('computes totalCost correctly across multiple items', async () => {
    const itemA = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
    const itemB = await createInventoryItem({ productName: 'Sugar', baseUnit: 'kg', unitConversions: {}, marketPrice: 45 });

    const restock = await createRestock({
      items: [
        { inventoryId: itemA.id, unit: 'kg', quantity: 100, costPricePerUnit: 40 },
        { inventoryId: itemB.id, unit: 'kg', quantity: 50, costPricePerUnit: 35 },
      ],
    });

    expect(restock.totalCost).toBe(100 * 40 + 50 * 35);
  });

  it('rolls back ALL quantity changes if one item in the batch is invalid', async () => {
    const itemA = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });

    await expect(
      createRestock({
        items: [
          { inventoryId: itemA.id, unit: 'kg', quantity: 100, costPricePerUnit: 40 },
          { inventoryId: 'does-not-exist', unit: 'kg', quantity: 10, costPricePerUnit: 10 },
        ],
      })
    ).rejects.toThrow();

    const db = await getDB();
    const unchanged = await db.get('inventory', itemA.id);
    // itemA processed successfully BEFORE the failure — this proves the
    // transaction actually rolled it back, not just that the function threw
    expect(unchanged?.quantity).toBe(0);
  });

  it('rejects a NaN quantity or cost price and leaves stock untouched', async () => {
    const item = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });

    await expect(
      createRestock({ items: [{ inventoryId: item.id, unit: 'kg', quantity: NaN, costPricePerUnit: 40 }] })
    ).rejects.toThrow(/positive number/);
    await expect(
      createRestock({ items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, costPricePerUnit: NaN }] })
    ).rejects.toThrow(/cannot be negative/);

    const db = await getDB();
    const unchanged = await db.get('inventory', item.id);
    expect(unchanged?.quantity).toBe(0);
  });

  it('rejects an empty items array', async () => {
    await expect(createRestock({ items: [] })).rejects.toThrow();
  });
});