import { useState } from 'react'
import { ArrowRightLeft, ExternalLink, Pencil, RefreshCw, TrendingDown, TrendingUp, TriangleAlert, X, ZoomIn } from 'lucide-react'
import { useScraperHealth, useUiSettings } from '../../api/hooks'
import type { Product } from '../../api/types'
import { formatDateTime, formatPercent, formatPrice, priceChangeSentiment } from '../../utils/format'
import { describeFailure, failureSeverity, formatTimeAgo } from '../../utils/scrapeFailure'
import { getTagColorClass } from '../../utils/tags'
import WarningBanner from '../WarningBanner'
import type { EditFocusField } from './ProductEditPanel'

export default function ProductHero({ product, onToggleActive, togglePending, onEdit, onCheckNow, checkPending }: {
  product: Product
  onToggleActive: () => void
  togglePending: boolean
  onEdit: (field: EditFocusField) => void
  onCheckNow: () => void
  checkPending: boolean
}) {
  const { data: settings } = useUiSettings()
  const [imageZoomed, setImageZoomed] = useState(false)
  const failures = product.consecutive_scrape_failures
  const severity = failureSeverity(failures, settings?.scrape_failure_threshold)
  const { data: health } = useScraperHealth(severity === 'broken')
  const failure = describeFailure(product.last_scrape_error, health?.scraping_degraded)

  const productUrlChars = Array.from(product.url)
  const productUrlPreview =
    productUrlChars.length > 50 ? `${productUrlChars.slice(0, 50).join('')}…` : product.url

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
      {/* Phones stack the image above the details so the title gets full width. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6 sm:items-start">
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
            <div className="shrink-0 relative group cursor-zoom-in w-full sm:w-auto" onClick={() => setImageZoomed(true)}>
              <img
                src={product.cached_image_url ?? product.image_url!}
                alt={product.name}
                className="w-full h-32 sm:w-28 sm:h-28 object-contain p-2 sm:p-0 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 transition-opacity group-hover:opacity-80"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="h-6 w-6 text-gray-700 dark:text-gray-200 drop-shadow" />
              </div>
            </div>
          </>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight break-words min-w-0">
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
            <WarningBanner
              tone="warning"
              icon={ArrowRightLeft}
              title="URL redirected"
              description="This link now points to a different product."
              actions={[{ label: 'Edit URL', icon: Pencil, onClick: () => onEdit('url') }]}
            />
          )}
          {severity !== 'none' && (
            <WarningBanner
              tone={severity === 'broken' ? 'error' : 'muted'}
              icon={TriangleAlert}
              title={failures === 1 ? 'Last price check failed' : `Last ${failures} price checks failed`}
              description={failure.detail}
              meta={severity === 'broken'
                ? product.scrape_failing_since && `Failing since ${formatTimeAgo(product.scrape_failing_since)}`
                : 'Caero retries on the next scheduled check.'}
              actions={[
                ...(failure.selectorFix ? [{ label: 'Edit selector', icon: Pencil, onClick: () => onEdit('selector') }] : []),
                { label: checkPending ? 'Checking…' : 'Check now', icon: RefreshCw, onClick: onCheckNow, disabled: checkPending, busy: checkPending },
              ]}
            />
          )}

          {/* Price row */}
          <div className="mt-3 flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl sm:text-4xl font-extrabold text-indigo-600 dark:text-indigo-400 tracking-tight">
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
