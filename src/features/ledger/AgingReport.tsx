import { useEffect, useState } from 'react';
import { getAgingReport, type RetailerAging, type AgingBucket } from '../../db/aging';

const BUCKET_COLORS: Record<AgingBucket, string> = {
  current: 'text-[#3f5d43]',
  '7+': 'text-[#b8863b]',
  '15+': 'text-[#b8863b]',
  '30+': 'text-[#b54b3a] font-semibold',
};

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current',
  '7+': '7+ days',
  '15+': '15+ days',
  '30+': '30+ days',
};

export function AgingReport({ refreshTrigger }: { refreshTrigger: number }) {
  const [report, setReport] = useState<RetailerAging[]>([]);

  useEffect(() => {
    getAgingReport().then(setReport);
  }, [refreshTrigger]);

  if (report.length === 0) {
    return <p className="max-w-xl mx-auto my-6 text-center font-sans text-[#6b6555] text-sm">Nobody owes anything right now.</p>;
  }

  return (
    <div className="max-w-2xl mx-auto px-6 pb-8 font-sans text-[#2b2620]">
      <h2 className="font-serif text-xl font-semibold mb-3">Who owes what</h2>
      <div className="bg-[#faf7f2] border border-[#e4dccb]">
        {report.map((r) => (
          <div key={r.retailerId} className="px-4 py-3 border-b border-[#e4dccb] last:border-0">
            <div className="flex justify-between items-baseline mb-1">
              <span className="font-serif text-base">{r.retailerName}</span>
              <span className={`text-sm ${BUCKET_COLORS[r.oldestBucket]}`}>
                ₹{r.totalOutstanding.toFixed(2)} · oldest: {BUCKET_LABELS[r.oldestBucket]}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {r.entries.map((e) => (
                <div key={e.saleId} className="flex justify-between text-xs text-[#6b6555]">
                  <span>{e.daysOld} days old</span>
                  <span className={BUCKET_COLORS[e.bucket]}>₹{e.amountOutstanding.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}