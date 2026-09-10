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

describe('updateInventoryItem', () => {
  it('updates market price without touching quantity', async () => {
    const item = await createInventoryItem({
      productName: 'Rice',
      baseUnit: 'kg',
      unitConversions: {},
      marketPrice: 60,
    });
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 100, costPricePerUnit: 40 }],
    });

    const updated = await updateInventoryItem(item.id, { marketPrice: 65 });

    expect(updated.marketPrice).toBe(65);
    expect(updated.quantity).toBe(100); // unchanged
  });

  it('rejects a non-positive market price', async () => {
    const item = await createInventoryItem({
      productName: 'Rice',
      baseUnit: 'kg',
      unitConversions: {},
      marketPrice: 60,
    });
    await expect(updateInventoryItem(item.id, { marketPrice: 0 })).rejects.toThrow();
    await expect(updateInventoryItem(item.id, { marketPrice: -5 })).rejects.toThrow();
  });

  it('rejects an empty product name', async () => {
    const item = await createInventoryItem({
      productName: 'Rice',
      baseUnit: 'kg',
      unitConversions: {},
      marketPrice: 60,
    });
    await expect(updateInventoryItem(item.id, { productName: '   ' })).rejects.toThrow();
  });

  it('rejects a new unit conversion that collides with baseUnit', async () => {
    const item = await createInventoryItem({
      productName: 'Rice',
      baseUnit: 'kg',
      unitConversions: {},
      marketPrice: 60,
    });
    await expect(updateInventoryItem(item.id, { unitConversions: { kg: 1 } })).rejects.toThrow();
  });

  it('throws for a nonexistent item', async () => {
    await expect(updateInventoryItem('does-not-exist', { marketPrice: 10 })).rejects.toThrow();
  });
});
