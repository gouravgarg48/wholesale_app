import { describe, it, expect } from 'vitest';
import { convertToBaseUnit, convertFromBaseUnit } from './inventory';
import type { WholesaleDB } from './schema';

type InventoryItem = WholesaleDB['inventory']['value'];

const mockItem: InventoryItem = {
  id: 'test-1',
  productName: 'Basmati Rice',
  baseUnit: 'kg',
  unitConversions: { bag: 50 },
  quantity: 0,
  marketPrice: 60,
  createdAt: Date.now(),
};

describe('convertToBaseUnit', () => {
  it('returns the same quantity when unit matches baseUnit', () => {
    expect(convertToBaseUnit(mockItem, 10, 'kg')).toBe(10);
  });

  it('converts a non-base unit using the conversion factor', () => {
    expect(convertToBaseUnit(mockItem, 3, 'bag')).toBe(150);
  });

  it('throws on an unknown unit instead of silently returning wrong data', () => {
    expect(() => convertToBaseUnit(mockItem, 5, 'quintal')).toThrow();
  });
});

describe('convertFromBaseUnit', () => {
  it('returns the same quantity when target matches baseUnit', () => {
    expect(convertFromBaseUnit(mockItem, 150, 'kg')).toBe(150);
  });

  it('converts baseUnit quantity into a target unit', () => {
    expect(convertFromBaseUnit(mockItem, 150, 'bag')).toBe(3);
  });

  it('throws on an unknown target unit', () => {
    expect(() => convertFromBaseUnit(mockItem, 150, 'quintal')).toThrow();
  });

  it('round-trips correctly with convertToBaseUnit', () => {
    const base = convertToBaseUnit(mockItem, 7, 'bag');
    expect(convertFromBaseUnit(mockItem, base, 'bag')).toBe(7);
  });
});