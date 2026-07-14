import { ArrowDown, ArrowUp, BellRing, Image as ImageIcon, Star } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useUiSettings } from '../../api/hooks'
import type { Product, SparklinePoint } from '../../api/types'
import { formatDateTime, formatPercent, formatPrice } from '../../utils/format'
import { getTagColorClass } from '../../utils/tags'
import Sparkline from '../Sparkline'
import type { SortBy } from './sort'

export default function ProductTable({
  products,
  sortBy, sortDirection, onSort,
  starredIds, onToggleStar,
  onToggleActive,
  hasActiveAlerts,
  onSearchTerm,
  sparklines,
}: {
  products: Product[]
  sortBy: SortBy
  sortDirection: 'asc' | 'desc'
  onSort: (key: SortBy) => void
  starredIds: number[]
  onToggleStar: (productId: number) => void
  onToggleActive: (productId: number, productName: string, currentActive: boolean) => void
  hasActiveAlerts: (productId: number) => boolean
  onSearchTerm: (value: string) => void
  sparklines?: Record<number, SparklinePoint[]>
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: settings } = useUiSettings()

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

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              {(
                [
                  { key: 'name', label: 'Name' },
                  { key: 'category', label: 'Category' },
                  { key: 'tags', label: 'Tags' },
                  { key: 'latest_price', label: 'Price' },
                  ...(sparklines ? [{ key: 'trend' as const, label: 'Trend' }] : []),
                  { key: 'last_change_percent', label: 'Change' },
                  { key: 'last_change_date', label: 'Date' },
                ] as { key: SortBy | 'tags' | 'trend'; label: string }[]
              ).map(({ key, label }) => (
                <th
                  key={key}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider"
                  aria-sort={key !== 'tags' && key !== 'trend' ? ariaSortFor(key as SortBy) : undefined}
                >
                  {key !== 'tags' && key !== 'trend' ? (
                    <button
                      onClick={() => onSort(key as SortBy)}
                      className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                      {label} {sortIndicator(key as SortBy)}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {products.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate(`/products/${p.id}${location.search}`)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleStar(p.id) }}
                      aria-label={starredIds.includes(p.id) ? 'Unstar product' : 'Star product'}
                      title={starredIds.includes(p.id) ? 'Remove from favourites' : 'Add to favourites'}
                      className={`shrink-0 p-0.5 rounded transition-colors ${starredIds.includes(p.id) ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400 dark:hover:text-yellow-400'}`}
                    >
                      <Star className={`h-4 w-4 ${starredIds.includes(p.id) ? 'fill-yellow-400' : ''}`} />
                    </button>
                    {(p.cached_image_url ?? p.image_url) ? (
                      <img src={(p.cached_image_url ?? p.image_url) || undefined} alt="" className="w-10 h-10 object-cover rounded-md border border-gray-200 dark:border-gray-700" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-700">
                        <ImageIcon className="h-5 w-5 text-gray-400" />
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <Link
                        to={`/products/${p.id}${location.search}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline line-clamp-1"
                      >
                        {p.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer transition-opacity hover:opacity-80 ${
                          p.active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleActive(p.id, p.name, p.active)
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              onToggleActive(p.id, p.name, p.active)
                            }
                          }}
                        >
                          {p.active ? 'Active' : 'Paused'}
                        </span>
                        {hasActiveAlerts(p.id) && (
                          <span title="Alerts active" className="flex items-center justify-center bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-1 py-0.5 rounded-full">
                            <BellRing className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {p.category ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSearchTerm(p.category!) }}
                      className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                      {p.category}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.tags.slice(0, 3).map(tag => (
                      <button
                        key={tag}
                        onClick={(e) => { e.stopPropagation(); onSearchTerm(tag) }}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getTagColorClass(tag)} cursor-pointer hover:opacity-80`}
                      >
                        {tag}
                      </button>
                    ))}
                    {p.tags.length > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                        +{p.tags.length - 3}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-200">{formatPrice(p.latest_price, settings?.date_format, p.currency)}</td>
                {sparklines && (
                  <td className="px-4 py-3 w-28">
                    {(sparklines[p.id]?.length ?? 0) >= 2 ? (
                      <div className="w-24">
                        <Sparkline points={sparklines[p.id]} />
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  {p.last_price_change_percent ? (
                    <span className={`text-xs font-semibold ${
                      parseFloat(p.last_price_change_percent) < 0
                        ? 'text-green-600 dark:text-green-400'
                        : parseFloat(p.last_price_change_percent) > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500'
                    }`}>
                      {formatPercent(p.last_price_change_percent, settings?.date_format)}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {formatDateTime(p.last_checked_at, settings?.date_format)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
