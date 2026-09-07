import { getDB } from './schema';
import type { WholesaleDB } from './schema';
import { monotonicNow } from './clock';

type Invoice = WholesaleDB['invoices']['value'];

const INVOICE_SEQUENCE_ID = 'invoiceNumber';

/**
 * Returns a sale's already-assigned invoice number, or undefined if the
 * sale has never been printed. Read-only — does not allocate.
 */
export async function getInvoiceNumberForSale(saleId: string): Promise<number | undefined> {
  const db = await getDB();
  const invoice = await db.get('invoices', saleId);
  return invoice?.invoiceNumber;
}

/**
 * Assigns the next sequential invoice number for a sale. Safe to call
 * repeatedly: a sale that already has a number keeps it (reprints must
 * not renumber a bill), and the sequence counter is only advanced when a
 * genuinely new number is issued.
 */
export async function assignInvoiceNumber(saleId: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(['invoices', 'counters'], 'readwrite');
  const invoicesStore = tx.objectStore('invoices');
  const countersStore = tx.objectStore('counters');

  try {
    // Reprint of an already-numbered sale — reuse the existing number.
    const existing = await invoicesStore.get(saleId);
    if (existing) {
      return existing.invoiceNumber;
    }

    const counter = await countersStore.get(INVOICE_SEQUENCE_ID);
    const nextNumber = (counter?.value ?? 0) + 1;

    const invoice: Invoice = { saleId, invoiceNumber: nextNumber, createdAt: monotonicNow() };
    await invoicesStore.add(invoice);
    await countersStore.put({ id: INVOICE_SEQUENCE_ID, value: nextNumber });
    await tx.done;

    return nextNumber;
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