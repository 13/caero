import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProducts, useSettings } from '../api/hooks'
import { formatDate, formatPercent, formatPrice } from '../utils/format'
import ProductCard from '../components/ProductCard'

export default function Dashboard() {
  const { data: products, isLoading, error } = useProducts()
  const { data: settings } = useSettings()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'name' | 'category' | 'last_change_percent' | 'last_change_date'>(
    'name'
  )

  const sortedProducts = useMemo(() => {
    if (!products) return []
    const items = [...products]
    if (sortBy === 'name') items.sort((a, b) => a.name.localeCompare(b.name))
    if (sortBy === 'category')
      items.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''))
    if (sortBy === 'last_change_percent')
      items.sort(
        (a, b) =>
          Math.abs(parseFloat(b.last_price_change_percent ?? '0')) -
          Math.abs(parseFloat(a.last_price_change_percent ?? '0'))
      )
    if (sortBy === 'last_change_date')
      items.sort(
        (a, b) =>
          new Date(b.last_price_change_at ?? 0).getTime() -
          new Date(a.last_price_change_at ?? 0).getTime()
      )
    return items
  }, [products, sortBy])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-16 text-red-500">
        Failed to load products: {error.message}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tracked Products</h1>
          <p className="text-gray-500 text-sm mt-1">
            {products?.length ?? 0} product{products?.length !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <Link
          to="/add"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          + Add product
        </Link>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center gap-3">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="name">Sort by name</option>
          <option value="category">Sort by category</option>
          <option value="last_change_percent">Sort by last price change %</option>
          <option value="last_change_date">Sort by last price change date</option>
        </select>
        <button
          onClick={() => setView('grid')}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            view === 'grid' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Grid
        </button>
        <button
          onClick={() => setView('list')}
          className={`px-3 py-1.5 text-sm rounded-lg ${
            view === 'list' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          List
        </button>
      </div>

      {!products?.length ? (
        <div className="text-center py-24 text-gray-400">
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
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-left px-3 py-2">Price</th>
                    <th className="text-left px-3 py-2">Last change</th>
                    <th className="text-left px-3 py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <Link to={`/products/${p.id}`} className="text-indigo-600 hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{p.category ?? '—'}</td>
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
          )}
        </>
      )}
    </div>
  )
}
