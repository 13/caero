import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMemo } from 'react'
import { useUiSettings } from '../api/hooks'
import type { PriceHistory } from '../api/types'
import { localeFromDateFormat, formatDate, formatDateTime } from '../utils/format'
import { priceAxisDomain, shortDate } from './priceChartAxis'

export interface PricePoint {
  id: number
  date: number
  price: number
}

interface ChartPoint extends PricePoint {
  /** % change vs the previous stored price, null for the first point. */
  change: number | null
  /** Synthetic end point: the last price carried forward to the last check. */
  carried?: boolean
}

interface PriceChartProps {
  data: PriceHistory[]
  currency?: string
  /** Carry the last price forward to this time (the product's last check). */
  extendTo?: string | null
  onPointClick?: (point: PricePoint) => void
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000
const MIN_EXTEND_MS = 60 * 1000

export default function PriceChart({ data, currency = 'EUR', extendTo, onPointClick }: PriceChartProps) {
  const { data: settings } = useUiSettings()
  const locale = localeFromDateFormat(settings?.date_format)
  const currencyCode = useMemo(
    () => data.find((item) => item.currency)?.currency || currency,
    [currency, data]
  )

  const formatCurrency = (value: number, fractionDigits = 2) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value)
    } catch {
      return `${currencyCode} ${value.toFixed(fractionDigits)}`
    }
  }

  const chartData = useMemo<ChartPoint[]>(() => {
    const points: ChartPoint[] = data.map((dataPoint, i) => {
      const price = parseFloat(dataPoint.price)
      const prev = i > 0 ? parseFloat(data[i - 1].price) : null
      return {
        id: dataPoint.id,
        date: new Date(dataPoint.scraped_at).getTime(),
        price,
        change: prev ? ((price - prev) / prev) * 100 : null,
      }
    })
    // Prices are stored on change only, so the last one is still in effect
    // at the last check — draw it there instead of ending the line early.
    const last = points[points.length - 1]
    const end = extendTo ? new Date(extendTo).getTime() : NaN
    if (last && Number.isFinite(end) && end - last.date > MIN_EXTEND_MS) {
      points.push({ id: -1, date: end, price: last.price, change: null, carried: true })
    }
    return points
  }, [data, extendTo])

  const yDomain = useMemo(() => priceAxisDomain(chartData.map((p) => p.price)), [chartData])
  // Cheap items need cents on the axis; anything bigger reads better without.
  const axisDigits = yDomain[1] - yDomain[0] < 10 ? 2 : 0
  const spansYear =
    chartData.length > 1 && chartData[chartData.length - 1].date - chartData[0].date >= YEAR_MS

  const formatChartDate = (value: number) => {
    const full = formatDate(new Date(value).toISOString(), settings?.date_format)
    return spansYear ? full : shortDate(full, settings?.date_format)
  }

  const formatChange = (change: number) =>
    `${change > 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(change)}%`

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
        No price history yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart
        data={chartData}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        onClick={(state) => {
          if (!onPointClick) return
          const idx = Number(state?.activeIndex)
          const point = Number.isInteger(idx) ? chartData[idx] : undefined
          if (point && !point.carried) onPointClick({ id: point.id, date: point.date, price: point.price })
        }}
        className={onPointClick ? 'cursor-pointer' : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
          tickFormatter={(timestamp: number) => formatChartDate(timestamp)}
          minTickGap={16}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={yDomain}
          tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
          tickFormatter={(v: number) => formatCurrency(v, axisDigits)}
          tickCount={5}
          width={axisDigits ? 72 : 64}
        />
        <Tooltip
          separator=": "
          formatter={(value, _name, item) => {
            const point = item?.payload as ChartPoint | undefined
            const change = point?.change
            const suffix = change ? ` (${formatChange(change)})` : ''
            return [`${formatCurrency(Number(value))}${suffix}`, point?.carried ? 'Unchanged' : 'Price']
          }}
          labelFormatter={(value, payload) => {
            const when = formatDateTime(new Date(Number(value)).toISOString(), settings?.date_format)
            const carried = (payload?.[0]?.payload as ChartPoint | undefined)?.carried
            return carried ? `${when} · last check` : when
          }}
          contentStyle={{
            backgroundColor: 'var(--chart-tooltip-bg)',
            borderColor: 'var(--chart-tooltip-border)',
          }}
        />
        {/* stepAfter: a price holds until the next change; a curve would
            invent gradual moves between checks that never happened. */}
        <Line
          type="stepAfter"
          dataKey="price"
          stroke="var(--chart-line)"
          strokeWidth={2}
          dot={(props: { cx?: number; cy?: number; index?: number; payload?: ChartPoint }) =>
            props.payload?.carried || props.cx == null || props.cy == null ? (
              <g key={`dot-${props.index}`} />
            ) : (
              <circle
                key={`dot-${props.index}`}
                cx={props.cx}
                cy={props.cy}
                r={3}
                stroke="var(--chart-line)"
                strokeWidth={2}
                fill="#fff"
              />
            )
          }
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
