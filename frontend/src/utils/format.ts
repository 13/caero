type DateFormat = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

export const DEFAULT_CHECK_INTERVAL_MINUTES = 1440
export const MIN_CHECK_INTERVAL_MINUTES = 30
export const MIN_CHECK_INTERVAL_HOURS = 0.5
export const CHECK_INTERVAL_HOUR_STEP = 0.5
export const DEFAULT_CHECK_TIME_HHMM = '10:00'

const CHECK_TIME_HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function localeFromDateFormat(format?: DateFormat) {
  if (format === 'DD.MM.YYYY') return 'de-DE'
  if (format === 'DD/MM/YYYY') return 'en-GB'
  if (format === 'MM/DD/YYYY') return 'en-US'
  if (format === 'YYYY-MM-DD') return 'sv-SE'
  return navigator.language || 'en-US'
}

export function formatPrice(value: string | null, format?: DateFormat, currency = 'EUR') {
  if (!value) return '—'
  const locale = localeFromDateFormat(format)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(parseFloat(value))
  } catch {
    // Unknown currency code stored in the DB — fall back to a plain number.
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(value))
  }
}

/** Whether a price change is good, bad, or neutral news for this product.
 *  Default: a drop is good (deal hunting). inverse_price flips it (products
 *  where rising value is good news). */
export function priceChangeSentiment(pct: number, inversePrice = false): 'good' | 'bad' | 'neutral' {
  if (pct === 0 || !Number.isFinite(pct)) return 'neutral'
  const dropped = pct < 0
  return dropped !== inversePrice ? 'good' : 'bad'
}

export function currencySymbol(currency = 'EUR', format?: DateFormat) {
  try {
    return (0)
      .toLocaleString(localeFromDateFormat(format), {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
      .replace(/\d/g, '')
      .trim()
  } catch {
    return currency
  }
}

export function formatPercent(value: string | null, format?: DateFormat) {
  if (!value) return '—'
  const numeric = parseFloat(value)
  const sign = numeric > 0 ? '+' : ''
  const locale = localeFromDateFormat(format)
  const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric)
  return `${sign}${formatted}%`
}

export function formatDate(value: string | null, format = 'DD.MM.YYYY') {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear())
  if (format === 'DD/MM/YYYY') return `${day}/${month}/${year}`
  if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`
  return `${day}.${month}.${year}`
}

export function formatDateTime(value: string | null, format = 'DD.MM.YYYY') {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const dateStr = formatDate(value, format)
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${dateStr} ${hours}:${minutes}`
}

export function intervalMinutesToHours(minutes: number) {
  return minutes / 60
}

export function normalizeIntervalHoursToMinutes(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.max(MIN_CHECK_INTERVAL_MINUTES, Math.round(hours * 60))
}

export function formatIntervalHours(minutes: number) {
  if (minutes <= 0) return 'Disabled'
  return intervalMinutesToHours(minutes).toFixed(1).replace(/\.0$/, '')
}

export function normalizeCheckTimeHHMM(value?: string | null) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return DEFAULT_CHECK_TIME_HHMM
  return CHECK_TIME_HHMM_RE.test(trimmed) ? trimmed : DEFAULT_CHECK_TIME_HHMM
}

