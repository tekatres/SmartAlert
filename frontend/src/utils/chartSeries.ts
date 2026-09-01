// Mock helper: generates a synthetic price series around the alert's price
// for the detail page sparkline. In production you'd query the engine or
// a historical endpoint.
export function buildPriceSeries(
  currentPrice: number,
  previousPrice: number,
  points = 24,
): { ts: number; price: number }[] {
  const now = Date.now();
  const stepMs = (5 * 60 * 1000); // 5-minute buckets
  const start = previousPrice;
  const end = currentPrice;
  const series: { ts: number; price: number }[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    // Smooth ease + small noise
    const base = start + (end - start) * t;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * (Math.abs(end - start) * 0.04 + currentPrice * 0.001);
    const price = Math.max(0, base + noise);
    series.push({ ts: now - (points - 1 - i) * stepMs, price });
  }
  return series;
}

export function buildVolumeSeries(seed: number, points = 24): number[] {
  return Array.from({ length: points }).map((_, i) => {
    const base = 1 + (Math.sin(i * 0.6 + seed) * 0.3 + Math.cos(i * 0.3) * 0.2);
    return base;
  });
}
