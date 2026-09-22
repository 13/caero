import { describe, expect, it } from 'vitest'
import { lineTypeFor, priceAxisDomain, shortDate } from './priceChartAxis'

describe('priceAxisDomain', () => {
  it('hugs the data instead of starting at zero', () => {
    const [lo, hi] = priceAxisDomain([1950, 2049, 1695.8, 1950])
    expect(lo).toBeGreaterThan(1500)
    expect(lo).toBeLessThanOrEqual(1695.8)
    expect(hi).toBeGreaterThanOrEqual(2049)
    expect(hi).toBeLessThan(2200)
  })

  it('never goes below zero', () => {
    expect(priceAxisDomain([0.5, 3])[0]).toBe(0)
  })

  it('gives a flat series a visible range', () => {
    const [lo, hi] = priceAxisDomain([100, 100])
    expect(lo).toBeLessThan(100)
    expect(hi).toBeGreaterThan(100)
  })

  it('handles empty input', () => {
    expect(priceAxisDomain([])).toEqual([0, 1])
  })
})

describe('shortDate', () => {
  it.each([
    ['14.07.2026', 'DD.MM.YYYY', '14.07'],
    ['14/07/2026', 'DD/MM/YYYY', '14/07'],
    ['07/14/2026', 'MM/DD/YYYY', '07/14'],
    ['2026-07-14', 'YYYY-MM-DD', '07-14'],
  ])('%s (%s) → %s', (input, format, expected) => {
    expect(shortDate(input, format)).toBe(expected)
  })
})

describe('lineTypeFor', () => {
  it('maps the stored styles to recharts curve types', () => {
    expect(lineTypeFor('curved')).toBe('monotone')
    expect(lineTypeFor('straight')).toBe('linear')
    expect(lineTypeFor('stepped')).toBe('stepAfter')
  })

  it('falls back to the curved default for missing or unknown values', () => {
    expect(lineTypeFor(undefined)).toBe('monotone')
    expect(lineTypeFor('squiggly')).toBe('monotone')
  })
})
