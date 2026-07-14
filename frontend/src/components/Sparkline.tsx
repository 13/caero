import { useMemo } from 'react'
import type { SparklinePoint } from '../api/types'

/** Tiny inline price trend — pure SVG, no chart library in the dashboard chunk.
 *  invert flips the color semantics for products where rising prices are good. */
export default function Sparkline({ points, className = '', invert = false }: {
  points: SparklinePoint[]
  className?: string
  invert?: boolean
}) {
  const path = useMemo(() => {
    if (points.length < 2) return null

    const xs = points.map((pt) => new Date(pt.t).getTime())
    const ys = points.map((pt) => parseFloat(pt.p))
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
    const spanX = maxX - minX || 1
    const spanY = maxY - minY || 1

    // 100×28 viewBox with 2px vertical padding
    const coords = points.map((_, i) => {
      const x = ((xs[i] - minX) / spanX) * 100
      const y = 26 - ((ys[i] - minY) / spanY) * 24
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return {
      line: `M ${coords.join(' L ')}`,
      falling: ys[ys.length - 1] < ys[0],
      flat: ys[ys.length - 1] === ys[0],
    }
  }, [points])

  if (!path) return null

  const good = path.falling !== invert
  const stroke = path.flat
    ? 'stroke-gray-400 dark:stroke-gray-500'
    : good
      ? 'stroke-green-500'
      : 'stroke-red-400'

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className={`w-full h-7 ${className}`}
      aria-hidden="true"
    >
      <path d={path.line} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={stroke} />
    </svg>
  )
}
