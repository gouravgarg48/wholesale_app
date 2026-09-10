import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { monotonicNow } from './clock';
import { generateId } from './id';

type Retailer = WholesaleDB['retailers']['value'];
type RetailerCreateInput = Omit<Retailer, 'id' | 'createdAt'>;
type RetailerUpdateInput = Partial<Omit<Retailer, 'id' | 'createdAt'>>;

function validate(input: { name: string; creditLimit: number }) {
  if (!input.name.trim()) {
    throw new Error('Retailer name is required');
  }
  if (!Number.isFinite(input.creditLimit) || input.creditLimit < 0) {
    throw new Error('Credit limit must be a non-negative number');
  }
}

export async function createRetailer(input: RetailerCreateInput): Promise<Retailer> {
  validate(input);
  const db = await getDB();
  const retailer: Retailer = {
    ...input,
    name: input.name.trim(),
    id: generateId(),
    createdAt: monotonicNow(),
  };
  await db.add('retailers', retailer);
  return retailer;
}

export async function getRetailer(id: string): Promise<Retailer | undefined> {
  const db = await getDB();
  return db.get('retailers', id);
}

export async function listRetailers(): Promise<Retailer[]> {
  const db = await getDB();
  return db.getAllFromIndex('retailers', 'by-name');
}

export async function updateRetailer(id: string, updates: RetailerUpdateInput): Promise<Retailer> {
  const db = await getDB();
  const retailer = await db.get('retailers', id);
  if (!retailer) {
    throw new Error(`Retailer ${id} not found`);
  }

  const merged = { ...retailer, ...updates };
  if (updates.name !== undefined || updates.creditLimit !== undefined) {
    validate(merged);
  }
  if (updates.name !== undefined) {
    merged.name = updates.name.trim();
  }

  await db.put('retailers', merged);
  return merged;
}
