import { Link } from 'react-router-dom'
import type { Product } from '../api/types'
import { useCheckProduct, useDeleteProduct, useSettings } from '../api/hooks'
import { formatDate, formatIntervalHours, formatPercent, formatPrice } from '../utils/format'
import { getTagColorClass } from '../utils/tags'

interface ProductCardProps {
  product: Product
}

export default function ProductCard({ product }: ProductCardProps) {
  const deleteMutation = useDeleteProduct()
  const checkMutation = useCheckProduct()
  const { data: settings } = useSettings()
  const checkIntervalHours = formatIntervalHours(product.check_interval_minutes)

  const handleDelete = () => {
    if (confirm(`Delete "${product.name}"?`)) {
      deleteMutation.mutate(product.id)
    }
  }

  const handleCheck = () => {
    checkMutation.mutate(product.id)
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-3">
      <div className="flex-1 min-w-0">
        {product.image_url && (
          <div className="w-full min-h-[150px] max-h-[150px] flex items-center justify-center rounded-lg mb-2 border border-gray-200 dark:border-gray-800">
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain mx-auto"
              loading="lazy"
            />
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/products/${product.id}`}
            className="text-lg font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600 truncate block"
          >
            {product.name}
          </Link>
          <span
            className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                product.active
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {product.active ? 'Active' : 'Paused'}
          </span>
        </div>
        {product.category && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Category: {product.category}</p>
        )}
        {product.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.tags.map((tag) => (
              <span
                key={tag}
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTagColorClass(tag)}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-indigo-500 truncate block"
        >
          {product.url}
        </a>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Latest price</p>
          <p className="text-2xl font-bold text-indigo-600">{formatPrice(product.latest_price)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Check interval</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{checkIntervalHours} h</p>
        </div>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Last change: {formatPercent(product.last_price_change_percent)} on{' '}
        {formatDate(product.last_price_change_at, settings?.date_format)}
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
          className="flex-1 text-sm py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium text-center"
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
