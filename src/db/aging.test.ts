import { describe, it, expect, afterEach } from 'vitest';
import { getDB, closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale } from './sales';
import { createRetailer } from './retailers';
import { createPayment } from './payments';
import { getAgingReport } from './aging';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

const DAY = 24 * 60 * 60 * 1000;

async function setupProduct() {
  const item = await createInventoryItem({
    productName: 'Rice',
    baseUnit: 'kg',
    unitConversions: {},
    marketPrice: 60,
  });
  await createRestock({
    items: [{ inventoryId: item.id, unit: 'kg', quantity: 1000, costPricePerUnit: 40 }],
  });
  return item;
}

describe('getAgingReport', () => {
  it('excludes retailers with no outstanding balance', async () => {
    const retailer = await createRetailer({ name: 'Paid Up Traders', creditLimit: 10000 });
    const item = await setupProduct();
    await createSale({
      saleType: 'RETAIL',
      retailerId: retailer.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }],
    });
    await createPayment(retailer.id, 300, 'cash'); // fully settles it

    const report = await getAgingReport();
    expect(report.find((r) => r.retailerId === retailer.id)).toBeUndefined();
  });

  it('buckets a sale correctly based on days outstanding', async () => {
    const retailer = await createRetailer({ name: 'Old Debt Traders', creditLimit: 10000 });
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: retailer.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }],
    });

    // simulate "20 days later" by passing an explicit asOf timestamp
    const asOf = sale.date + 20 * DAY;
    const report = await getAgingReport(asOf);

    const entry = report.find((r) => r.retailerId === retailer.id);
    expect(entry?.entries[0].bucket).toBe('15+');
    expect(entry?.entries[0].daysOld).toBe(20);
  });

  it('computes totalOutstanding as the sum of unpaid amounts, not full sale totals', async () => {
    const retailer = await createRetailer({ name: 'Partial Payer', creditLimit: 10000 });
    const item = await setupProduct();
    await createSale({
      saleType: 'RETAIL',
      retailerId: retailer.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    }); // 600
    await createPayment(retailer.id, 400, 'cash'); // leaves 200 outstanding

    const report = await getAgingReport();
    const entry = report.find((r) => r.retailerId === retailer.id);
    expect(entry?.totalOutstanding).toBe(200);
  });

  it('sorts retailers with the most overdue bucket first', async () => {
    const item = await setupProduct();
    const mild = await createRetailer({ name: 'Mildly Late', creditLimit: 10000 });
    const severe = await createRetailer({ name: 'Very Late', creditLimit: 10000 });

    const mildSale = await createSale({
      saleType: 'RETAIL',
      retailerId: mild.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }],
    });
    const severeSale = await createSale({
      saleType: 'RETAIL',
      retailerId: severe.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }],
    });

    // Directly control each sale's age rather than relying on incidental
    // timing between two createSale() calls a few milliseconds apart —
    // that's the actual condition under test, not something to leave to chance.
    const referencePoint = Date.now();
    const db = await getDB();
    const mildRecord = await db.get('sales', mildSale.id);
    const severeRecord = await db.get('sales', severeSale.id);
    await db.put('sales', { ...mildRecord!, date: referencePoint - 2 * DAY }); // 2 days old → current
    await db.put('sales', { ...severeRecord!, date: referencePoint - 40 * DAY }); // 40 days old → 30+

    const report = await getAgingReport(referencePoint);

    expect(report[0].retailerId).toBe(severe.id);
  });

  it('multiple unpaid sales for the same retailer are sorted oldest-first within entries', async () => {
    const retailer = await createRetailer({ name: 'Multi Sale Traders', creditLimit: 10000 });
    const item = await setupProduct();
    const saleA = await createSale({
      saleType: 'RETAIL',
      retailerId: retailer.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }],
    });
    const saleB = await createSale({
      saleType: 'RETAIL',
      retailerId: retailer.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5, salePrice: 60 }],
    });

    const report = await getAgingReport();
    const entry = report.find((r) => r.retailerId === retailer.id);
    expect(entry?.entries[0].saleId).toBe(saleA.id);
    expect(entry?.entries[1].saleId).toBe(saleB.id);
  });
});
