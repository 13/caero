type DateFormat = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

export const DEFAULT_CHECK_INTERVAL_MINUTES = 60
export const MIN_CHECK_INTERVAL_MINUTES = 30
export const MIN_CHECK_INTERVAL_HOURS = 0.5
export const CHECK_INTERVAL_HOUR_STEP = 0.5

export function localeFromDateFormat(format?: DateFormat) {
  if (format === 'DD.MM.YYYY') return 'de-DE'
  if (format === 'DD/MM/YYYY') return 'en-GB'
  if (format === 'MM/DD/YYYY') return 'en-US'
  if (format === 'YYYY-MM-DD') return 'sv-SE'
  return navigator.language || 'en-US'
}

export function formatPrice(value: string | null) {
  if (!value) return '—'
  return `€ ${parseFloat(value).toFixed(2)}`
}

export function formatPercent(value: string | null) {
  if (!value) return '—'
  const numeric = parseFloat(value)
  const sign = numeric > 0 ? '+' : ''
  return `${sign}${numeric.toFixed(2)}%`
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

export function intervalMinutesToHours(minutes: number) {
  return minutes / 60
}

export function normalizeIntervalHoursToMinutes(hours: number) {
  if (Number.isNaN(hours)) return DEFAULT_CHECK_INTERVAL_MINUTES
  return Math.max(MIN_CHECK_INTERVAL_MINUTES, Math.round(hours * 60))
}

export function formatIntervalHours(minutes: number) {
  return intervalMinutesToHours(minutes).toFixed(1).replace(/\.0$/, '')
}
