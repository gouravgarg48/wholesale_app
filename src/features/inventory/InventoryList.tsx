import { useEffect, useState } from 'react';
import { listInventory, formatStockDisplay, updateInventoryItem } from '../../db/inventory';
import type { WholesaleDB } from '../../db/schema';

type InventoryItem = WholesaleDB['inventory']['value'];

export function InventoryList({ refreshTrigger }: { refreshTrigger: number }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    listInventory()
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [refreshTrigger]);

  function startEdit(item: InventoryItem) {
    setEditingId(item.id);
    setEditPrice(String(item.marketPrice));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setEditError('Price must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      await updateInventoryItem(id, { marketPrice: price });
      setEditingId(null);
      load(); // refetch so the table reflects the saved value, not just local state
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="max-w-xl mx-auto my-12 text-center font-sans text-[#6b6555]">
        Loading inventory…
      </p>
    );
  }

  if (error) {
    return (
      <p className="max-w-xl mx-auto my-12 text-center font-sans text-[#b54b3a]">
        Couldn't load inventory: {error}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto my-12 text-center font-sans text-[#6b6555]">
        <p>No products yet.</p>
        <p className="text-sm mt-1">Add a product to start tracking stock.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 font-sans text-[#2b2620]">
      <h1 className="font-serif text-2xl font-semibold mb-5">Inventory</h1>
      <table className="w-full border-collapse bg-[#faf7f2]">
        <thead>
          <tr>
            <th className="text-left px-3 py-2.5 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              Product
            </th>
            <th className="text-left px-3 py-2.5 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              In stock
            </th>
            <th className="text-left px-3 py-2.5 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              Market price
            </th>
            <th className="px-3 py-2.5 border-b border-[#e4dccb]"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <tr key={item.id} className={item.quantity === 0 ? 'text-[#b54b3a]' : undefined}>
                <td className="px-3 py-2.5 border-b border-[#e4dccb] font-serif text-base">
                  {item.productName}
                </td>
                <td className="px-3 py-2.5 border-b border-[#e4dccb]">
                  {formatStockDisplay(item)}
                </td>
                <td className="px-3 py-2.5 border-b border-[#e4dccb]">
                  {isEditing ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <span>₹</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-20 p-1 border border-[#d8cfb8] bg-white text-[#2b2620]"
                          autoFocus
                        />
                        <span>/ kg</span>
                      </div>
                      {editError && <span className="text-xs text-[#b54b3a]">{editError}</span>}
                    </div>
                  ) : (
                    <>
                      ₹{item.marketPrice.toFixed(2)} / kg
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5 border-b border-[#e4dccb] text-right whitespace-nowrap">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveEdit(item.id)}
                        disabled={saving}
                        className="text-sm underline mr-2 disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="text-sm text-[#6b6555] underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startEdit(item)}
                      className="text-sm text-[#6b6555] underline"
                    >
                      Edit price
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
