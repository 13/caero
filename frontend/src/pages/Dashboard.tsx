import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProducts, useSettings } from '../api/hooks'
import { formatDate, formatPercent, formatPrice } from '../utils/format'
import ProductCard from '../components/ProductCard'

type SortBy = 'name' | 'category' | 'latest_price' | 'last_change_percent' | 'last_change_date'

export default function Dashboard() {
  const { data: products, isLoading, error } = useProducts()
  const { data: settings } = useSettings()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredProducts = useMemo(() => {
    if (!products) return []
    const query = searchTerm.trim().toLowerCase()
    if (!query) return products
    return products.filter((p) => {
      const haystack = [p.name, p.category ?? '', p.url, ...p.tags].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [products, searchTerm])

  const handleSort = (nextSortBy: SortBy) => {
    if (sortBy === nextSortBy) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(nextSortBy)
    setSortDirection('asc')
  }

  const sortIndicator = (key: SortBy) => {
    if (sortBy !== key) return ''
    return sortDirection === 'asc' ? '↑' : '↓'
  }

  const ariaSortFor = (key: SortBy): 'none' | 'ascending' | 'descending' => {
    if (sortBy !== key) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  const sortedProducts = useMemo(() => {
    const items = [...filteredProducts]
    const direction = sortDirection === 'asc' ? 1 : -1

    const compareNullableNumbers = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return a - b
    }

    if (sortBy === 'name') {
      items.sort((a, b) => a.name.localeCompare(b.name) * direction)
    }

    if (sortBy === 'category') {
      items.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') * direction)
    }

    if (sortBy === 'latest_price') {
      items.sort((a, b) => {
        const aPrice = a.latest_price ? parseFloat(a.latest_price) : null
        const bPrice = b.latest_price ? parseFloat(b.latest_price) : null
        return compareNullableNumbers(aPrice, bPrice) * direction
      })
    }

    if (sortBy === 'last_change_percent') {
      items.sort((a, b) => {
        const aChange = a.last_price_change_percent ? Math.abs(parseFloat(a.last_price_change_percent)) : null
        const bChange = b.last_price_change_percent ? Math.abs(parseFloat(b.last_price_change_percent)) : null
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

    return items
  }, [filteredProducts, sortBy, sortDirection])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  if (error) {
      return (
      <div className="text-center py-16 text-red-500 dark:text-red-400">
        Failed to load products: {error.message}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tracked Products</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {products?.length ?? 0} product{products?.length !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <Link
          to="/add"
          className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add
        </Link>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 mb-4 flex flex-wrap items-center gap-3">
        <select
          value={sortBy}
          onChange={(e) => handleSort(e.target.value as SortBy)}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
        >
          <option value="name">Sort by name</option>
          <option value="category">Sort by category</option>
          <option value="latest_price">Sort by price</option>
          <option value="last_change_percent">Sort by last price change %</option>
          <option value="last_change_date">Sort by last price change date</option>
        </select>
        <button
          onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        </button>
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search products..."
          aria-label="Search products by name, category, URL, or tags"
          className="flex-1 min-w-[180px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => setView('grid')}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            view === 'grid'
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          Grid
        </button>
        <button
          onClick={() => setView('list')}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            view === 'list'
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          List
        </button>
      </div>

      {!products?.length ? (
        <div className="text-center py-24 text-gray-400 dark:text-gray-500">
          <p className="text-4xl mb-4">🛍️</p>
          <p className="text-lg font-medium">No products tracked yet</p>
          <p className="text-sm mt-2">
            <Link to="/add" className="text-indigo-500 hover:underline">
              Add your first product
            </Link>{' '}
            to start tracking prices.
          </p>
        </div>
      ) : (
        <>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="text-left px-3 py-2" aria-sort={ariaSortFor('name')}>
                      <button
                        onClick={() => handleSort('name')}
                        aria-label="Sort by name"
                        className="inline-flex items-center gap-1 hover:text-indigo-600"
                      >
                        Name <span>{sortIndicator('name')}</span>
                      </button>
                    </th>
                    <th className="text-left px-3 py-2" aria-sort={ariaSortFor('category')}>
                      <button
                        onClick={() => handleSort('category')}
                        aria-label="Sort by category"
                        className="inline-flex items-center gap-1 hover:text-indigo-600"
                      >
                        Category <span>{sortIndicator('category')}</span>
                      </button>
                    </th>
                    <th className="text-left px-3 py-2" aria-sort={ariaSortFor('latest_price')}>
                      <button
                        onClick={() => handleSort('latest_price')}
                        aria-label="Sort by price"
                        className="inline-flex items-center gap-1 hover:text-indigo-600"
                      >
                        Price <span>{sortIndicator('latest_price')}</span>
                      </button>
                    </th>
                    <th className="text-left px-3 py-2" aria-sort={ariaSortFor('last_change_percent')}>
                      <button
                        onClick={() => handleSort('last_change_percent')}
                        aria-label="Sort by last change"
                        className="inline-flex items-center gap-1 hover:text-indigo-600"
                      >
                        Last change <span>{sortIndicator('last_change_percent')}</span>
                      </button>
                    </th>
                    <th className="text-left px-3 py-2" aria-sort={ariaSortFor('last_change_date')}>
                      <button
                        onClick={() => handleSort('last_change_date')}
                        aria-label="Sort by date"
                        className="inline-flex items-center gap-1 hover:text-indigo-600"
                      >
                        Date <span>{sortIndicator('last_change_date')}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                  <tbody>
                  {sortedProducts.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-2">
                        <Link to={`/products/${p.id}`} className="text-indigo-600 hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{p.category ?? '—'}</td>
                      <td className="px-3 py-2">{formatPrice(p.latest_price)}</td>
                      <td className="px-3 py-2">{formatPercent(p.last_price_change_percent)}</td>
                      <td className="px-3 py-2">
                        {formatDate(p.last_price_change_at, settings?.date_format)}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
