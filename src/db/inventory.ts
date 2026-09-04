import { getDB } from './schema';
import type { WholesaleDB } from './schema';

type InventoryItem = WholesaleDB['inventory']['value'];

export async function createInventoryItem(
  input: Omit<InventoryItem, 'id' | 'quantity' | 'createdAt'>
): Promise<InventoryItem> {
  const db = await getDB();
  const item: InventoryItem = {
    ...input,
    id: crypto.randomUUID(),
    quantity: 0, // new items start at zero; stock arrives via restock
    createdAt: Date.now(),
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
 * Converts a quantity in a given unit to the item's baseUnit.
 * e.g. if item.baseUnit is 'kg' and unitConversions = { bag: 50 },
 * convertToBaseUnit(item, 3, 'bag') => 150
 */
export function convertToBaseUnit(
  item: InventoryItem,
  quantity: number,
  unit: string
): number {
  if (unit === item.baseUnit) return quantity;

  const factor = item.unitConversions[unit];
  if (factor === undefined) {
    throw new Error(
      `No conversion defined for unit "${unit}" on item "${item.productName}"`
    );
  }
  return quantity * factor;
}

/**
 * Reverse of convertToBaseUnit — for displaying stock in a unit
 * other than baseUnit (e.g. showing "3 bags" instead of "150 kg").
 */
export function convertFromBaseUnit(
  item: InventoryItem,
  baseQuantity: number,
  targetUnit: string
): number {
  if (targetUnit === item.baseUnit) return baseQuantity;

  const factor = item.unitConversions[targetUnit];
  if (factor === undefined) {
    throw new Error(
      `No conversion defined for unit "${targetUnit}" on item "${item.productName}"`
    );
  }
  return baseQuantity / factor;
}

/**
 * Formats a quantity for display, showing the base unit plus any
 * defined conversions — e.g. "150 kg · 3 bags"
 */
export function formatQuantityDisplay(item: InventoryItem): string {
  const parts = [`${item.quantity} ${item.baseUnit}`];
  for (const [unit, factor] of Object.entries(item.unitConversions)) {
    if (factor > 0) {
      const converted = item.quantity / factor;
      parts.push(`${converted % 1 === 0 ? converted : converted.toFixed(1)} ${unit}${converted === 1 ? '' : 's'}`);
    }
  }
  return parts.join(' · ');
}