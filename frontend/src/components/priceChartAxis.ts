// Pure helpers for PriceChart, kept out of the component so they are
// unit-testable without rendering recharts.

/** Stored chart_line_style → recharts curve type. Unknown or missing values
 *  fall back to the curved default rather than dropping the line. */
export function lineTypeFor(style: string | undefined): 'monotone' | 'linear' | 'stepAfter' {
  switch (style) {
    case 'straight':
      return 'linear'
    case 'stepped':
      return 'stepAfter'
    default:
      return 'monotone'
  }
}

/** Y-axis bounds hugging the data (with ~10% headroom), rounded to a tidy
 *  step. Starting at 0 flattens a 1,650–2,100 range into a straight line. */
export function priceAxisDomain(prices: number[]): [number, number] {
  const finite = prices.filter(Number.isFinite)
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const spread = max - min || Math.abs(max) * 0.1 || 1
  const pad = spread * 0.1
  const step = 10 ** Math.floor(Math.log10(spread))
  const lo = Math.max(0, Math.floor((min - pad) / step) * step)
  const hi = Math.ceil((max + pad) / step) * step
  return [lo, hi]
}

/** Drop the year from a formatted date (from formatDate) for compact ticks. */
export function shortDate(formatted: string, format?: string) {
  if (format === 'YYYY-MM-DD') return formatted.slice(5)
  return formatted.slice(0, 5)
}
