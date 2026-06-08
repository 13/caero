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
import { useSettings } from '../api/hooks'
import type { PriceHistory } from '../api/types'
import { localeFromDateFormat, formatDateTime } from '../utils/format'

export interface PricePoint {
  id: number
  date: number
  price: number
}

interface PriceChartProps {
  data: PriceHistory[]
  currency?: string
  onPointClick?: (point: PricePoint) => void
}

export default function PriceChart({ data, currency = 'EUR', onPointClick }: PriceChartProps) {
  const { data: settings } = useSettings()
  const locale = localeFromDateFormat(settings?.date_format)
  const currencyCode = useMemo(
    () => data.find((item) => item.currency)?.currency || currency,
    [currency, data]
  )

  const formatCurrency = (value: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
    } catch {
      return `${currencyCode} ${value.toFixed(2)}`
    }
  }

  const formatChartDate = (value: number) => {
    // Rely on formatting defined in format.ts instead of pure Intl localization to honor DD.MM.YYYY padding
    const isoString = new Date(value).toISOString()
    // formatDateTime handles extraction based on settings
    const localized = formatDateTime(isoString, settings?.date_format)
    return localized.split(' ')[0] // Just return the Day/Month/Year portion for the XAxis
  }

  const chartData = useMemo<PricePoint[]>(
    () =>
      data.map((dataPoint) => ({
        id: dataPoint.id,
        date: new Date(dataPoint.scraped_at).getTime(),
        price: parseFloat(dataPoint.price),
      })),
    [data]
  )

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
        No price history yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart
        data={chartData}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        onClick={(state) => {
          if (!onPointClick) return
          const idx = Number(state?.activeIndex)
          const point = Number.isInteger(idx) ? chartData[idx] : undefined
          if (point) onPointClick(point)
        }}
        className={onPointClick ? 'cursor-pointer' : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
          tickFormatter={(timestamp: number) => formatChartDate(timestamp)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
          tickFormatter={(v: number) => formatCurrency(v)}
          width={96}
        />
        <Tooltip
          formatter={(value) => [formatCurrency(Number(value)), 'Price']}
          labelFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString(), settings?.date_format)}
          contentStyle={{
            backgroundColor: 'var(--chart-tooltip-bg)',
            borderColor: 'var(--chart-tooltip-border)',
          }}
        />
        <Line
          type="monotone"
          dataKey="price"
          stroke="var(--chart-line)"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
