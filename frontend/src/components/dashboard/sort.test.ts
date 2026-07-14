import { describe, expect, it } from 'vitest'
import type { Product } from '../../api/types'
import { filterProducts, sortProducts } from './sort'

const product = (overrides: Partial<Product>): Product => ({
  id: 1,
  user_id: 1,
  name: 'Product',
  category: null,
  memo: null,
  tags: [],
  image_url: null,
  url: 'https://example.com',
  selector: '.price',
  check_interval_minutes: 60,
  record_all_prices: false,
  price_format: 'auto',
  inverse_price: false,
  consecutive_scrape_failures: 0,
  url_redirected: false,
  active: true,
  currency: 'EUR',
  latest_price: null,
  previous_price: null,
  last_price_change_percent: null,
  last_price_change_at: null,
  next_run_at: null,
  last_checked_at: null,
  lowest_price: null,
  lowest_price_at: null,
  highest_price: null,
  highest_price_at: null,
  created_at: '2026-01-01T00:00:00',
  ...overrides,
})

describe('filterProducts', () => {
  const items = [
    product({ id: 1, name: 'Alpha', active: true, tags: ['audio'] }),
    product({ id: 2, name: 'Beta', active: false, category: 'Tools' }),
  ]

  it('filters by status', () => {
    expect(filterProducts(items, 'active', '').map(p => p.id)).toEqual([1])
    expect(filterProducts(items, 'paused', '').map(p => p.id)).toEqual([2])
    expect(filterProducts(items, 'all', '').map(p => p.id)).toEqual([1, 2])
  })

  it('searches across name, category, and tags', () => {
    expect(filterProducts(items, 'all', 'audio').map(p => p.id)).toEqual([1])
    expect(filterProducts(items, 'all', 'tools').map(p => p.id)).toEqual([2])
    expect(filterProducts(items, 'all', 'nomatch')).toEqual([])
  })
})

describe('sortProducts', () => {
  const items = [
    product({ id: 1, name: 'Beta', latest_price: '20.00' }),
    product({ id: 2, name: 'Alpha', latest_price: '10.00' }),
    product({ id: 3, name: 'Gamma', latest_price: null }),
  ]

  it('sorts by name', () => {
    expect(sortProducts(items, 'name', 'asc', []).map(p => p.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(sortProducts(items, 'name', 'desc', []).map(p => p.name)).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('sorts by price with nulls last', () => {
    expect(sortProducts(items, 'latest_price', 'asc', []).map(p => p.id)).toEqual([2, 1, 3])
  })

  it('pins starred products first regardless of sort', () => {
    expect(sortProducts(items, 'name', 'asc', [3]).map(p => p.id)).toEqual([3, 2, 1])
  })

  it('does not mutate the input array', () => {
    const before = items.map(p => p.id)
    sortProducts(items, 'name', 'desc', [])
    expect(items.map(p => p.id)).toEqual(before)
  })
})
