import { describe, it, expect, afterEach } from 'vitest';
import { closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale } from './sales';
import { assignInvoiceNumber, getInvoiceNumberForSale } from './invoices';

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
  const item = await createInventoryItem({
    productName: 'Rice',
    baseUnit: 'bag',
    weightPerUnitKg: 50,
    marketPrice: 60,
  });
  await createRestock({
    items: [{ inventoryId: item.id, unit: 'bag', quantity: 1000, costPricePerUnit: 40 }],
  });
  return item;
}

describe('assignInvoiceNumber', () => {
  it('issues sequential numbers starting at 1', async () => {
    const item = await setupProduct();
    const saleA = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });
    const saleB = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 5, salePrice: 60 }],
    });

    await expect(assignInvoiceNumber(saleA.id)).resolves.toBe(1);
    await expect(assignInvoiceNumber(saleB.id)).resolves.toBe(2);
  });

  it('returns the same number for the same sale on reprint', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });

    const first = await assignInvoiceNumber(sale.id);
    await expect(assignInvoiceNumber(sale.id)).resolves.toBe(first);
  });

  it('persists the number so it survives across connections', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });

    const number = await assignInvoiceNumber(sale.id);
    await closeDB();

    await expect(getInvoiceNumberForSale(sale.id)).resolves.toBe(number);
  });
});

describe('getInvoiceNumberForSale', () => {
  it('returns undefined for a sale that was never printed', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });

    await expect(getInvoiceNumberForSale(sale.id)).resolves.toBeUndefined();
  });

  it('does not advance the sequence — it is a read-only lookup', async () => {
    const item = await setupProduct();
    const saleA = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 10, salePrice: 60 }],
    });
    const saleB = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'bag', quantity: 5, salePrice: 60 }],
    });

    await assignInvoiceNumber(saleA.id);
    await getInvoiceNumberForSale(saleB.id); // must not consume sequence slot #2

    await expect(assignInvoiceNumber(saleB.id)).resolves.toBe(2);
  });
});
