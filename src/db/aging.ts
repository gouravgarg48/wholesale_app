import { getDB } from './schema';

export type AgingBucket = 'current' | '7+' | '15+' | '30+';

export type AgingEntry = {
  saleId: string;
  date: number;
  amountOutstanding: number;
  daysOld: number;
  bucket: AgingBucket;
};

export type RetailerAging = {
  retailerId: string;
  retailerName: string;
  totalOutstanding: number;
  entries: AgingEntry[];
  oldestBucket: AgingBucket; // the worst bucket this retailer has anything in
};

function bucketFor(daysOld: number): AgingBucket {
  if (daysOld >= 30) return '30+';
  if (daysOld >= 15) return '15+';
  if (daysOld >= 7) return '7+';
  return 'current';
}

// Ordering used to find the "worst" bucket a retailer falls into, for
// sorting the aging report so the most overdue retailers surface first.
const BUCKET_SEVERITY: Record<AgingBucket, number> = { current: 0, '7+': 1, '15+': 2, '30+': 3 };

/**
 * Builds a full aging report across all retailers with any outstanding
 * balance. `asOf` defaults to now but is a parameter so this stays testable
 * without depending on the real wall clock.
 */
export async function getAgingReport(asOf: number = Date.now()): Promise<RetailerAging[]> {
  const db = await getDB();
  const [retailers, allSales] = await Promise.all([
    db.getAll('retailers'),
    db.getAll('sales'),
  ]);

  const report: RetailerAging[] = [];

  for (const retailer of retailers) {
    const unpaidSales = allSales.filter(
      (s) => s.retailerId === retailer.id && s.status === 'active' && s.paymentStatus !== 'paid'
    );

    if (unpaidSales.length === 0) continue;

    const entries: AgingEntry[] = unpaidSales.map((sale) => {
      const daysOld = Math.floor((asOf - sale.date) / (1000 * 60 * 60 * 24));
      return {
        saleId: sale.id,
        date: sale.date,
        amountOutstanding: sale.totalAmount - sale.amountPaid,
        daysOld,
        bucket: bucketFor(daysOld),
      };
    });

    const totalOutstanding = entries.reduce((sum, e) => sum + e.amountOutstanding, 0);
    const oldestBucket = entries.reduce<AgingBucket>(
      (worst, e) => (BUCKET_SEVERITY[e.bucket] > BUCKET_SEVERITY[worst] ? e.bucket : worst),
      'current'
    );

    report.push({
      retailerId: retailer.id,
      retailerName: retailer.name,
      totalOutstanding,
      entries: entries.sort((a, b) => a.date - b.date), // oldest first within a retailer
      oldestBucket,
    });
  }

  // Worst-bucket retailers first, then by total outstanding descending
  return report.sort((a, b) => {
    const severityDiff = BUCKET_SEVERITY[b.oldestBucket] - BUCKET_SEVERITY[a.oldestBucket];
    if (severityDiff !== 0) return severityDiff;
    return b.totalOutstanding - a.totalOutstanding;
  });
}