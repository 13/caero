import { describe, expect, it } from 'vitest'
import { checkFailureMessage, describeFailure, failureSeverity, formatTimeAgo } from './scrapeFailure'

describe('failureSeverity', () => {
  it('stays quiet below the notification threshold', () => {
    expect(failureSeverity(0)).toBe('none')
    expect(failureSeverity(1)).toBe('minor')
    expect(failureSeverity(2)).toBe('minor')
    expect(failureSeverity(3)).toBe('broken')
  })

  it('follows the server threshold', () => {
    expect(failureSeverity(1, 1)).toBe('broken')
    expect(failureSeverity(4, 5)).toBe('minor')
  })
})

describe('describeFailure', () => {
  it('points at the selector only when it is the likely cause', () => {
    expect(describeFailure('no_match').selectorFix).toBe(true)
    expect(describeFailure('unparseable').selectorFix).toBe(true)
    expect(describeFailure('timeout').selectorFix).toBe(false)
    expect(describeFailure('unavailable').selectorFix).toBe(false)
  })

  it('falls back for unknown or missing reasons', () => {
    expect(describeFailure(null).short).toBe('No price found')
    expect(describeFailure('something_new').short).toBe('No price found')
  })

  it('blames the outage, not the selector, while scraping is degraded', () => {
    const copy = describeFailure('no_match', true)
    expect(copy.selectorFix).toBe(false)
    expect(copy.detail).toMatch(/many products/)
  })
})

describe('checkFailureMessage', () => {
  it('prefers the reason, then the error', () => {
    expect(checkFailureMessage({ product_id: 1, price: null, error: 'Could not scrape price', reason: 'timeout' }))
      .toBe('No price found: page took too long')
    expect(checkFailureMessage({ product_id: 1, price: null, error: 'URL redirected' })).toBe('URL redirected')
  })
})

describe('formatTimeAgo', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  it('rounds down to a coarse unit', () => {
    expect(formatTimeAgo('2026-09-23T11:59:30Z', now)).toBe('just now')
    expect(formatTimeAgo('2026-09-23T11:15:00Z', now)).toBe('45 min ago')
    expect(formatTimeAgo('2026-09-23T07:00:00Z', now)).toBe('5 h ago')
    expect(formatTimeAgo('2026-09-22T11:00:00Z', now)).toBe('1 day ago')
    expect(formatTimeAgo('2026-09-20T12:00:00Z', now)).toBe('3 days ago')
  })

  it('returns empty for missing or bad input', () => {
    expect(formatTimeAgo(null, now)).toBe('')
    expect(formatTimeAgo('nope', now)).toBe('')
  })
})
