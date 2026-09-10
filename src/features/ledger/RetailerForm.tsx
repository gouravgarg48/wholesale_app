import { useState, type FormEvent } from 'react';
import { createRetailer } from '../../db/retailers';

const inputClass = 'text-base p-2 border border-[#d8cfb8] bg-white text-[#2b2620]';
const fieldLabelClass = 'flex flex-col gap-1 text-sm text-[#6b6555] mb-3.5';

export function RetailerForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const limit = Number(creditLimit || 0);
    if (!Number.isFinite(limit) || limit < 0) {
      setError('Credit limit must be a non-negative number.');
      return;
    }

    setSaving(true);
    try {
      await createRetailer({
        name,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        creditLimit: limit,
      });
      setName('');
      setPhone('');
      setAddress('');
      setCreditLimit('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save retailer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="max-w-lg mx-auto mb-8 p-6 bg-[#faf7f2] border border-[#e4dccb] font-sans text-[#2b2620]"
      onSubmit={handleSubmit}
    >
      <h2 className="font-serif text-xl mb-4">Add retailer</h2>

      <label className={fieldLabelClass}>
        Name
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sharma Traders"
        />
      </label>

      <label className={fieldLabelClass}>
        Phone (optional)
        <input
          className={inputClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="9999999999"
        />
      </label>

      <label className={fieldLabelClass}>
        Address (optional)
        <input
          className={inputClass}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Main Market, ..."
        />
      </label>

      <label className={fieldLabelClass}>
        Credit limit (₹)
        <input
          className={inputClass}
          type="number"
          min="0"
          step="1"
          value={creditLimit}
          onChange={(e) => setCreditLimit(e.target.value)}
          placeholder="50000"
        />
      </label>

      {error && <p className="text-[#b54b3a] text-sm mb-3">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="bg-[#2b2620] text-[#faf7f2] border-none px-5 py-2.5 text-[0.95rem] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save retailer'}
      </button>
    </form>
  );
}
