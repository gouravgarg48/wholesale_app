import { useEffect, useState, type FormEvent } from 'react';
import { getDB } from '../../db/schema';
import { getReturnableQuantities, createReturn } from '../../db/returns';
import { listInventory } from '../../db/inventory';
import type { WholesaleDB } from '../../db/schema';

type Sale = WholesaleDB['sales']['value'];
type InventoryItem = WholesaleDB['inventory']['value'];

export function ReturnForm({
  saleId,
  onCreated,
  onCancel,
}: {
  saleId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [returnable, setReturnable] = useState<Map<string, number>>(new Map());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const [saleRecord, inv, remaining] = await Promise.all([
        db.get('sales', saleId),
        listInventory(),
        getReturnableQuantities(saleId),
      ]);
      setSale(saleRecord ?? null);
      setInventory(inv);
      setReturnable(remaining);
    })();
  }, [saleId]);

  if (!sale) return null;

  function productName(inventoryId: string) {
    return inventory.find((i) => i.id === inventoryId)?.productName ?? inventoryId;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }

    const items = [];
    for (const saleItem of sale!.items) {
      const key = `${saleItem.inventoryId}:${saleItem.unit}`;
      const qtyStr = quantities[key];
      if (!qtyStr) continue;
      const qty = Number(qtyStr);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      items.push({ inventoryId: saleItem.inventoryId, unit: saleItem.unit, quantity: qty });
    }

    if (items.length === 0) {
      setError('Enter a quantity to return for at least one item.');
      return;
    }

    setSaving(true);
    try {
      await createReturn({ saleId: sale!.id, items, reason: reason.trim() });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record return.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#2b2620]"
      onSubmit={handleSubmit}
    >
      <h2 className="font-serif text-xl mb-4">Return items</h2>

      {sale.items.map((item) => {
        const key = `${item.inventoryId}:${item.unit}`;
        const max = returnable.get(key) ?? 0;
        if (max <= 0) return null; // nothing left to return for this line
        return (
          <div key={key} className="flex items-center gap-3 mb-3">
            <span className="flex-1 text-sm">
              {productName(item.inventoryId)} — sold {item.quantity} {item.unit}, up to {max}{' '}
              returnable
            </span>
            <input
              type="number"
              min="0"
              max={max}
              placeholder="0"
              value={quantities[key] ?? ''}
              onChange={(e) => setQuantities({ ...quantities, [key]: e.target.value })}
              className="w-20 text-sm p-1.5 border border-[#d8cfb8] bg-white"
            />
          </div>
        );
      })}

      <label className="flex flex-col gap-1 text-sm text-[#6b6555] my-3">
        Reason
        <input
          className="text-base p-2 border border-[#d8cfb8] bg-white text-[#2b2620]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Damaged, wrong item, excess order…"
        />
      </label>

      {error && <p className="text-[#b54b3a] text-sm mb-3">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-[#2b2620] text-[#faf7f2] border-none px-5 py-2.5 text-[0.95rem] cursor-pointer disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Record return'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-[#6b6555] underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
