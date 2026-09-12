import { useState, type FormEvent } from 'react';
import { createInventoryItem, BASE_UNITS } from '../../db/inventory';

const inputClass = 'text-base p-2 border border-[#d8cfb8] bg-white text-[#2b2620]';
const fieldLabelClass = 'flex flex-col gap-1 text-sm text-[#6b6555] mb-3.5';

export function AddProductForm({ onCreated }: { onCreated: () => void }) {
  const [productName, setProductName] = useState('');
  const [baseUnit, setBaseUnit] = useState<(typeof BASE_UNITS)[number]>('bag');
  const [weightPerUnitKg, setWeightPerUnitKg] = useState('');
  const [pricePerKg, setPricePerKg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = productName.trim();
    if (!trimmedName) {
      setError('Product name is required.');
      return;
    }

    const weight = Number(weightPerUnitKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Weight per unit (kg) is required and must be a positive number.');
      return;
    }

    const price = Number(pricePerKg);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Price per kg must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      await createInventoryItem({
        productName: trimmedName,
        baseUnit,
        weightPerUnitKg: weight,
        marketPrice: price,
      });
      setProductName('');
      setBaseUnit('bag');
      setWeightPerUnitKg('');
      setPricePerKg('');
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
        Weight per {baseUnit} (kg)
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.01"
          value={weightPerUnitKg}
          onChange={(e) => setWeightPerUnitKg(e.target.value)}
          placeholder="50"
        />
      </label>
      <p className="text-xs text-[#6b6555] -mt-2 mb-3.5">
        Required — e.g. a 50 kg rice bag is 50. Used to work out gross weight and billing.
      </p>

      <label className={fieldLabelClass}>
        Price per kg (₹)
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.01"
          value={pricePerKg}
          onChange={(e) => setPricePerKg(e.target.value)}
          placeholder="60"
        />
      </label>

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