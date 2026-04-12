import { Link } from 'react-router-dom'
import type { Product } from '../api/types'
import { useCheckProduct, useDeleteProduct } from '../api/hooks'

interface ProductCardProps {
  product: Product
}

export default function ProductCard({ product }: ProductCardProps) {
  const deleteMutation = useDeleteProduct()
  const checkMutation = useCheckProduct()

  const handleDelete = () => {
    if (confirm(`Delete "${product.name}"?`)) {
      deleteMutation.mutate(product.id)
    }
  }

  const handleCheck = () => {
    checkMutation.mutate(product.id)
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Link
            to={`/products/${product.id}`}
            className="text-lg font-semibold text-gray-900 hover:text-indigo-600 truncate block"
          >
            {product.name}
          </Link>
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-indigo-500 truncate block"
          >
            {product.url}
          </a>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
            product.active
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {product.active ? 'Active' : 'Paused'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <p className="text-xs text-gray-400">Latest price</p>
          <p className="text-2xl font-bold text-indigo-600">
            {product.latest_price ? `€ ${parseFloat(product.latest_price).toFixed(2)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Check interval</p>
          <p className="text-sm text-gray-700">{product.check_interval_minutes} min</p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleCheck}
          disabled={checkMutation.isPending}
          className="flex-1 text-sm py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 font-medium"
        >
          {checkMutation.isPending ? 'Checking…' : 'Check now'}
        </button>
        <Link
          to={`/products/${product.id}`}
          className="flex-1 text-sm py-1.5 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 font-medium text-center"
        >
          Details
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="px-3 text-sm py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
