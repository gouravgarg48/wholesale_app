import { useState, type FormEvent } from 'react';
import { createInventoryItem } from '../../db/inventory';

type ConversionRow = { unit: string; factor: string };

const BASE_UNITS = ['kg', 'bag', 'quintal'] as const;

const inputClass = 'text-base p-2 border border-[#d8cfb8] bg-white text-[#2b2620]';
const fieldLabelClass = 'flex flex-col gap-1 text-sm text-[#6b6555] mb-3.5';

export function AddProductForm({ onCreated }: { onCreated: () => void }) {
  const [productName, setProductName] = useState('');
  const [baseUnit, setBaseUnit] = useState<(typeof BASE_UNITS)[number]>('kg');
  const [marketPrice, setMarketPrice] = useState('');
  const [conversions, setConversions] = useState<ConversionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addConversionRow() {
    setConversions([...conversions, { unit: '', factor: '' }]);
  }

  function updateConversionRow(index: number, field: keyof ConversionRow, value: string) {
    const next = [...conversions];
    next[index] = { ...next[index], [field]: value };
    setConversions(next);
  }

  function removeConversionRow(index: number) {
    setConversions(conversions.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = productName.trim();
    if (!trimmedName) {
      setError('Product name is required.');
      return;
    }

    const price = Number(marketPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Market price must be a positive number.');
      return;
    }

    const unitConversions: Record<string, number> = {};
    for (const row of conversions) {
      const unit = row.unit.trim();
      const factor = Number(row.factor);
      if (!unit) continue;
      if (!Number.isFinite(factor) || factor <= 0) {
        setError(`Conversion factor for "${unit}" must be a positive number.`);
        return;
      }
      if (unit === baseUnit) {
        setError(`Conversion unit "${unit}" can't be the same as the base unit.`);
        return;
      }
      unitConversions[unit] = factor;
    }

    setSaving(true);
    try {
      await createInventoryItem({
        productName: trimmedName,
        baseUnit,
        unitConversions,
        marketPrice: price,
      });
      setProductName('');
      setMarketPrice('');
      setConversions([]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#2b2620]"
      onSubmit={handleSubmit}
    >
      <h2 className="font-serif text-xl mb-4">Add product</h2>

      <label className={fieldLabelClass}>
        Product name
        <input
          className={inputClass}
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Basmati Rice"
        />
      </label>

      <label className={fieldLabelClass}>
        Base unit
        <select
          className={inputClass}
          value={baseUnit}
          onChange={(e) => setBaseUnit(e.target.value as (typeof BASE_UNITS)[number])}
        >
          {BASE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </label>

      <label className={fieldLabelClass}>
        Market price (per {baseUnit})
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.01"
          value={marketPrice}
          onChange={(e) => setMarketPrice(e.target.value)}
          placeholder="60"
        />
      </label>

      <div className="mb-4">
        <div className="flex justify-between items-center text-sm text-[#6b6555] mb-2">
          <span>Unit conversions (optional)</span>
          <button type="button" onClick={addConversionRow} className="underline">
            + Add
          </button>
        </div>
        {conversions.map((row, i) => (
          <div className="flex items-center gap-2 mb-2" key={i}>
            <input
              className={`${inputClass} w-20 p-1.5`}
              placeholder="bag"
              value={row.unit}
              onChange={(e) => updateConversionRow(i, 'unit', e.target.value)}
            />
            <span>=</span>
            <input
              className={`${inputClass} w-20 p-1.5`}
              type="number"
              min="0"
              placeholder="50"
              value={row.factor}
              onChange={(e) => updateConversionRow(i, 'factor', e.target.value)}
            />
            <span>{baseUnit}</span>
            <button
              type="button"
              onClick={() => removeConversionRow(i)}
              className="text-[#b54b3a] px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-[#b54b3a] text-sm mb-3">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="bg-[#2b2620] text-[#faf7f2] border-none px-5 py-2.5 text-[0.95rem] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save product'}
      </button>
    </form>
  );
}
