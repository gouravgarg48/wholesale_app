import { useEffect, useState, type FormEvent } from 'react';
import { listInventory } from '../../db/inventory';
import { listRetailers } from '../../db/retailers';
import { createSale } from '../../db/sales';
import type { WholesaleDB } from '../../db/schema';

type InventoryItem = WholesaleDB['inventory']['value'];
type Retailer = WholesaleDB['retailers']['value'];
type SaleRow = { inventoryId: string; unit: string; quantity: string; salePrice: string };

const emptyRow: SaleRow = { inventoryId: '', unit: '', quantity: '', salePrice: '' };
const inputClass = "text-sm p-1.5 border border-[#d8cfb8] bg-white text-[#2b2620]";

export function SaleForm({ onCreated }: { onCreated: () => void }) {
  const [saleType, setSaleType] = useState<'CASH' | 'RETAIL'>('CASH');
  const [buyerName, setBuyerName] = useState('');
  const [retailerId, setRetailerId] = useState('');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [rows, setRows] = useState<SaleRow[]>([{ ...emptyRow }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listInventory().then(setInventory);
    listRetailers().then(setRetailers);
  }, []);

  function unitsFor(inventoryId: string): string[] {
    const item = inventory.find((i) => i.id === inventoryId);
    if (!item) return [];
    return [item.baseUnit, ...Object.keys(item.unitConversions)];
  }

  function updateRow(index: number, field: keyof SaleRow, value: string) {
    const next = [...rows];
    next[index] = { ...next[index], [field]: value };
    if (field === 'inventoryId') {
      next[index].unit = '';
      // pre-fill sale price with the product's market price, still editable
      const item = inventory.find((i) => i.id === value);
      if (item) next[index].salePrice = String(item.marketPrice);
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

    if (saleType === 'CASH' && !buyerName.trim()) {
      setError('Buyer name is required for a cash sale.');
      return;
    }
    if (saleType === 'RETAIL' && !retailerId) {
      setError('Select a retailer for a retail sale.');
      return;
    }

    const items = [];
    for (const row of rows) {
      if (!row.inventoryId && !row.quantity && !row.salePrice) continue;

      if (!row.inventoryId || !row.unit) {
        setError('Every row needs a product and unit selected.');
        return;
      }
      const quantity = Number(row.quantity);
      const salePrice = Number(row.salePrice);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError('Quantity must be a positive number.');
        return;
      }
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        setError('Sale price must be a non-negative number.');
        return;
      }
      items.push({ inventoryId: row.inventoryId, unit: row.unit, quantity, salePrice });
    }

    if (items.length === 0) {
      setError('Add at least one item to sell.');
      return;
    }

    setSaving(true);
    try {
      if (saleType === 'CASH') {
        await createSale({ saleType: 'CASH', buyerName: buyerName.trim(), items });
      } else {
        await createSale({ saleType: 'RETAIL', retailerId, items });
      }
      setBuyerName('');
      setRetailerId('');
      setRows([{ ...emptyRow }]);
      const refreshed = await listInventory();
      setInventory(refreshed); // so stock levels shown in dropdowns stay current
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record sale.');
    } finally {
      setSaving(false);
    }
  }

  if (inventory.length === 0) {
    return (
      <div className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#6b6555] text-sm">
        Add and stock a product before recording a sale.
      </div>
    );
  }

  return (
    <form className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#2b2620]" onSubmit={handleSubmit}>
      <h2 className="font-serif text-xl mb-4">Record sale</h2>

      <div className="flex gap-4 mb-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={saleType === 'CASH'} onChange={() => setSaleType('CASH')} />
          Cash
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={saleType === 'RETAIL'} onChange={() => setSaleType('RETAIL')} />
          Retailer
        </label>
      </div>

      {saleType === 'CASH' ? (
        <label className="flex flex-col gap-1 text-sm text-[#6b6555] mb-4">
          Buyer name
          <input className={inputClass} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Walk-in customer" />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-[#6b6555] mb-4">
          Retailer
          {retailers.length === 0 ? (
            <span className="text-[#b54b3a] text-xs">No retailers yet — add one first.</span>
          ) : (
            <select className={inputClass} value={retailerId} onChange={(e) => setRetailerId(e.target.value)}>
              <option value="">Select retailer…</option>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </label>
      )}

      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-[#e4dccb] last:border-0">
          <select
            className={`${inputClass} flex-1 min-w-[140px]`}
            value={row.inventoryId}
            onChange={(e) => updateRow(i, 'inventoryId', e.target.value)}
          >
            <option value="">Select product…</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>
                {item.productName} ({item.quantity} {item.baseUnit} in stock)
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

          <select
            className={`${inputClass} w-24`}
            value={row.unit}
            onChange={(e) => updateRow(i, 'unit', e.target.value)}
            disabled={!row.inventoryId}
          >
            <option value="">Unit</option>
            {unitsFor(row.inventoryId).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

          <span className="text-sm text-[#6b6555]">@ ₹</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Price"
            value={row.salePrice}
            onChange={(e) => updateRow(i, 'salePrice', e.target.value)}
            className={`${inputClass} w-24`}
          />

          {rows.length > 1 && (
            <button type="button" onClick={() => removeRow(i)} className="text-[#b54b3a] px-1">×</button>
          )}
        </div>
      ))}

      <button type="button" onClick={addRow} className="text-sm underline mb-4 block">+ Add another product</button>

      {error && <p className="text-[#b54b3a] text-sm mb-3">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="bg-[#2b2620] text-[#faf7f2] border-none px-5 py-2.5 text-[0.95rem] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Record sale'}
      </button>
    </form>
  );
}