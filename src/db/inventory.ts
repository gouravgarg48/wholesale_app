import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { monotonicNow } from './clock';
import { generateId } from './id';

type InventoryItem = WholesaleDB['inventory']['value'];

type InventoryUpdateInput = {
  productName?: string;
  marketPrice?: number; // ₹/kg
  weightPerUnitKg?: number;
};

export const BASE_UNITS = ['bag', 'packet'] as const;

export function pluralUnit(unit: string, count: number): string {
  return count === 1 ? unit : `${unit}s`;
}

export async function createInventoryItem(
  input: Omit<InventoryItem, 'id' | 'quantity' | 'createdAt'>,
): Promise<InventoryItem> {
  const db = await getDB();
  const item: InventoryItem = {
    ...input,
    id: generateId(),
    quantity: 0, // new items start at zero; stock arrives via restock
    createdAt: monotonicNow(),
  };
  await db.add('inventory', item);
  return item;
}

export async function getInventoryItem(id: string): Promise<InventoryItem | undefined> {
  const db = await getDB();
  return db.get('inventory', id);
}

export async function listInventory(): Promise<InventoryItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('inventory', 'by-name');
}

/**
 * Validates a sale/restock/return unit against the product. With base
 * units limited to bag/packet there is no conversion table anymore — stock
 * is counted in whole units, so this is an identity that exists purely to
 * reject a unit the product doesn't support.
 */
export function assertSellableUnit(item: InventoryItem, unit: string): void {
  if (unit !== item.baseUnit) {
    throw new Error(`Unit "${unit}" isn't valid for "${item.productName}" (use ${item.baseUnit})`);
  }
}

/** Gross weight in kg for a quantity of units: qty × weight-per-unit. */
export function totalWeightKg(item: InventoryItem, quantity: number, unit: string): number {
  assertSellableUnit(item, unit);
  return quantity * item.weightPerUnitKg;
}

/** Formats stock for display, e.g. "3 bags · 150 kg". */
export function formatStockDisplay(item: InventoryItem): string {
  const weight = item.quantity * item.weightPerUnitKg;
  const parts = [`${item.quantity} ${pluralUnit(item.baseUnit, item.quantity)}`];
  parts.push(`${formatWeight(weight)} kg`);
  return parts.join(' · ');
}

export function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1);
}

export async function updateInventoryItem(
  id: string,
  updates: InventoryUpdateInput,
): Promise<InventoryItem> {
  const db = await getDB();
  const item = await db.get('inventory', id);
  if (!item) {
    throw new Error(`Inventory item ${id} not found`);
  }

  if (updates.productName !== undefined) {
    const trimmed = updates.productName.trim();
    if (!trimmed) throw new Error('Product name cannot be empty');
    item.productName = trimmed;
  }

  if (updates.marketPrice !== undefined) {
    if (!Number.isFinite(updates.marketPrice) || updates.marketPrice <= 0) {
      throw new Error('Market price must be a positive number');
    }
    item.marketPrice = updates.marketPrice;
  }

  if (updates.weightPerUnitKg !== undefined) {
    if (!Number.isFinite(updates.weightPerUnitKg) || updates.weightPerUnitKg <= 0) {
      throw new Error('Weight per unit must be a positive number of kg');
    }
    item.weightPerUnitKg = updates.weightPerUnitKg;
  }

  await db.put('inventory', item);
  return item;
}