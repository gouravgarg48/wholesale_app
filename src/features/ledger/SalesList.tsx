import { useEffect, useState } from 'react';
import { listSales } from '../../db/sales';
import { listRetailers } from '../../db/retailers';
import type { WholesaleDB } from '../../db/schema';
import { ReturnForm } from './ReturnForm';
import { BillPrintView } from '../billing/BillPrintView';

type Sale = WholesaleDB['sales']['value'];
type Retailer = WholesaleDB['retailers']['value'];

export function SalesList({ refreshTrigger }: { refreshTrigger: number }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [retailerNames, setRetailerNames] = useState<Record<string, string>>({});
  const [returningSaleId, setReturningSaleId] = useState<string | null>(null);
  const [printingSaleId, setPrintingSaleId] = useState<string | null>(null);

  function load() {
    listSales().then(setSales);
    listRetailers().then((list) => {
      setRetailerNames(Object.fromEntries(list.map((r: Retailer) => [r.id, r.name])));
    });
  }

  useEffect(load, [refreshTrigger]);

  function handleReturnCreated() {
    setReturningSaleId(null);
    load();
  }

  if (sales.length === 0) {
    return (
      <p className="max-w-2xl mx-auto my-6 text-center font-sans text-[#6b6555] text-sm">
        No sales yet.
      </p>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 pb-8 font-sans text-[#2b2620]">
      <h2 className="font-serif text-xl font-semibold mb-3">Sales</h2>
      <table className="w-full border-collapse bg-[#faf7f2] mb-4">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              Date
            </th>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              Buyer
            </th>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              Total
            </th>
            <th className="text-left px-3 py-2 border-b border-[#e4dccb] text-sm font-semibold text-[#6b6555]">
              Status
            </th>
            <th className="px-3 py-2 border-b border-[#e4dccb]"></th>
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => {
            const buyer =
              sale.saleType === 'CASH' ? sale.buyerName : (retailerNames[sale.retailerId!] ?? '—');
            return (
              <tr key={sale.id}>
                <td className="px-3 py-2 border-b border-[#e4dccb] text-sm">
                  {new Date(sale.date).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 border-b border-[#e4dccb]">{buyer}</td>
                <td className="px-3 py-2 border-b border-[#e4dccb]">
                  ₹{sale.totalAmount.toFixed(2)}
                </td>
                <td className="px-3 py-2 border-b border-[#e4dccb] text-sm">
                  {sale.status === 'cancelled' ? (
                    <span className="text-[#b54b3a]">Cancelled</span>
                  ) : (
                    <span>{sale.paymentStatus}</span>
                  )}
                </td>
                <td className="px-3 py-2 border-b border-[#e4dccb] text-right whitespace-nowrap">
                  {sale.status === 'active' && (
                    <button
                      onClick={() => setReturningSaleId(sale.id)}
                      className="text-sm underline mr-3"
                    >
                      Return
                    </button>
                  )}
                  <button onClick={() => setPrintingSaleId(sale.id)} className="text-sm underline">
                    Print
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {returningSaleId && (
        <ReturnForm
          saleId={returningSaleId}
          onCreated={handleReturnCreated}
          onCancel={() => setReturningSaleId(null)}
        />
      )}

      {printingSaleId && (
        <BillPrintView saleId={printingSaleId} onClose={() => setPrintingSaleId(null)} />
      )}
    </div>
  );
}
