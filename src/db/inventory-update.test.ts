import { describe, it, expect, afterEach } from 'vitest';
import { closeDB } from './schema';
import { createInventoryItem, updateInventoryItem } from './inventory';
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

async function makeItem() {
  return createInventoryItem({
    productName: 'Rice',
    baseUnit: 'bag',
    weightPerUnitKg: 50,
    marketPrice: 60,
  });
}

describe('updateInventoryItem', () => {
  it('updates market price (₹/kg) without touching quantity', async () => {
    const item = await makeItem();
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 100, costPricePerUnit: 40 }],
    });

    const updated = await updateInventoryItem(item.id, { marketPrice: 65 });

    expect(updated.marketPrice).toBe(65);
    expect(updated.quantity).toBe(100); // unchanged
  });

  it('updates weight per unit', async () => {
    const item = await makeItem();

    const updated = await updateInventoryItem(item.id, { weightPerUnitKg: 60 });

    expect(updated.weightPerUnitKg).toBe(60);
  });

  it('rejects a non-positive market price', async () => {
    const item = await makeItem();
    await expect(updateInventoryItem(item.id, { marketPrice: 0 })).rejects.toThrow();
    await expect(updateInventoryItem(item.id, { marketPrice: -5 })).rejects.toThrow();
  });

  it('rejects a non-positive weight per unit', async () => {
    const item = await makeItem();
    await expect(updateInventoryItem(item.id, { weightPerUnitKg: 0 })).rejects.toThrow();
    await expect(updateInventoryItem(item.id, { weightPerUnitKg: -5 })).rejects.toThrow();
  });

  it('rejects an empty product name', async () => {
    const item = await makeItem();
    await expect(updateInventoryItem(item.id, { productName: '   ' })).rejects.toThrow();
  });

  it('throws for a nonexistent item', async () => {
    await expect(updateInventoryItem('does-not-exist', { marketPrice: 10 })).rejects.toThrow();
  });
});