import { useEffect, useState } from 'react';
import { listInventory, formatQuantityDisplay } from '../../db/inventory';
import type { WholesaleDB } from '../../db/schema';

type InventoryItem = WholesaleDB['inventory']['value'];

export function InventoryList({ refreshTrigger }: { refreshTrigger: number }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listInventory()
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [refreshTrigger]);

  if (loading) {
    return <p className="max-w-xl mx-auto my-12 text-center font-sans text-[#6b6555]">Loading inventory…</p>;
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
            <th className="text-left px-3 py-2.5 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">Product</th>
            <th className="text-left px-3 py-2.5 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">In stock</th>
            <th className="text-left px-3 py-2.5 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">Market price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={item.quantity === 0 ? 'text-[#b54b3a]' : undefined}>
              <td className="px-3 py-2.5 border-b border-[#e4dccb] font-serif text-base">{item.productName}</td>
              <td className="px-3 py-2.5 border-b border-[#e4dccb]">{formatQuantityDisplay(item)}</td>
              <td className="px-3 py-2.5 border-b border-[#e4dccb]">₹{item.marketPrice.toFixed(2)} / {item.baseUnit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}