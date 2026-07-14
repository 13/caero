import { useUiSettings } from '../../api/hooks'
import type { ProductStatistics } from '../../api/types'
import { formatDate, formatPercent, formatPrice } from '../../utils/format'

export default function StatsStrip({ stats, currency, inversePrice = false }: {
  stats?: ProductStatistics
  currency?: string
  inversePrice?: boolean
}) {
  const { data: settings } = useUiSettings()

  // Low prices are the good news by default; inverse products flip that.
  const goodAccent = 'text-green-600 dark:text-green-400'
  const badAccent = 'text-red-500 dark:text-red-400'

  const cells = [
    { label: 'Average', value: formatPrice(stats?.average_price ?? null, settings?.date_format, currency) },
    {
      label: 'All-time low',
      value: formatPrice(stats?.lowest_price ?? null, settings?.date_format, currency),
      sub: formatDate(stats?.lowest_price_at ?? null, settings?.date_format),
      accent: inversePrice ? badAccent : goodAccent,
    },
    {
      label: 'All-time high',
      value: formatPrice(stats?.highest_price ?? null, settings?.date_format, currency),
      sub: formatDate(stats?.highest_price_at ?? null, settings?.date_format),
      accent: inversePrice ? goodAccent : badAccent,
    },
    {
      label: 'Total change',
      value: formatPercent(stats?.total_change_percent ?? null, settings?.date_format),
    },
    { label: 'Data points', value: String(stats?.data_points ?? 0) },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cells.map(({ label, value, sub, accent }) => (
        <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
          <p className={`text-base font-bold ${accent ?? 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </div>
      ))}
    </div>
  )
}
