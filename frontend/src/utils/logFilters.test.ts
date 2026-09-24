import { describe, expect, it } from 'vitest'
import type { EventLogEntry } from '../api/types'
import { eventDetailRows, logQueryString, parseLogFilters, writeLogFilters } from './logFilters'

describe('log filters', () => {
  it('parses valid values and drops invalid ones', () => {
    const f = parseLogFilters(new URLSearchParams('tab=logs&level=error,bogus,warning&category=nope&product=12&product_name=Widget&q=abc'))
    expect(f).toEqual({ levels: ['error', 'warning'], category: null, productId: 12, productName: 'Widget', q: 'abc' })
  })

  it('ignores a non-positive or non-integer product', () => {
    expect(parseLogFilters(new URLSearchParams('product=-1')).productId).toBeNull()
    expect(parseLogFilters(new URLSearchParams('product=1.5')).productId).toBeNull()
  })

  it('writes filters back and keeps unrelated params such as tab', () => {
    const params = writeLogFilters(new URLSearchParams('tab=logs&q=old'), {
      levels: ['info'], category: 'scrape', productId: null, productName: null, q: '  ',
    })
    expect(params.toString()).toBe('tab=logs&level=info&category=scrape')
  })

  it('round-trips', () => {
    const f = { levels: ['error' as const], category: 'alert' as const, productId: 3, productName: 'X', q: 'hi' }
    expect(parseLogFilters(writeLogFilters(new URLSearchParams(), f))).toEqual(f)
  })

  it('builds the API query with repeated level params and cursor', () => {
    const qs = logQueryString(
      { levels: ['error', 'warning'], category: null, productId: 7, productName: 'X', q: ' a ' }, 99, 50,
    )
    expect(qs).toBe('level=error&level=warning&product_id=7&q=a&before_id=99&limit=50')
  })
})

describe('eventDetailRows', () => {
  const base: EventLogEntry = {
    id: 1, created_at: '2026-09-24T10:00:00Z', level: 'warning', category: 'scrape', event: 'scrape_failed',
    product_id: 1, product_name: 'P', message: 'm', duration_ms: 1500,
    details: { error: 'no_match', consecutive_failures: 2, extra: { a: 1 }, none: null },
  }

  it('lists event, duration and details', () => {
    expect(eventDetailRows(base)).toEqual([
      ['event', 'scrape_failed'],
      ['duration', '1.5 s'],
      ['error', 'no_match'],
      ['consecutive_failures', '2'],
      ['extra', '{"a":1}'],
      ['none', '—'],
    ])
  })
})
