import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PriceHistory } from '../api/types'

interface PriceChartProps {
  data: PriceHistory[]
  currency?: string
}

export default function PriceChart({ data, currency = 'EUR' }: PriceChartProps) {
  const chartData = data.map((d) => ({
    date: new Date(d.scraped_at).toLocaleDateString(),
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
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${currency} ${v.toFixed(2)}`}
          width={80}
        />
        <Tooltip
          formatter={(value: number) => [`${currency} ${value.toFixed(2)}`, 'Price']}
        />
        <Line
          type="monotone"
          dataKey="price"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
