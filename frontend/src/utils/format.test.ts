import { describe, expect, it } from 'vitest'
import {
  currencySymbol,
  describeSchedule,
  formatDate,
  formatDateTime,
  formatDuration,
  formatHHMM,
  formatIntervalHours,
  formatPercent,
  formatPrice,
  formatRelativeTime,
  formatRunTime,
  normalizeCheckTimeHHMM,
  normalizeIntervalHoursToMinutes,
  pluralize,
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

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const at = (offsetSeconds: number) => new Date(now + offsetSeconds * 1000).toISOString()

  it('handles near times', () => {
    expect(formatRelativeTime(at(-10), now)).toBe('just now')
    expect(formatRelativeTime(at(10), now)).toBe('in a moment')
  })
  it('uses minutes, hours and days', () => {
    expect(formatRelativeTime(at(-5 * 60), now)).toBe('5 min ago')
    expect(formatRelativeTime(at(3 * 3600), now)).toBe('in 3 h')
    expect(formatRelativeTime(at(-2 * 86400), now)).toBe('2 d ago')
  })
  it('returns a dash for missing or invalid values', () => {
    expect(formatRelativeTime(null, now)).toBe('—')
    expect(formatRelativeTime('nope', now)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formats ms, seconds and minutes', () => {
    expect(formatDuration(850)).toBe('850 ms')
    expect(formatDuration(12345)).toBe('12.3 s')
    expect(formatDuration(125000)).toBe('2 min 5 s')
    expect(formatDuration(119600)).toBe('2 min 0 s')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('pluralize', () => {
  it('picks singular only for exactly one', () => {
    expect(pluralize(1, 'check')).toBe('check')
    expect(pluralize(0, 'check')).toBe('checks')
    expect(pluralize(3, 'check')).toBe('checks')
    expect(pluralize(2, 'entry', 'entries')).toBe('entries')
  })
})

describe('formatRunTime', () => {
  const now = new Date('2026-07-14T06:00:00').getTime()

  it('shows only the clock time for today', () => {
    expect(formatRunTime('2026-07-14T08:07:42', 'DD.MM.YYYY', '24h', now)).toBe('08:07')
    expect(formatRunTime('2026-07-14T20:07:00', 'DD.MM.YYYY', '12h', now)).toBe('8:07 PM')
    expect(formatRunTime('2026-07-14T00:05:00', 'DD.MM.YYYY', '12h', now)).toBe('12:05 AM')
  })

  it('prefixes day and month on other days', () => {
    expect(formatRunTime('2026-07-15T08:07:00', 'DD.MM.YYYY', '24h', now)).toBe('15.07. 08:07')
    expect(formatRunTime('2026-07-15T08:07:00', 'MM/DD/YYYY', '12h', now)).toBe('07/15 8:07 AM')
    expect(formatRunTime('2026-07-13T23:59:00', 'YYYY-MM-DD', '24h', now)).toBe('07-13 23:59')
  })

  it('handles missing and invalid values', () => {
    expect(formatRunTime(null, 'DD.MM.YYYY', '24h', now)).toBe('—')
    expect(formatRunTime('nope', 'DD.MM.YYYY', '24h', now)).toBe('—')
  })
})

describe('describeSchedule', () => {
  it('matches the backend wording in 24h', () => {
    expect(describeSchedule(60, '08:00')).toBe('Every 1 h from 08:00')
    expect(describeSchedule(30, '10:00')).toBe('Every 30 min from 10:00')
    expect(describeSchedule(1440, '09:30')).toBe('Daily at 09:30')
    expect(describeSchedule(2880, '09:30')).toBe('Every 2 d at 09:30')
    expect(describeSchedule(90, '07:00')).toBe('Every 90 min from 07:00')
  })

  it('honours the 12h preference', () => {
    expect(describeSchedule(1440, '03:30', '12h')).toBe('Daily at 3:30 AM')
    expect(describeSchedule(60, '00:00', '12h')).toBe('Every 1 h from 12:00 AM')
    expect(formatHHMM('19:05', '12h')).toBe('7:05 PM')
    expect(formatHHMM('bogus', '12h')).toBe('bogus')
  })
})
