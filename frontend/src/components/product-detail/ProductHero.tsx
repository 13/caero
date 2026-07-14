import { useState } from 'react'
import { ExternalLink, TrendingDown, TrendingUp, X, ZoomIn } from 'lucide-react'
import { useUiSettings } from '../../api/hooks'
import type { Product } from '../../api/types'
import { formatDateTime, formatPercent, formatPrice, priceChangeSentiment } from '../../utils/format'
import { getTagColorClass } from '../../utils/tags'

export default function ProductHero({ product, onToggleActive, togglePending }: {
  product: Product
  onToggleActive: () => void
  togglePending: boolean
}) {
  const { data: settings } = useUiSettings()
  const [imageZoomed, setImageZoomed] = useState(false)

  const productUrlChars = Array.from(product.url)
  const productUrlPreview =
    productUrlChars.length > 50 ? `${productUrlChars.slice(0, 50).join('')}…` : product.url

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
      <div className="flex gap-6 items-start">
        {(product.cached_image_url ?? product.image_url) && (
          <>
            {/* Lightbox */}
            {imageZoomed && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
                onClick={() => setImageZoomed(false)}
              >
                <button
                  onClick={() => setImageZoomed(false)}
                  className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                  aria-label="Close zoom"
                >
                  <X className="h-5 w-5" />
                </button>
                <img
                  src={product.cached_image_url ?? product.image_url!}
                  alt={product.name}
                  className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
                />
              </div>
            )}
            <div className="shrink-0 relative group cursor-zoom-in" onClick={() => setImageZoomed(true)}>
              <img
                src={product.cached_image_url ?? product.image_url!}
                alt={product.name}
                className="w-28 h-28 object-contain rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 transition-opacity group-hover:opacity-80"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="h-6 w-6 text-gray-700 dark:text-gray-200 drop-shadow" />
              </div>
            </div>
          </>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {product.name}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-opacity hover:opacity-80 ${
              product.active
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
            onClick={onToggleActive}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggleActive()
              }
            }}
            title={`Click to ${product.active ? 'pause' : 'activate'} tracking`}
            >
              {togglePending ? '…' : (product.active ? 'Active' : 'Paused')}
            </span>
          </div>

          {/* Warning banners */}
          {product.url_redirected && (
            <div className="mt-3 text-sm px-3 py-2 rounded-lg bg-yellow-50 text-yellow-800 border border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800/50 flex items-center gap-2 max-w-max">
              <span className="font-semibold">URL redirected</span>
              <span>— This URL points to a different product. Please update it.</span>
            </div>
          )}
          {product.consecutive_scrape_failures > 0 && (
            <div className="mt-3 text-sm px-3 py-2 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50 flex items-center gap-2 max-w-max">
              <span className="font-semibold px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900 leading-none">
                {product.consecutive_scrape_failures}
              </span>
              <span>Consecutive failed checks. The CSS selector may be broken or the website layout changed.</span>
            </div>
          )}

          {/* Price row */}
          <div className="mt-3 flex items-baseline gap-3 flex-wrap">
            <span className="text-4xl font-extrabold text-indigo-600 dark:text-indigo-400 tracking-tight">
              {formatPrice(product.latest_price, settings?.date_format, product.currency)}
            </span>
            {product.last_price_change_percent !== null && (() => {
              const pct = parseFloat(product.last_price_change_percent ?? '0')
              const sentiment = priceChangeSentiment(pct, product.inverse_price)
              return (
                <span
                  className={`inline-flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full ${
                    sentiment === 'good'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : sentiment === 'bad'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {pct < 0 ? (
                    <TrendingDown className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingUp className="h-3.5 w-3.5" />
                  )}
                  {formatPercent(product.last_price_change_percent, settings?.date_format)}
                </span>
              )
            })()}
          </div>

          {product.last_checked_at && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Last checked: {formatDateTime(product.last_checked_at, settings?.date_format)}
            </p>
          )}

          {/* Meta row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {product.category && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                {product.category}
              </span>
            )}
            {product.tags.map((tag) => (
              <span
                key={tag}
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTagColorClass(tag)}`}
              >
                {tag}
              </span>
            ))}
            {product.next_run_at && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
                Next run: {formatDateTime(product.next_run_at, settings?.date_format)}
              </span>
            )}
          </div>

          {product.memo && (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
              {product.memo}
            </p>
          )}

          {/* URL chip */}
          <div className="mt-3 min-w-0 max-w-full">
            <a
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              title={product.url}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors max-w-full overflow-hidden"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{productUrlPreview}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
