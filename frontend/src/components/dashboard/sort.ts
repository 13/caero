import type { Product } from '../../api/types'

export type SortBy = 'name' | 'category' | 'latest_price' | 'last_change_percent' | 'last_change_date'

export const compareNullableNumbers = (a: number | null, b: number | null) => {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

export function sortProducts(
  products: Product[],
  sortBy: SortBy,
  sortDirection: 'asc' | 'desc',
  starredIds: number[],
): Product[] {
  const items = [...products]
  const direction = sortDirection === 'asc' ? 1 : -1
  if (sortBy === 'name') items.sort((a, b) => a.name.localeCompare(b.name) * direction)
  if (sortBy === 'category') items.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') * direction)
  if (sortBy === 'latest_price') {
    items.sort((a, b) => {
      const aPrice = a.latest_price ? parseFloat(a.latest_price) : null
      const bPrice = b.latest_price ? parseFloat(b.latest_price) : null
      return compareNullableNumbers(aPrice, bPrice) * direction
    })
  }
  if (sortBy === 'last_change_percent') {
    items.sort((a, b) => {
      const aChange = a.last_price_change_percent ? parseFloat(a.last_price_change_percent) : null
      const bChange = b.last_price_change_percent ? parseFloat(b.last_price_change_percent) : null
      return compareNullableNumbers(aChange, bChange) * direction
    })
  }
  if (sortBy === 'last_change_date') {
    items.sort((a, b) => {
      const aDate = a.last_price_change_at ? new Date(a.last_price_change_at).getTime() : null
      const bDate = b.last_price_change_at ? new Date(b.last_price_change_at).getTime() : null
      return compareNullableNumbers(aDate, bDate) * direction
    })
  }
  // Starred items always appear first
  items.sort((a, b) => {
    const aStarred = starredIds.includes(a.id) ? 0 : 1
    const bStarred = starredIds.includes(b.id) ? 0 : 1
    return aStarred - bStarred
  })
  return items
}

export function filterProducts(
  products: Product[],
  status: 'all' | 'active' | 'paused',
  searchTerm: string,
): Product[] {
  let items = products
  if (status === 'active') items = items.filter((p) => p.active)
  else if (status === 'paused') items = items.filter((p) => !p.active)

  const query = searchTerm.trim().toLowerCase()
  if (!query) return items
  return items.filter((p) => {
    const haystack = [p.name, p.category ?? '', p.memo ?? '', p.url, ...p.tags].join(' ').toLowerCase()
    return haystack.includes(query)
  })
}
