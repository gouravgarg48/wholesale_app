import { describe, it, expect, afterEach } from 'vitest';
import { closeDB } from './schema';
import { createInventoryItem } from './inventory';
import { createRestock } from './restock';
import { createSale } from './sales';
import {
  exportSnapshot,
  parseSnapshot,
  restoreSnapshot,
  getDeviceLabel,
  setDeviceLabel,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
} from './db-snapshot';
import type { BackupSnapshot } from './db-snapshot';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

async function setupData() {
  const item = await createInventoryItem({
    productName: 'Rice',
    baseUnit: 'kg',
    unitConversions: { bag: 50 },
    marketPrice: 60,
  });
  await createRestock({
    items: [{ inventoryId: item.id, unit: 'kg', quantity: 1000, costPricePerUnit: 40 }],
  });
  await createSale({
    saleType: 'RETAIL',
    retailerId: 'r1',
    items: [{ inventoryId: item.id, unit: 'bag', quantity: 2, salePrice: 3000 }],
  });
  await createSale({
    saleType: 'CASH',
    buyerName: 'Walk-in',
    items: [{ inventoryId: item.id, unit: 'kg', quantity: 10, salePrice: 62 }],
  });
  return item;
}

describe('exportSnapshot', () => {
  it('returns an empty snapshot for an empty database', async () => {
    const snapshot = await exportSnapshot();
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(Number.isFinite(snapshot.exportedAt)).toBe(true);
    expect(Object.keys(snapshot.stores).length).toBeGreaterThan(0);
    // every store is present, and empty
    for (const records of Object.values(snapshot.stores)) {
      expect(records).toEqual([]);
    }
  });

  it('captures every populated store with its records', async () => {
    await setupData();
    const snapshot = await exportSnapshot();

    expect(snapshot.stores.inventory).toHaveLength(1);
    expect(snapshot.stores.restock).toHaveLength(1);
    expect(snapshot.stores.sales).toHaveLength(2);
    expect(snapshot.stores.retailers).toHaveLength(0);

    const sale = (snapshot.stores.sales as { id: string; saleType: string }[]).find(
      (s) => s.saleType === 'RETAIL',
    );
    expect(sale).toBeDefined();
    const cashSale = (snapshot.stores.sales as { saleType: string }[]).find(
      (s) => s.saleType === 'CASH',
    );
    expect(cashSale).toBeDefined();
  });

  it('produces a JSON-serializable snapshot (so it can live in a file / on Drive)', async () => {
    await setupData();
    const snapshot = await exportSnapshot();
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped.format).toBe(SNAPSHOT_FORMAT);
    expect((roundTripped.stores.sales as unknown[]).length).toBe(2);
  });

  it('records the device label when one is set, and omits it otherwise', async () => {
    const without = await exportSnapshot();
    expect(without.exportedBy).toBeUndefined();

    await setDeviceLabel('  Shop-1  ');
    expect(await getDeviceLabel()).toBe('Shop-1');
    const withLabel = await exportSnapshot();
    expect(withLabel.exportedBy).toBe('Shop-1');
  });
});

async function fullEmptyStores() {
  return {
    retailers: [],
    inventory: [],
    sales: [],
    restock: [],
    returns: [],
    payments: [],
    invoices: [],
    counters: [],
    backup: [],
  };
}

describe('restoreSnapshot', () => {
  it('restores a previously exported snapshot and rebuilds a working DB', async () => {
    await setupData();
    const snapshot = await exportSnapshot();

    // Wipe the DB by restoring a snapshot with every store empty.
    await restoreSnapshot({
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exportedAt: 1,
      stores: await fullEmptyStores(),
    });

    // DB is now empty.
    let check = await exportSnapshot();
    expect(check.stores.inventory).toEqual([]);
    expect(check.stores.sales).toEqual([]);

    // Restore the real data.
    await restoreSnapshot(snapshot);
    check = await exportSnapshot();
    expect(check.stores.inventory).toHaveLength(1);
    expect(check.stores.sales).toHaveLength(2);
    expect(check.stores.restock).toHaveLength(1);

    // Inventory quantities come back restored — the running total is data too.
    const restoredItem = (check.stores.inventory as { quantity: number }[])[0];
    expect(restoredItem.quantity).toBe(1000 - 2 * 50 - 10); // 890
  });

  it('rejects a snapshot that is not from this app', async () => {
    await expect(
      restoreSnapshot({
        format: 'something-else',
        version: 1,
        exportedAt: 1,
        stores: await fullEmptyStores(),
      }),
    ).rejects.toThrow('not a wholesale-app snapshot');
  });

  it('rejects a snapshot with an unsupported version', async () => {
    await expect(
      restoreSnapshot({
        format: SNAPSHOT_FORMAT,
        version: 99,
        exportedAt: 1,
        stores: await fullEmptyStores(),
      }),
    ).rejects.toThrow("doesn't match current version");
  });

  it('rejects a snapshot missing a store', async () => {
    const stores = await fullEmptyStores();
    delete (stores as Record<string, unknown>).payments;
    await expect(
      restoreSnapshot({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        exportedAt: 1,
        stores,
      }),
    ).rejects.toThrow('missing store "payments"');
  });

  it('rejects a snapshot containing an unknown store', async () => {
    const stores = await fullEmptyStores();
    (stores as Record<string, unknown>)['unknown-store'] = [];
    await expect(
      restoreSnapshot({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        exportedAt: 1,
        stores,
      }),
    ).rejects.toThrow('unknown store "unknown-store"');
  });

  it('rejects a store whose records are not an array', async () => {
    const stores = await fullEmptyStores();
    stores.retailers = 'not-an-array' as never;
    await expect(
      restoreSnapshot({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        exportedAt: 1,
        stores,
      }),
    ).rejects.toThrow('"retailers" isn\'t an array');
  });

  it('rejects a record missing its keyPath field', async () => {
    const stores = await fullEmptyStores();
    stores.retailers = [{ name: 'NoIdHere' }] as never;
    await expect(
      restoreSnapshot({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        exportedAt: 1,
        stores,
      }),
    ).rejects.toThrow('missing "id"');
  });

  it('rejects a record missing saleId in the invoices store', async () => {
    const stores = await fullEmptyStores();
    stores.invoices = [{ invoiceNumber: 3 }] as never;
    await expect(
      restoreSnapshot({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        exportedAt: 1,
        stores,
      }),
    ).rejects.toThrow('missing "saleId"');
  });

  it('replaces existing data rather than merging', async () => {
    await setupData();
    const replacement: BackupSnapshot = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exportedAt: 1,
      stores: {
        ...(await fullEmptyStores()),
        counters: [{ id: 'invoiceNumber', value: 7 }],
      },
    };
    await restoreSnapshot(replacement);

    const snapshot = await exportSnapshot();
    expect(snapshot.stores.sales).toEqual([]);
    const counters = snapshot.stores.counters as { id: string; value: number }[];
    expect(counters).toEqual([{ id: 'invoiceNumber', value: 7 }]);
  });
});

describe('parseSnapshot', () => {
  it('returns a typed snapshot for valid input', async () => {
    const value = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exportedAt: 5,
      exportedBy: 'Shop-1',
      stores: { ...(await fullEmptyStores()), retailers: [{ id: 'r1', name: 'A' }] },
    };
    const parsed = parseSnapshot(value);
    expect(parsed.stores.retailers).toHaveLength(1);
    expect(parsed.exportedBy).toBe('Shop-1');
  });

  it('passes through legacy snapshots with no exportedBy', async () => {
    const value = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exportedAt: 5,
      stores: await fullEmptyStores(),
    };
    const parsed = parseSnapshot(value);
    expect(parsed.exportedBy).toBeUndefined();
  });

  it('rejects a non-string exportedBy', () => {
    const value = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      exportedAt: 5,
      exportedBy: 42,
      stores: null,
    };
    expect(() => parseSnapshot(value)).toThrow('exportedBy must be a non-empty string');
  });

  it('rejects non-object input', () => {
    expect(() => parseSnapshot(null)).toThrow('expected an object');
    expect(() => parseSnapshot([1, 2])).toThrow('expected an object');
  });
});
