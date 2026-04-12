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

