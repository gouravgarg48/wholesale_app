import { useEffect, useState } from 'react';
import { listRetailers } from '../../db/retailers';
import { getRetailerBalance } from '../../db/sales';
import type { WholesaleDB } from '../../db/schema';

type Retailer = WholesaleDB['retailers']['value'];

export function RetailerList({ refreshTrigger }: { refreshTrigger: number }) {
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});

  useEffect(() => {
    listRetailers().then(async (list) => {
      setRetailers(list);
      const entries = await Promise.all(
        list.map(async (r) => [r.id, await getRetailerBalance(r.id)] as const)
      );
      setBalances(Object.fromEntries(entries));
    });
  }, [refreshTrigger]);

  if (retailers.length === 0) {
    return <p className="max-w-xl mx-auto my-6 text-center font-sans text-[#6b6555] text-sm">No retailers yet.</p>;
  }

  return (
    <div className="max-w-2xl mx-auto px-6 pb-8 font-sans text-[#2b2620]">
      <h2 className="font-serif text-xl font-semibold mb-3">Retailers</h2>
      <table className="w-full border-collapse bg-[#faf7f2]">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">Name</th>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">Phone</th>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">Balance owed</th>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">Credit limit</th>
          </tr>
        </thead>
        <tbody>
          {retailers.map((r) => {
            const balance = balances[r.id] ?? 0;
            const overLimit = balance > r.creditLimit;
            return (
              <tr key={r.id}>
                <td className="px-3 py-2 border-b border-[#e4dccb] font-serif">{r.name}</td>
                <td className="px-3 py-2 border-b border-[#e4dccb]">{r.phone ?? '—'}</td>
                <td className={`px-3 py-2 border-b border-[#e4dccb] ${overLimit ? 'text-[#b54b3a] font-semibold' : ''}`}>
                  ₹{balance.toFixed(2)}
                </td>
                <td className="px-3 py-2 border-b border-[#e4dccb]">₹{r.creditLimit.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}