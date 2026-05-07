export interface TimePickerProps {
  value: string | null | undefined
  onChange: (value: string) => void
  format?: '12h' | '24h'
  className?: string
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function parseTime(value: string | null | undefined) {
  const match = (value ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { h: 10, m: 0 }
  return {
    h: Math.min(23, Math.max(0, parseInt(match[1]))),
    m: Math.min(59, Math.max(0, parseInt(match[2]))),
  }
}

export default function TimePicker({ value, onChange, format = '24h', className = '' }: TimePickerProps) {
  const { h, m } = parseTime(value)
  const is12h = format === '12h'
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM'
  const displayH = is12h ? ((h % 12) || 12) : h

  const emit = (h24: number, min: number) => onChange(`${pad(h24)}:${pad(min)}`)

  const handleHours = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value)
    if (isNaN(v)) return
    if (is12h) {
      if (v >= 1 && v <= 12) emit(period === 'PM' ? (v === 12 ? 12 : v + 12) : (v === 12 ? 0 : v), m)
    } else {
      if (v >= 0 && v <= 23) emit(v, m)
    }
  }

  const handleMinutes = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value)
    if (!isNaN(v) && v >= 0 && v <= 59) emit(h, v)
  }

  const togglePeriod = (p: 'AM' | 'PM') => {
    if (p === period) return
    emit(p === 'PM' ? (h + 12) : (h - 12), m)
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="number"
        min={is12h ? 1 : 0}
        max={is12h ? 12 : 23}
        value={pad(displayH)}
        onChange={handleHours}
        className="w-8 text-center bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="text-gray-400 select-none">:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={pad(m)}
        onChange={handleMinutes}
        className="w-8 text-center bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {is12h && (
        <div className="flex gap-0.5 ml-1">
          {(['AM', 'PM'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePeriod(p)}
              className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
