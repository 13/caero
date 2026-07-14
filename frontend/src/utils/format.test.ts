import { describe, expect, it } from 'vitest'
import {
  currencySymbol,
  formatDate,
  formatDateTime,
  formatIntervalHours,
  formatPercent,
  formatPrice,
  normalizeCheckTimeHHMM,
  normalizeIntervalHoursToMinutes,
  priceChangeSentiment,
} from './format'

describe('priceChangeSentiment', () => {
  it('default: drop is good, rise is bad', () => {
    expect(priceChangeSentiment(-5)).toBe('good')
    expect(priceChangeSentiment(5)).toBe('bad')
  })

  it('inverse: rise is good, drop is bad', () => {
    expect(priceChangeSentiment(5, true)).toBe('good')
    expect(priceChangeSentiment(-5, true)).toBe('bad')
  })

  it('zero and non-finite are neutral either way', () => {
    expect(priceChangeSentiment(0)).toBe('neutral')
    expect(priceChangeSentiment(0, true)).toBe('neutral')
    expect(priceChangeSentiment(NaN)).toBe('neutral')
  })
})

describe('formatPrice', () => {
  it('formats EUR with German locale for DD.MM.YYYY', () => {
    // Intl inserts a non-breaking space before the symbol
    expect(formatPrice('1234.56', 'DD.MM.YYYY')).toBe('1.234,56 €')
  })

  it('formats USD when currency given', () => {
    expect(formatPrice('12.34', 'MM/DD/YYYY', 'USD')).toBe('$12.34')
  })

  it('falls back to plain number for unknown currency codes', () => {
    expect(formatPrice('12.34', 'MM/DD/YYYY', 'NOPE')).toBe('12.34')
  })

  it('returns dash for null', () => {
    expect(formatPrice(null, 'DD.MM.YYYY')).toBe('—')
  })
})

describe('currencySymbol', () => {
  it('resolves common symbols', () => {
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('USD', 'MM/DD/YYYY')).toBe('$')
    expect(currencySymbol('GBP', 'DD/MM/YYYY')).toBe('£')
  })

  it('falls back to the code for unknown currencies', () => {
    expect(currencySymbol('NOPE')).toBe('NOPE')
  })
})

describe('formatPercent', () => {
  it('prefixes positive values with +', () => {
    expect(formatPercent('5.5', 'MM/DD/YYYY')).toBe('+5.50%')
  })

  it('keeps minus for negatives', () => {
    expect(formatPercent('-3.25', 'MM/DD/YYYY')).toBe('-3.25%')
  })
})

describe('formatDate / formatDateTime', () => {
  it('formats all date formats', () => {
    const iso = '2026-07-14T09:05:00'
    expect(formatDate(iso, 'DD.MM.YYYY')).toBe('14.07.2026')
    expect(formatDate(iso, 'DD/MM/YYYY')).toBe('14/07/2026')
    expect(formatDate(iso, 'MM/DD/YYYY')).toBe('07/14/2026')
    expect(formatDate(iso, 'YYYY-MM-DD')).toBe('2026-07-14')
  })

  it('appends the local time', () => {
    expect(formatDateTime('2026-07-14T09:05:00', 'YYYY-MM-DD')).toBe('2026-07-14 09:05')
  })

  it('handles invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDate(null)).toBe('—')
  })
})

describe('interval helpers', () => {
  it('converts hours to clamped minutes', () => {
    expect(normalizeIntervalHoursToMinutes(2)).toBe(120)
    expect(normalizeIntervalHoursToMinutes(0.1)).toBe(30) // clamped to minimum
    expect(normalizeIntervalHoursToMinutes(0)).toBe(0)
    expect(normalizeIntervalHoursToMinutes(NaN)).toBe(0)
  })

  it('formats interval hours', () => {
    expect(formatIntervalHours(0)).toBe('Disabled')
    expect(formatIntervalHours(90)).toBe('1.5')
    expect(formatIntervalHours(120)).toBe('2')
  })
})

describe('normalizeCheckTimeHHMM', () => {
  it('accepts valid times', () => {
    expect(normalizeCheckTimeHHMM('09:30')).toBe('09:30')
    expect(normalizeCheckTimeHHMM('23:59')).toBe('23:59')
  })

  it('falls back to default for invalid or empty', () => {
    expect(normalizeCheckTimeHHMM('25:00')).toBe('10:00')
    expect(normalizeCheckTimeHHMM('9:30')).toBe('10:00')
    expect(normalizeCheckTimeHHMM('')).toBe('10:00')
    expect(normalizeCheckTimeHHMM(null)).toBe('10:00')
  })
})
