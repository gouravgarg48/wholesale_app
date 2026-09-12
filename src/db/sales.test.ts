import { describe, it, expect, afterEach } from 'vitest';
import { getDB, closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale, getRetailerBalance } from './sales';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

async function makeItem(name: string, weightPerUnitKg: number, marketPrice: number) {
  return createInventoryItem({
    productName: name,
    baseUnit: 'bag',
    weightPerUnitKg,
    marketPrice,
  });
}

describe('createSale', () => {
  it('decreases inventory quantity by the number of units sold', async () => {
    const item = await makeItem('Basmati Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 5, costPricePerUnit: 2000 }],
    });

    await createSale({
      saleType: 'CASH',
      buyerName: 'Walk-in customer',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 2, salePrice: 60 }],
    });

    const db = await getDB();
    const updated = await db.get('inventory', item.id);
    expect(updated?.quantity).toBe(3); // 5 bags in - 2 bags out
  });

  it('snapshots weight per unit onto the sale item for stable bill math', async () => {
    const item = await makeItem('Basmati Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 5, costPricePerUnit: 2000 }],
    });

    const sale = await createSale({
      saleType: 'CASH',
      buyerName: 'Walk-in customer',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 2, salePrice: 60 }],
    });

    expect(sale.items[0].weightPerUnitKg).toBe(50);
    expect(sale.totalAmount).toBe(2 * 50 * 60); // 2 bags = 100 kg @ ₹60/kg
  });

  it('marks a CASH sale as fully paid immediately', async () => {
    const item = await makeItem('Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 100, costPricePerUnit: 40 }],
    });

    const sale = await createSale({
      saleType: 'CASH',
      buyerName: 'Walk-in',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });

    expect(sale.paymentStatus).toBe('paid');
    expect(sale.amountPaid).toBe(sale.totalAmount);
    expect(sale.totalAmount).toBe(10 * 50 * 60);
  });

  it('marks a RETAIL sale as unpaid on creation', async () => {
    const item = await makeItem('Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 100, costPricePerUnit: 40 }],
    });

    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'retailer-1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });

    expect(sale.paymentStatus).toBe('unpaid');
    expect(sale.amountPaid).toBe(0);
  });

  it('rejects a sale that exceeds available stock', async () => {
    const item = await makeItem('Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, costPricePerUnit: 40 }],
    });

    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [{ inventoryId: item.id, unit: 'bag', quantity: 999, salePrice: 60 }],
      }),
    ).rejects.toThrow(/Insufficient stock/);

    // stock must be completely untouched after a rejected sale
    const db = await getDB();
    const unchanged = await db.get('inventory', item.id);
    expect(unchanged?.quantity).toBe(10);
  });

  it('rejects a unit that is not the product base unit', async () => {
    const item = await makeItem('Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, costPricePerUnit: 40 }],
    });

    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [{ inventoryId: item.id, unit: 'kg', quantity: 1, salePrice: 60 }],
      }),
    ).rejects.toThrow();
  });

  it('rolls back ALL quantity changes if one item in a multi-item sale fails', async () => {
    const itemA = await makeItem('Rice', 50, 60);
    const itemB = await makeItem('Sugar', 50, 45);
    await createRestock({
      items: [
        { inventoryId: itemA.id, unit: 'bag', quantity: 100, costPricePerUnit: 40 },
        { inventoryId: itemB.id, unit: 'bag', quantity: 5, costPricePerUnit: 30 }, // deliberately low stock
      ],
    });

    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [
          { inventoryId: itemA.id, unit: 'bag', quantity: 50, salePrice: 60 }, // valid, processed first
          { inventoryId: itemB.id, unit: 'bag', quantity: 999, salePrice: 45 }, // fails: insufficient stock
        ],
      }),
    ).rejects.toThrow();

    const db = await getDB();
    const unchangedA = await db.get('inventory', itemA.id);
    expect(unchangedA?.quantity).toBe(100);
  });

  it('rejects a CASH sale without a buyer name', async () => {
    const item = await makeItem('Rice', 50, 60);
    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: '  ',
        items: [{ inventoryId: item.id, unit: 'bag', quantity: 1, salePrice: 60 }],
      }),
    ).rejects.toThrow(/buyer name/);
  });

  it('rejects a NaN quantity or price instead of corrupting stock', async () => {
    const item = await makeItem('Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 100, costPricePerUnit: 40 }],
    });

    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [{ inventoryId: item.id, unit: 'bag', quantity: NaN, salePrice: 60 }],
      }),
    ).rejects.toThrow(/positive number/);
    await expect(
      createSale({
        saleType: 'CASH',
        buyerName: 'Walk-in',
        items: [{ inventoryId: item.id, unit: 'bag', quantity: 1, salePrice: NaN }],
      }),
    ).rejects.toThrow(/cannot be negative/);

    const db = await getDB();
    const unchanged = await db.get('inventory', item.id);
    expect(unchanged?.quantity).toBe(100);
  });

  it('rejects an empty items array', async () => {
    await expect(createSale({ saleType: 'CASH', buyerName: 'Test', items: [] })).rejects.toThrow();
  });
});

describe('getRetailerBalance', () => {
  it('sums unpaid amounts across active sales for a retailer', async () => {
    const item = await makeItem('Rice', 50, 60);
    await createRestock({
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 100, costPricePerUnit: 40 }],
    });

    await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });
    await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 5, salePrice: 60 }],
    });

    const balance = await getRetailerBalance('r1');
    expect(balance).toBe(10 * 50 * 60 + 5 * 50 * 60);
  });

  it('returns 0 for a retailer with no sales', async () => {
    expect(await getRetailerBalance('nobody')).toBe(0);
  });
});