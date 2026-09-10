// Date.now() can return the same millisecond for two records created in
// rapid succession (definitely happens in tests, and plausibly in real use
// too — e.g. two sales entered back-to-back). Any code that relies on
// "date" fields for ordering (FIFO payment allocation, later: aging views)
// needs a guarantee that timestamps are always strictly increasing, not
// just "usually different." This wraps Date.now() to provide that.
let lastTimestamp = 0;

export function monotonicNow(): number {
  const now = Date.now();
  if (now <= lastTimestamp) {
    lastTimestamp += 1;
    return lastTimestamp;
  }
  lastTimestamp = now;
  return now;
}
