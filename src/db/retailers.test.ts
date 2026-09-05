import { describe, it, expect, afterEach } from 'vitest';
import { closeDB } from './schema';
import { createRetailer, getRetailer, listRetailers, updateRetailer } from './retailers';

afterEach(async () => {
  await closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wholesale-app-db');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('createRetailer', () => {
  it('creates a retailer with trimmed name', async () => {
    const r = await createRetailer({ name: '  Sharma Traders  ', creditLimit: 50000 });
    expect(r.name).toBe('Sharma Traders');
    expect(r.creditLimit).toBe(50000);
    expect(r.id).toBeTruthy();
  });

  it('rejects an empty name', async () => {
    await expect(createRetailer({ name: '   ', creditLimit: 1000 })).rejects.toThrow();
  });

  it('rejects a negative credit limit', async () => {
    await expect(createRetailer({ name: 'Test', creditLimit: -1 })).rejects.toThrow();
  });

  it('allows a zero credit limit (cash-only retailer)', async () => {
    const r = await createRetailer({ name: 'Cash Only Retailer', creditLimit: 0 });
    expect(r.creditLimit).toBe(0);
  });
});

describe('listRetailers', () => {
  it('returns retailers sorted by name', async () => {
    await createRetailer({ name: 'Zeta Traders', creditLimit: 1000 });
    await createRetailer({ name: 'Alpha Traders', creditLimit: 1000 });
    const list = await listRetailers();
    expect(list.map((r) => r.name)).toEqual(['Alpha Traders', 'Zeta Traders']);
  });
});

describe('updateRetailer', () => {
  it('updates credit limit without touching other fields', async () => {
    const r = await createRetailer({ name: 'Test Traders', phone: '9999999999', creditLimit: 1000 });
    const updated = await updateRetailer(r.id, { creditLimit: 5000 });
    expect(updated.creditLimit).toBe(5000);
    expect(updated.phone).toBe('9999999999');
  });

  it('throws for a nonexistent retailer', async () => {
    await expect(updateRetailer('does-not-exist', { creditLimit: 100 })).rejects.toThrow();
  });

  it('rejects clearing the name to empty', async () => {
    const r = await createRetailer({ name: 'Test Traders', creditLimit: 1000 });
    await expect(updateRetailer(r.id, { name: '   ' })).rejects.toThrow();
  });
});

describe('getRetailer', () => {
  it('returns undefined for a nonexistent id', async () => {
    const result = await getRetailer('nope');
    expect(result).toBeUndefined();
  });
});