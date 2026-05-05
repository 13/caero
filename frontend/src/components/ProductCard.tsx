import { Link } from 'react-router-dom'
import { RefreshCw, X, TrendingDown, TrendingUp, ExternalLink, BellRing } from 'lucide-react'
import toast from 'react-hot-toast'
import { useState } from 'react'
import type { Product } from '../api/types'
import { useCheckProduct, useDeleteProduct, useSettings } from '../api/hooks'
import { formatDate, formatIntervalHours, formatPercent, formatPrice } from '../utils/format'
import { getTagColorClass } from '../utils/tags'
import ConfirmDialog from './ConfirmDialog'

interface ProductCardProps {
  product: Product
  onKeywordClick?: (keyword: string) => void
  hasActiveAlerts?: boolean
}

export default function ProductCard({ product, onKeywordClick, hasActiveAlerts }: ProductCardProps) {
  const deleteMutation = useDeleteProduct()
  const checkMutation = useCheckProduct()
  const { data: settings } = useSettings()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const isTrackingActive = product.active && product.check_interval_minutes > 0
  const checkIntervalHours = formatIntervalHours(product.check_interval_minutes)
  const intervalLabel = product.check_interval_minutes > 0
    ? `Every ${checkIntervalHours}h`
    : checkIntervalHours
  const pct = product.last_price_change_percent !== null ? parseFloat(product.last_price_change_percent) : null
  const displaySrc = (product as any).cached_image_url ?? product.image_url

  const handleDelete = () => {
    setShowDeleteConfirm(true)
  }

  const confirmDelete = () => {
    deleteMutation.mutate(product.id, {
      onSuccess: () => {
        toast.success(`Deleted ${product.name}`)
      },
      onError: (err: any) => {
        toast.error(err?.message ?? 'Delete failed')
      },
    })
    setShowDeleteConfirm(false)
  }

  const cancelDelete = () => setShowDeleteConfirm(false)

  return (
    <div className="group bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all duration-200">

      {/* Image */}
      {displaySrc && (
        <Link to={`/products/${product.id}`} className="block w-full h-36 bg-gray-50 dark:bg-gray-800 flex items-center justify-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 hover:opacity-90 transition-opacity">
          <img
            src={displaySrc}
            alt={product.name}
            className="max-w-full max-h-full w-auto h-auto object-contain"
            loading="lazy"
          />
        </Link>
      )}

      {/* Body */}
      <div className="flex-1 flex flex-col p-4 gap-3">

        {/* Title + status */}
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/products/${product.id}`}
            className="text-base font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 leading-snug line-clamp-2 transition-colors"
          >
            {product.name}
          </Link>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasActiveAlerts && (
              <span title="Alerts active" className="flex items-center justify-center bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-1.5 py-0.5 rounded-full">
                <BellRing className="h-3.5 w-3.5" />
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isTrackingActive
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {isTrackingActive ? 'Active' : 'Paused'}
            </span>
          </div>
        </div>

        {/* Warning banner */}
        {product.consecutive_scrape_failures > 0 && (
          <div className="text-xs px-3 py-2 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50 flex items-center gap-2">
            <span className="font-semibold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900 leading-none">
              {product.consecutive_scrape_failures}
            </span>
            <span>Failed checks (selector may be broken)</span>
          </div>
        )}

        {/* Tags + category */}
        {(product.category || product.tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {product.category && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onKeywordClick?.(product.category!);
                }}
                className={`text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 ${onKeywordClick ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700' : ''}`}
              >
                {product.category}
              </button>
            )}
            {product.tags.map((tag) => (
              <button
                key={tag}
                onClick={(e) => {
                  e.preventDefault();
                  onKeywordClick?.(tag);
                }}
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTagColorClass(tag)} ${onKeywordClick ? 'cursor-pointer hover:opacity-80' : ''}`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* URL */}
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-indigo-500 transition-colors min-w-0"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{product.url}</span>
        </a>

        {/* Price + change — pushed to bottom */}
        <div className="flex items-end justify-between mt-auto pt-3 border-t border-gray-100 dark:border-gray-800">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Latest price</p>
            <p className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 tracking-tight">
              {formatPrice(product.latest_price, settings?.date_format)}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{intervalLabel}</p>
          </div>
          <div className="text-right">
            {pct !== null ? (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                pct < 0
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : pct > 0
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {pct < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {formatPercent(product.last_price_change_percent, settings?.date_format)}
              </span>
            ) : (
              <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
            )}
            {product.last_checked_at && (
              <p
                className="text-xs text-gray-400 dark:text-gray-500 mt-1"
                title={`Price last changed at: ${formatDate(product.last_price_change_at, settings?.date_format) ?? 'Never'}`}
              >
                {formatDate(product.last_checked_at, settings?.date_format)}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => checkMutation.mutate(product.id, {
              onSuccess: (data) => {
                if (data.price !== null) {
                  toast.success('Successfully checked: €' + data.price)
                } else if (data.error) {
                  toast.error(data.error)
                } else {
                  toast.error('No price found (check selector)')
                }
              },
              onError: (err) => toast.error(err.message || 'Check failed')
            })}
            disabled={checkMutation.isPending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 font-medium transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkMutation.isPending ? 'animate-spin' : ''}`} />
            {checkMutation.isPending ? 'Checking…' : 'Check'}
          </button>
          <Link
            to={`/products/${product.id}`}
            className="flex-1 text-sm py-2 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium text-center transition-colors"
          >
            Details
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            aria-label="Delete product"
            className="px-2.5 py-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete "${product.name}"?`}
        message="This will remove the product and its cached image."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  )
}