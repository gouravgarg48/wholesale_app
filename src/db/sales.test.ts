import { describe, it, expect, afterEach } from 'vitest';
import { getDB, closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale } from './sales';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('createSale', () => {
  it('decreases inventory quantity by the converted amount', async () => {
    const item = await createInventoryItem({
      productName: 'Basmati Rice',
      baseUnit: 'kg',
      unitConversions: { bag: 50 },
      marketPrice: 60,
    });
    await createRestock({ items: [{ inventoryId: item.id, unit: 'bag', quantity: 5, costPricePerUnit: 2000 }] });

    await createSale({
      saleType: 'CASH',
      buyerName: 'Walk-in customer',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 2, salePrice: 2500 }],
    });

    const db = await getDB();
    const updated = await db.get('inventory', item.id);
    expect(updated?.quantity).toBe(150); // 5 bags in - 2 bags out = 3 bags = 150kg
  });

  it('marks a CASH sale as fully paid immediately', async () => {
    const item = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
    await createRestock({ items: [{ inventoryId: item.id, unit: 'kg', quantity: 100, costPricePerUnit: 40 }] });

    const sale = await createSale({
      saleType: 'CASH',
      buyerName: 'Walk-in',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    expect(sale.paymentStatus).toBe('paid');
    expect(sale.amountPaid).toBe(sale.totalAmount);
  });

  it('marks a RETAIL sale as unpaid on creation', async () => {
    const item = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
    await createRestock({ items: [{ inventoryId: item.id, unit: 'kg', quantity: 100, costPricePerUnit: 40 }] });

    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'retailer-1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    expect(sale.paymentStatus).toBe('unpaid');
    expect(sale.amountPaid).toBe(0);
  });

  it('rejects a sale that exceeds available stock', async () => {
    const item = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
    await createRestock({ items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, costPricePerUnit: 40 }] });

    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [{ inventoryId: item.id, unit: 'kg', quantity: 999, salePrice: 60 }],
      })
    ).rejects.toThrow(/Insufficient stock/);

    // stock must be completely untouched after a rejected sale
    const db = await getDB();
    const unchanged = await db.get('inventory', item.id);
    expect(unchanged?.quantity).toBe(10);
  });

  it('rolls back ALL quantity changes if one item in a multi-item sale fails', async () => {
    const itemA = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
    const itemB = await createInventoryItem({ productName: 'Sugar', baseUnit: 'kg', unitConversions: {}, marketPrice: 45 });
    await createRestock({
      items: [
        { inventoryId: itemA.id, unit: 'kg', quantity: 100, costPricePerUnit: 40 },
        { inventoryId: itemB.id, unit: 'kg', quantity: 5, costPricePerUnit: 30 }, // deliberately low stock
      ],
    });

    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [
          { inventoryId: itemA.id, unit: 'kg', quantity: 50, salePrice: 60 }, // valid, processed first
          { inventoryId: itemB.id, unit: 'kg', quantity: 999, salePrice: 45 }, // fails: insufficient stock
        ],
      })
    ).rejects.toThrow();

    const db = await getDB();
    const unchangedA = await db.get('inventory', itemA.id);
    // itemA's deduction must be rolled back even though it succeeded
    // before itemB's failure was hit
    expect(unchangedA?.quantity).toBe(100);
  });

  it('rejects a CASH sale without a buyer name', async () => {
    const item = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
    await expect(
      createSale({ saleType: 'CASH', buyerName: '  ', items: [{ inventoryId: item.id, unit: 'kg', quantity: 1, salePrice: 60 }] })
    ).rejects.toThrow(/buyer name/);
  });

  it('rejects an empty items array', async () => {
    await expect(createSale({ saleType: 'CASH', buyerName: 'Test', items: [] })).rejects.toThrow();
  });
});