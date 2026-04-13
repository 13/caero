import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Grid2x2, List, Plus, X, Search, Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useProducts, useSettings } from '../api/hooks'
import { formatDate, formatPercent, formatPrice } from '../utils/format'
import ProductCard from '../components/ProductCard'

type SortBy = 'name' | 'category' | 'latest_price' | 'last_change_percent' | 'last_change_date'

const compareNullableNumbers = (a: number | null, b: number | null) => {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

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
      const haystack = [p.name, p.category ?? '', p.memo ?? '', p.url, ...p.tags].join(' ').toLowerCase()
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

  const ariaSortFor = (key: SortBy): 'none' | 'ascending' | 'descending' => {
    if (sortBy !== key) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  const sortIndicator = (key: SortBy) => {
    if (sortBy !== key) return null
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 inline ml-0.5" />
      : <ArrowDown className="h-3 w-3 inline ml-0.5" />
  }

  const sortedProducts = useMemo(() => {
    const items = [...filteredProducts]
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

  // Summary stats
  const activeCount = products?.filter((p) => p.active).length ?? 0
  const droppedCount = products?.filter((p) => {
    const pct = p.last_price_change_percent ? parseFloat(p.last_price_change_percent) : null
    return pct !== null && pct < 0
  }).length ?? 0

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
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tracked Products</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {products?.length ?? 0} product{products?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          to="/add"
          className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add product
        </Link>
      </div>

      {/* ── Summary strip ── */}
      {(products?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
            <p className="text-xs text-gray-400 dark:text-gray-500">Total tracked</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{products?.length ?? 0}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
            <p className="text-xs text-gray-400 dark:text-gray-500">Active</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{activeCount}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
            <p className="text-xs text-gray-400 dark:text-gray-500">Price drops</p>
            <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{droppedCount}</p>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search…"
            aria-label="Search products"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sort select */}
        <select
          value={sortBy}
          onChange={(e) => handleSort(e.target.value as SortBy)}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="name">Name</option>
          <option value="category">Category</option>
          <option value="latest_price">Price</option>
          <option value="last_change_percent">Change %</option>
          <option value="last_change_date">Change date</option>
        </select>

        {/* Sort direction */}
        <button
          onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          aria-label={sortDirection === 'asc' ? 'Switch to descending' : 'Switch to ascending'}
          className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => setView('grid')}
            aria-label="Grid view"
            className={`px-2.5 py-1.5 transition-colors ${
              view === 'grid'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Grid2x2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView('list')}
            aria-label="List view"
            className={`px-2.5 py-1.5 transition-colors ${
              view === 'list'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Search result hint ── */}
      {searchTerm && (
        <p className="text-sm text-gray-500 dark:text-gray-400 px-1">
          {sortedProducts.length === 0
            ? 'No products match your search.'
            : `${sortedProducts.length} result${sortedProducts.length !== 1 ? 's' : ''} for "${searchTerm}"`}
        </p>
      )}

      {/* ── Empty state ── */}
      {!products?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
            <Package className="h-8 w-8 text-indigo-400" />
          </div>
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">No products yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 mb-5">Start tracking prices by adding your first product.</p>
          <Link
            to="/add"
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add your first product
          </Link>
        </div>
      ) : (
        <>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedProducts.map((p) => (
                <ProductCard key={p.id} product={p} onKeywordClick={setSearchTerm} />
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      {(
                        [
                          { key: 'name', label: 'Name' },
                          { key: 'category', label: 'Category' },
                          { key: 'latest_price', label: 'Price' },
                          { key: 'last_change_percent', label: 'Change' },
                          { key: 'last_change_date', label: 'Date' },
                        ] as { key: SortBy; label: string }[]
                      ).map(({ key, label }) => (
                        <th
                          key={key}
                          className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                          aria-sort={ariaSortFor(key)}
                        >
                          <button
                            onClick={() => handleSort(key)}
                            className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                          >
                            {label} {sortIndicator(key)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {sortedProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/products/${p.id}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                          {p.category ? (
                            <button
                              onClick={() => setSearchTerm(p.category!)}
                              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            >
                              {p.category}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-200">{formatPrice(p.latest_price)}</td>
                        <td className="px-4 py-3">
                          {p.last_price_change_percent ? (
                            <span className={`text-xs font-semibold ${
                              parseFloat(p.last_price_change_percent) < 0
                                ? 'text-green-600 dark:text-green-400'
                                : parseFloat(p.last_price_change_percent) > 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-500'
                            }`}>
                              {formatPercent(p.last_price_change_percent)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
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
