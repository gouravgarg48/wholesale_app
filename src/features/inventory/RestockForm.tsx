import { useEffect, useState, type FormEvent } from 'react';
import { listInventory, pluralUnit } from '../../db/inventory';
import { createRestock } from '../../db/restock';
import type { WholesaleDB } from '../../db/schema';

type InventoryItem = WholesaleDB['inventory']['value'];
type RestockRow = { inventoryId: string; unit: string; quantity: string; costPricePerUnit: string };

const emptyRow: RestockRow = { inventoryId: '', unit: '', quantity: '', costPricePerUnit: '' };
const inputClass = 'text-sm p-1.5 border border-[#d8cfb8] bg-white text-[#2b2620]';

export function RestockForm({ onCreated }: { onCreated: () => void }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [rows, setRows] = useState<RestockRow[]>([{ ...emptyRow }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listInventory().then(setInventory);
  }, []);

  function updateRow(index: number, field: keyof RestockRow, value: string) {
    const next = [...rows];
    next[index] = { ...next[index], [field]: value };
    // unit is always the product's base unit — set it when the product changes
    if (field === 'inventoryId') {
      const item = inventory.find((i) => i.id === value);
      next[index].unit = item ? item.baseUnit : '';
    }
    setRows(next);
  }

  function addRow() {
    setRows([...rows, { ...emptyRow }]);
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const items = [];
    for (const row of rows) {
      if (!row.inventoryId && !row.quantity && !row.costPricePerUnit) continue; // skip fully-empty row

      if (!row.inventoryId) {
        setError('Every row needs a product selected.');
        return;
      }
      if (!row.unit) {
        setError('Every row needs a unit selected.');
        return;
      }
      const quantity = Number(row.quantity);
      const costPricePerUnit = Number(row.costPricePerUnit);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError('Quantity must be a positive number.');
        return;
      }
      if (!Number.isFinite(costPricePerUnit) || costPricePerUnit <= 0) {
        setError('Cost price must be a positive number.');
        return;
      }
      items.push({ inventoryId: row.inventoryId, unit: row.unit, quantity, costPricePerUnit });
    }

    if (items.length === 0) {
      setError('Add at least one item to restock.');
      return;
    }

    setSaving(true);
    try {
      await createRestock({ items });
      setRows([{ ...emptyRow }]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save restock.');
    } finally {
      setSaving(false);
    }
  }

  if (inventory.length === 0) {
    return (
      <div className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#6b6555] text-sm">
        Add a product first before recording a restock.
      </div>
    );
  }

  return (
    <form
      className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#2b2620]"
      onSubmit={handleSubmit}
    >
      <h2 className="font-serif text-xl mb-4">Record restock</h2>

      {rows.map((row, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-[#e4dccb] last:border-0"
        >
          <select
            className={`${inputClass} flex-1 min-w-[140px]`}
            value={row.inventoryId}
            onChange={(e) => updateRow(i, 'inventoryId', e.target.value)}
          >
            <option value="">Select product…</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.productName}
              </option>
            ))}
          </select>

          <input
            type="number"
            min="0"
            placeholder="Qty"
            value={row.quantity}
            onChange={(e) => updateRow(i, 'quantity', e.target.value)}
            className={`${inputClass} w-20`}
          />

          <span className="text-sm text-[#6b6555] w-16 text-center">
            {row.unit ? pluralUnit(row.unit, 2) : 'unit'}
          </span>

          <span className="text-sm text-[#6b6555]">@ ₹</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Cost/unit"
            value={row.costPricePerUnit}
            onChange={(e) => updateRow(i, 'costPricePerUnit', e.target.value)}
            className={`${inputClass} w-24`}
          />

          {rows.length > 1 && (
            <button type="button" onClick={() => removeRow(i)} className="text-[#b54b3a] px-1">
              ×
            </button>
          )}
        </div>
      ))}

      <button type="button" onClick={addRow} className="text-sm underline mb-4 block">
        + Add another product
      </button>

      {error && <p className="text-[#b54b3a] text-sm mb-3">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="bg-[#2b2620] text-[#faf7f2] border-none px-5 py-2.5 text-[0.95rem] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Record restock'}
      </button>
    </form>
  );
}
