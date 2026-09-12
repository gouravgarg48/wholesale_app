import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDB } from '../../db/schema';
import type { WholesaleDB } from '../../db/schema';
import { listInventory, pluralUnit, formatWeight } from '../../db/inventory';
import { getRetailer } from '../../db/retailers';
import { assignInvoiceNumber } from '../../db/invoices';

type Sale = WholesaleDB['sales']['value'];
type Retailer = WholesaleDB['retailers']['value'];
type InventoryItem = WholesaleDB['inventory']['value'];

// Hardcoded business identity for now — Phase 6 (UI pass) will move this
// to an editable settings record. Change these constants, not the code.
const BUSINESS = {
  name: 'Shri Ram Enterprises',
  phone: '88826 36888',
  address: 'Naharpur, Rohini',
};

function formatRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function invoiceNumberLabel(n: number): string {
  return String(n).padStart(4, '0');
}

type BillRow = {
  name: string;
  unit: string;
  quantity: number;
  weightPerUnitKg: number;
  ratePerKg: number;
  grossWeightKg: number;
  amount: number;
};

function BillContent({
  sale,
  retailer,
  inventory,
  invoiceNumber,
}: {
  sale: Sale;
  retailer: Retailer | null;
  inventory: InventoryItem[];
  invoiceNumber: number | null;
}) {
  const buyer = sale.saleType === 'RETAIL' ? retailer : null;

  const rows: BillRow[] = sale.items.map((item) => {
    const product = inventory.find((p) => p.id === item.inventoryId);
    const weightPerUnitKg = item.weightPerUnitKg ?? product?.weightPerUnitKg ?? 1;
    const grossWeightKg = item.quantity * weightPerUnitKg;
    return {
      name: product?.productName ?? 'Unknown item',
      unit: item.unit,
      quantity: item.quantity,
      weightPerUnitKg,
      ratePerKg: item.salePrice,
      grossWeightKg,
      amount: grossWeightKg * item.salePrice,
    };
  });
  const totalWeightKg = rows.reduce((sum, r) => sum + r.grossWeightKg, 0);

  return (
    <div className="print-area bg-white text-[#1c1a17] w-full max-w-[740px] shadow-xl rounded-sm overflow-hidden print:shadow-none print:rounded-none">
      <div className="px-8 py-6 print:px-6 print:py-4">
        <div className="flex justify-between items-start border-b-2 border-[#2b2620] pb-4 mb-4">
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-wide">{BUSINESS.name}</h1>
            <p className="text-sm mt-1">{BUSINESS.address}</p>
            <p className="text-sm">Ph: {BUSINESS.phone}</p>
          </div>
          <div className="text-right">
            <p className="font-serif text-lg font-semibold uppercase tracking-widest">Invoice</p>
            <p className="text-sm mt-1">
              No. {invoiceNumber ? invoiceNumberLabel(invoiceNumber) : '…'}
            </p>
            <p className="text-sm">Date: {formatDate(sale.date)}</p>
          </div>
        </div>

        <div className="flex justify-between mb-4 text-sm">
          <div>
            <p className="text-[#6b6555] uppercase text-xs tracking-wider mb-1">Billed to</p>
            {buyer ? (
              <>
                <p className="font-medium text-base">{buyer.name}</p>
                {buyer.phone && <p>Ph: {buyer.phone}</p>}
                {buyer.address && <p>{buyer.address}</p>}
              </>
            ) : (
              <p className="font-medium text-base">{sale.buyerName}</p>
            )}
          </div>
          {sale.status === 'cancelled' && (
            <p className="self-start text-[#b54b3a] font-semibold uppercase">Cancelled</p>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-[#2b2620]">
              <th className="text-left py-2 pr-1 font-semibold w-6">#</th>
              <th className="text-left py-2 pr-1 font-semibold">Item</th>
              <th className="text-right py-2 px-1 font-semibold">Qty</th>
              <th className="text-right py-2 px-1 font-semibold">Wt/unit</th>
              <th className="text-right py-2 px-1 font-semibold">Gross wt</th>
              <th className="text-right py-2 px-1 font-semibold">Rate</th>
              <th className="text-right py-2 pl-1 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-[#e4dccb]">
                <td className="py-2 pr-1">{idx + 1}</td>
                <td className="py-2 pr-1">{row.name}</td>
                <td className="py-2 px-1 text-right whitespace-nowrap">
                  {row.quantity} {pluralUnit(row.unit, row.quantity)}
                </td>
                <td className="py-2 px-1 text-right whitespace-nowrap">
                  {formatWeight(row.weightPerUnitKg)} kg
                </td>
                <td className="py-2 px-1 text-right whitespace-nowrap">
                  {formatWeight(row.grossWeightKg)} kg
                </td>
                <td className="py-2 px-1 text-right whitespace-nowrap">
                  {formatRupees(row.ratePerKg)}/kg
                </td>
                <td className="py-2 pl-1 text-right whitespace-nowrap">
                  {formatRupees(row.amount)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-3 pr-1" colSpan={4}>
                <span className="font-semibold">Total</span>
              </td>
              <td className="py-3 px-1 text-right">{formatWeight(totalWeightKg)} kg</td>
              <td className="py-3 pl-1 text-right font-bold" colSpan={2}>
                {formatRupees(sale.totalAmount)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-8 flex justify-between text-xs text-[#6b6555] print:mt-6">
          <div className="text-center">
            <div className="border-t border-[#2b2620] pt-1 px-8 mt-7 print:mt-5">
              Receiver's signature
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-[#2b2620] pt-1 px-8 mt-7 print:mt-5">
              For {BUSINESS.name}
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-[10px] text-[#b3a98f] print:mt-3">
          Computer-generated invoice · {BUSINESS.name}, {BUSINESS.phone}
        </p>
      </div>
    </div>
  );
}

export function BillPrintView({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [retailer, setRetailer] = useState<Retailer | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const [saleRecord, inventoryList, invoiceNum] = await Promise.all([
          db.get('sales', saleId),
          listInventory(),
          assignInvoiceNumber(saleId),
        ]);
        if (!saleRecord) {
          setError('Sale not found.');
          return;
        }
        setSale(saleRecord);
        setInventory(inventoryList);
        setInvoiceNumber(invoiceNum);
        if (saleRecord.saleType === 'RETAIL' && saleRecord.retailerId) {
          setRetailer((await getRetailer(saleRecord.retailerId)) ?? null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load bill.');
      }
    })();
  }, [saleId]);

  const printScaffold =
    error || !sale
      ? null
      : createPortal(
          <div id="print-scaffold" aria-hidden="true">
            <BillContent
              sale={sale}
              retailer={retailer}
              inventory={inventory}
              invoiceNumber={invoiceNumber}
            />
          </div>,
          document.body,
        );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto print:static print:overflow-visible print:bg-white">
      <div className="min-h-full flex flex-col items-center p-4 print:p-0">
        <div className="w-full flex justify-between mb-4 print:hidden">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/90 text-[#2b2620] text-sm font-medium shadow"
          >
            ← Back to sales
          </button>
          {error ? (
            <span className="text-[#b54b3a] text-sm self-center">{error}</span>
          ) : !sale ? (
            <span className="text-[#6b6555] text-sm self-center">Loading…</span>
          ) : (
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg bg-[#1e293b] text-white text-sm font-medium shadow"
            >
              Print bill
            </button>
          )}
        </div>

        {sale && (
          <BillContent
            sale={sale}
            retailer={retailer}
            inventory={inventory}
            invoiceNumber={invoiceNumber}
          />
        )}
      </div>
      {printScaffold}
    </div>
  );
}