import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useSettings } from '../api/hooks'
import type { PriceHistory } from '../api/types'
import { localeFromDateFormat } from '../utils/format'

interface PriceChartProps {
  data: PriceHistory[]
  currency?: string
}

export default function PriceChart({ data, currency = 'EUR' }: PriceChartProps) {
  const { data: settings } = useSettings()
  const locale = localeFromDateFormat(settings?.date_format)
  const currencyCode = data.find((item) => item.currency)?.currency || currency

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

  const formatDate = (value: number) => {
    try {
      return new Intl.DateTimeFormat(locale).format(new Date(value))
    } catch {
      return new Date(value).toLocaleDateString()
    }
  }

  const chartData = data.map((d) => ({
    date: new Date(d.scraped_at).getTime(),
    price: parseFloat(d.price),
  }))

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
        No price history yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
          tickFormatter={(value: number) => formatDate(value)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
          tickFormatter={(v: number) => formatCurrency(v)}
          width={96}
        />
        <Tooltip
          formatter={(value: number) => [formatCurrency(value), 'Price']}
          labelFormatter={(value: number) => formatDate(value)}
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
