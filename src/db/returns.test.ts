import { describe, it, expect, afterEach } from 'vitest';
import { getDB, closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale } from './sales';
import { createReturn } from './returns';

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
    baseUnit: 'kg',
    unitConversions: {},
    marketPrice: 60,
  });
  await createRestock({
    items: [{ inventoryId: item.id, unit: 'kg', quantity: 1000, costPricePerUnit: 40 }],
  });
  return item;
}

describe('createReturn', () => {
  it('restores inventory by the returned amount', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    await createReturn({
      saleId: sale.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 4 }],
      reason: 'Damaged bag',
    });

    const db = await getDB();
    const updatedItem = await db.get('inventory', item.id);
    expect(updatedItem?.quantity).toBe(1000 - 10 + 4); // restocked - sold + returned
  });

  it('computes refund using the sale-time price, not current market price', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 55 }],
    }); // sold below market price

    const ret = await createReturn({
      saleId: sale.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 4 }],
      reason: 'Wrong item',
    });

    expect(ret.refundAmount).toBe(4 * 55);
  });

  it("reduces a RETAIL sale's outstanding balance by the refund amount", async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    }); // 600 owed

    await createReturn({
      saleId: sale.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 5 }],
      reason: 'Excess order',
    }); // 300 credited

    const db = await getDB();
    const updated = await db.get('sales', sale.id);
    expect(updated?.amountPaid).toBe(300);
    expect(updated?.paymentStatus).toBe('partial');
  });

  it('does not touch amountPaid/paymentStatus for a CASH sale', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'CASH',
      buyerName: 'Walk-in',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    await createReturn({
      saleId: sale.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 3 }],
      reason: 'Customer changed mind',
    });

    const db = await getDB();
    const updated = await db.get('sales', sale.id);
    expect(updated?.paymentStatus).toBe('paid'); // unchanged
    expect(updated?.amountPaid).toBe(sale.totalAmount); // unchanged
  });

  it('rejects returning more than was sold', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    await expect(
      createReturn({
        saleId: sale.id,
        items: [{ inventoryId: item.id, unit: 'kg', quantity: 15 }],
        reason: 'Too many',
      }),
    ).rejects.toThrow(/remaining returnable/);
  });

  it('rejects a second return that would exceed what remains after a prior return', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    await createReturn({
      saleId: sale.id,
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 6 }],
      reason: 'First return',
    });

    // only 4 remain returnable; asking for 5 should fail
    await expect(
      createReturn({
        saleId: sale.id,
        items: [{ inventoryId: item.id, unit: 'kg', quantity: 5 }],
        reason: 'Second return',
      }),
    ).rejects.toThrow(/remaining returnable/);
  });

  it('rejects a return against a cancelled sale', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    const db = await getDB();
    const cancelledSale = await db.get('sales', sale.id);
    await db.put('sales', { ...cancelledSale!, status: 'cancelled' });

    await expect(
      createReturn({
        saleId: sale.id,
        items: [{ inventoryId: item.id, unit: 'kg', quantity: 1 }],
        reason: 'Too late',
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('rolls back inventory changes if one item in a multi-item return is invalid', async () => {
    const itemA = await setupProduct();
    const itemB = await createInventoryItem({
      productName: 'Sugar',
      baseUnit: 'kg',
      unitConversions: {},
      marketPrice: 45,
    });
    await createRestock({
      items: [{ inventoryId: itemB.id, unit: 'kg', quantity: 100, costPricePerUnit: 30 }],
    });

    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [
        { inventoryId: itemA.id, unit: 'kg', quantity: 10, salePrice: 60 },
        { inventoryId: itemB.id, unit: 'kg', quantity: 5, salePrice: 45 },
      ],
    });

    const db = await getDB();
    const beforeA = (await db.get('inventory', itemA.id))!.quantity;

    await expect(
      createReturn({
        saleId: sale.id,
        items: [
          { inventoryId: itemA.id, unit: 'kg', quantity: 3 }, // valid, processed first
          { inventoryId: itemB.id, unit: 'kg', quantity: 999 }, // fails: exceeds what was sold
        ],
        reason: 'Mixed return',
      }),
    ).rejects.toThrow();

    const afterA = (await db.get('inventory', itemA.id))!.quantity;
    expect(afterA).toBe(beforeA); // itemA's restoration must be rolled back
  });

  it('rejects a return with an empty reason', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });
    await expect(
      createReturn({
        saleId: sale.id,
        items: [{ inventoryId: item.id, unit: 'kg', quantity: 1 }],
        reason: '  ',
      }),
    ).rejects.toThrow();
  });

  it('rejects a return against a nonexistent sale', async () => {
    await expect(
      createReturn({
        saleId: 'nope',
        items: [{ inventoryId: 'x', unit: 'kg', quantity: 1 }],
        reason: 'test',
      }),
    ).rejects.toThrow();
  });

  it('rejects a NaN return quantity and leaves stock untouched', async () => {
    const item = await setupProduct();
    const sale = await createSale({
      saleType: 'RETAIL',
      retailerId: 'r1',
      items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 60 }],
    });

    await expect(
      createReturn({
        saleId: sale.id,
        items: [{ inventoryId: item.id, unit: 'kg', quantity: NaN }],
        reason: 'Test',
      }),
    ).rejects.toThrow(/positive number/);

    const db = await getDB();
    const after = (await db.get('inventory', item.id))!.quantity;
    expect(after).toBe(990); // restocked 1000 - sold 10, no phantom return
  });
});
