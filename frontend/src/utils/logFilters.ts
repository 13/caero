import type { EventCategory, EventLevel, EventLogEntry } from '../api/types'
import { formatDuration } from './format'

export const LEVELS: readonly EventLevel[] = ['info', 'warning', 'error']
export const CATEGORIES: readonly EventCategory[] = ['scrape', 'alert', 'notification', 'system', 'maintenance']

export interface LogFilters {
  levels: EventLevel[]
  category: EventCategory | null
  productId: number | null
  /** Display-only label for the product chip; not sent to the API. */
  productName: string | null
  q: string
}

const FILTER_KEYS = ['level', 'category', 'product', 'product_name', 'q']

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const levels = (params.get('level') ?? '')
    .split(',')
    .filter((l): l is EventLevel => (LEVELS as readonly string[]).includes(l))
  const rawCategory = params.get('category')
  const category = (CATEGORIES as readonly string[]).includes(rawCategory ?? '') ? (rawCategory as EventCategory) : null
  const product = Number(params.get('product'))
  const productId = Number.isInteger(product) && product > 0 ? product : null
  return {
    levels,
    category,
    productId,
    productName: productId ? params.get('product_name') : null,
    q: params.get('q') ?? '',
  }
}

/** Returns a copy of `params` with the log filters replaced (other keys, e.g. `tab`, kept). */
export function writeLogFilters(params: URLSearchParams, filters: LogFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  FILTER_KEYS.forEach((key) => next.delete(key))
  if (filters.levels.length) next.set('level', filters.levels.join(','))
  if (filters.category) next.set('category', filters.category)
  if (filters.productId) {
    next.set('product', String(filters.productId))
    if (filters.productName) next.set('product_name', filters.productName)
  }
  if (filters.q.trim()) next.set('q', filters.q.trim())
  return next
}

export function logQueryString(filters: LogFilters, beforeId?: number, limit = 100): string {
  const p = new URLSearchParams()
  filters.levels.forEach((l) => p.append('level', l))
  if (filters.category) p.append('category', filters.category)
  if (filters.productId) p.set('product_id', String(filters.productId))
  if (filters.q.trim()) p.set('q', filters.q.trim())
  if (beforeId) p.set('before_id', String(beforeId))
  p.set('limit', String(limit))
  return p.toString()
}

export function eventDetailRows(entry: EventLogEntry): [string, string][] {
  const rows: [string, string][] = [['event', entry.event]]
  if (entry.duration_ms != null) rows.push(['duration', formatDuration(entry.duration_ms)])
  for (const [key, value] of Object.entries(entry.details ?? {})) {
    rows.push([key, value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)])
  }
  return rows
}
