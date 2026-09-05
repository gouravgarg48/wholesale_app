import { useEffect, useState, type FormEvent } from 'react';
import { listRetailers } from '../../db/retailers';
import { getRetailerBalance } from '../../db/sales';
import { createPayment } from '../../db/payments';
import type { WholesaleDB } from '../../db/schema';

type Retailer = WholesaleDB['retailers']['value'];
type Method = WholesaleDB['payments']['value']['method'];

const inputClass = "text-base p-2 border border-[#d8cfb8] bg-white text-[#2b2620]";

export function PaymentForm({ onCreated }: { onCreated: () => void }) {
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [retailerId, setRetailerId] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listRetailers().then(setRetailers);
  }, []);

  useEffect(() => {
    if (!retailerId) {
      setBalance(null);
      return;
    }
    getRetailerBalance(retailerId).then(setBalance);
  }, [retailerId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!retailerId) {
      setError('Select a retailer.');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      await createPayment(retailerId, amt, method);
      setAmount('');
      const refreshedBalance = await getRetailerBalance(retailerId);
      setBalance(refreshedBalance);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  }

  if (retailers.length === 0) {
    return (
      <div className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#6b6555] text-sm">
        Add a retailer before recording a payment.
      </div>
    );
  }

  return (
    <form className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#2b2620]" onSubmit={handleSubmit}>
      <h2 className="font-serif text-xl mb-4">Record payment</h2>

      <label className="flex flex-col gap-1 text-sm text-[#6b6555] mb-3">
        Retailer
        <select className={inputClass} value={retailerId} onChange={(e) => setRetailerId(e.target.value)}>
          <option value="">Select retailer…</option>
          {retailers.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>

      {retailerId && balance !== null && (
        <p className="text-sm text-[#6b6555] mb-3">
          Currently owes: <span className="font-semibold text-[#2b2620]">₹{balance.toFixed(2)}</span>
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm text-[#6b6555] mb-3">
        Amount (₹)
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-[#6b6555] mb-4">
        Method
        <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </select>
      </label>

      {error && <p className="text-[#b54b3a] text-sm mb-3">{error}</p>}

      <button type="submit" disabled={saving} className="bg-[#2b2620] text-[#faf7f2] border-none px-5 py-2.5 text-[0.95rem] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
        {saving ? 'Saving…' : 'Record payment'}
      </button>
    </form>
  );
}