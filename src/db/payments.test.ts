import { describe, it, expect, afterEach } from 'vitest';
import { getDB, closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale } from './sales';
import { createPayment } from './payments';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

async function setupProduct() {
  const item = await createInventoryItem({ productName: 'Rice', baseUnit: 'kg', unitConversions: {}, marketPrice: 60 });
  await createRestock({ items: [{ inventoryId: item.id, unit: 'kg', quantity: 1000, costPricePerUnit: 40 }] });
  return item;
}

describe('createPayment', () => {
  it('fully settles a single sale when payment covers it exactly', async () => {
    const item = await setupProduct();
    const sale = await createSale({ saleType: 'RETAIL', retailerId: 'r1', items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }] });

    await createPayment('r1', 600, 'cash');

    const db = await getDB();
    const updated = await db.get('sales', sale.id);
    expect(updated?.amountPaid).toBe(600);
    expect(updated?.paymentStatus).toBe('paid');
  });

  it('applies a partial payment correctly', async () => {
    const item = await setupProduct();
    const sale = await createSale({ saleType: 'RETAIL', retailerId: 'r1', items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }] });

    await createPayment('r1', 200, 'cash');

    const db = await getDB();
    const updated = await db.get('sales', sale.id);
    expect(updated?.amountPaid).toBe(200);
    expect(updated?.paymentStatus).toBe('partial');
  });

  it('allocates FIFO across multiple sales, oldest first', async () => {
    const item = await setupProduct();
    const saleA = await createSale({ saleType: 'RETAIL', retailerId: 'r1', items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }] }); // 300
    const saleB = await createSale({ saleType: 'RETAIL', retailerId: 'r1', items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }] }); // 300

    // enough to fully pay saleA and partially pay saleB
    const payment = await createPayment('r1', 400, 'upi');

    const db = await getDB();
    const updatedA = await db.get('sales', saleA.id);
    const updatedB = await db.get('sales', saleB.id);

    expect(updatedA?.paymentStatus).toBe('paid');
    expect(updatedB?.paymentStatus).toBe('partial');
    expect(updatedB?.amountPaid).toBe(100);
    expect(payment.allocations).toEqual([
      { saleId: saleA.id, amountApplied: 300 },
      { saleId: saleB.id, amountApplied: 100 },
    ]);
  });

  it('rejects a payment exceeding total owed', async () => {
    const item = await setupProduct();
    await createSale({ saleType: 'RETAIL', retailerId: 'r1', items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }] }); // 300

    await expect(createPayment('r1', 500, 'cash')).rejects.toThrow(/exceeds total owed/);
  });

  it('skips already-paid sales and CASH sales when allocating', async () => {
    const item = await setupProduct();
    await createSale({ saleType: 'CASH', buyerName: 'Walk-in', items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }] });
    const retailSale = await createSale({ saleType: 'RETAIL', retailerId: 'r1', items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }] });

    const payment = await createPayment('r1', 300, 'cash');

    expect(payment.allocations).toEqual([{ saleId: retailSale.id, amountApplied: 300 }]);
  });

  it('rejects a non-positive amount', async () => {
    await expect(createPayment('r1', 0, 'cash')).rejects.toThrow();
    await expect(createPayment('r1', -50, 'cash')).rejects.toThrow();
  });

  it('rejects a payment when the retailer has nothing owed', async () => {
    await expect(createPayment('nobody', 100, 'cash')).rejects.toThrow(/exceeds total owed/);
  });
});