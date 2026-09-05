import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { monotonicNow } from './clock';
import { generateId } from './id';

type PaymentRecord = WholesaleDB['payments']['value'];
type PaymentMethod = PaymentRecord['method'];

export async function createPayment(
  retailerId: string,
  amount: number,
  method: PaymentMethod
): Promise<PaymentRecord> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be a positive number');
  }

  const db = await getDB();
  const tx = db.transaction(['payments', 'sales'], 'readwrite');
  const paymentsStore = tx.objectStore('payments');
  const salesStore = tx.objectStore('sales');
  const salesIndex = salesStore.index('by-retailer');

  try {
    const allSales = await salesIndex.getAll(retailerId);
    // Oldest unpaid/partial sales first — FIFO settlement, the standard
    // convention for "pay down what you owe" without asking the user to
    // hand-pick which bill a payment applies to.
    const unpaidSales = allSales
      .filter((s) => s.status === 'active' && s.paymentStatus !== 'paid')
      .sort((a, b) => a.date - b.date);

    const totalOwed = unpaidSales.reduce((sum, s) => sum + (s.totalAmount - s.amountPaid), 0);
    if (amount > totalOwed) {
      throw new Error(
        `Payment of ₹${amount.toFixed(2)} exceeds total owed of ₹${totalOwed.toFixed(2)} — this app doesn't track advance credit balances yet`
      );
    }

    const allocations: { saleId: string; amountApplied: number }[] = [];
    let remaining = amount;

    for (const sale of unpaidSales) {
      if (remaining <= 0) break;

      const owedOnThisSale = sale.totalAmount - sale.amountPaid;
      const applied = Math.min(remaining, owedOnThisSale);

      sale.amountPaid += applied;
      sale.paymentStatus = sale.amountPaid >= sale.totalAmount ? 'paid' : 'partial';
      await salesStore.put(sale);

      allocations.push({ saleId: sale.id, amountApplied: applied });
      remaining -= applied;
    }

    const payment: PaymentRecord = {
      id: generateId(),
      retailerId,
      amount,
      method,
      allocations,
      date: monotonicNow(),
    };

    await paymentsStore.add(payment);
    await tx.done;

    return payment;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // already finished/aborted
    }
    tx.done.catch(() => {});
    throw err;
  }
}