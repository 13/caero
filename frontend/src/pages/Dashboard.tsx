import { Link } from 'react-router-dom'
import { useProducts } from '../api/hooks'
import ProductCard from '../components/ProductCard'

export default function Dashboard() {
  const { data: products, isLoading, error } = useProducts()

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  )
}
