import { describe, it, expect } from 'vitest';
import {
  BASE_UNITS,
  assertSellableUnit,
  totalWeightKg,
  formatStockDisplay,
  pluralUnit,
} from './inventory';
import type { WholesaleDB } from './schema';
import { monotonicNow } from './clock';

type InventoryItem = WholesaleDB['inventory']['value'];

const mockItem: InventoryItem = {
  id: 'test-1',
  productName: 'Basmati Rice',
  baseUnit: 'bag',
  weightPerUnitKg: 50,
  quantity: 3,
  marketPrice: 60,
  createdAt: monotonicNow(),
};

describe('base units', () => {
  it('offers only bag and packet', () => {
    expect(BASE_UNITS).toEqual(['bag', 'packet']);
  });
});

describe('pluralUnit', () => {
  it('pluralizes bag and packet', () => {
    expect(pluralUnit('bag', 1)).toBe('bag');
    expect(pluralUnit('bag', 3)).toBe('bags');
    expect(pluralUnit('packet', 5)).toBe('packets');
  });
});

describe('assertSellableUnit', () => {
  it('accepts the product base unit', () => {
    expect(() => assertSellableUnit(mockItem, 'bag')).not.toThrow();
  });

  it('throws for any unit other than the base unit', () => {
    expect(() => assertSellableUnit(mockItem, 'kg')).toThrow();
    expect(() => assertSellableUnit(mockItem, 'packet')).toThrow();
  });
});

describe('totalWeightKg', () => {
  it('computes quantity × weight per unit', () => {
    expect(totalWeightKg(mockItem, 3, 'bag')).toBe(150);
  });

  it('throws for an invalid unit instead of guessing', () => {
    expect(() => totalWeightKg(mockItem, 3, 'kg')).toThrow();
  });
});

describe('formatStockDisplay', () => {
  it('shows units plus the gross weight', () => {
    expect(formatStockDisplay(mockItem)).toBe('3 bags · 150 kg');
  });

  it('does not pluralize a single unit', () => {
    expect(formatStockDisplay({ ...mockItem, quantity: 1 })).toBe('1 bag · 50 kg');
  });

  it('handles fractional weights cleanly', () => {
    expect(formatStockDisplay({ ...mockItem, weightPerUnitKg: 50.5 })).toBe(
      '3 bags · 151.5 kg',
    );
  });
});