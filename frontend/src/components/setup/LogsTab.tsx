import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, ScrollText, X } from 'lucide-react'
import { useEventLog, useUiSettings } from '../../api/hooks'
import type { EventCategory, EventLevel, EventLogEntry } from '../../api/types'
import { formatDateTime } from '../../utils/format'
import {
  CATEGORIES,
  LEVELS,
  eventDetailRows,
  logQueryString,
  parseLogFilters,
  writeLogFilters,
  type LogFilters,
} from '../../utils/logFilters'
import Section from './Section'

const LEVEL_STYLE: Record<EventLevel, string> = {
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const controlCls =
  'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 px-2.5 py-1.5'

function EventRow({ entry, dateFormat, expanded, onToggle, onFilterProduct }: {
  entry: EventLogEntry
  dateFormat?: string
  expanded: boolean
  onToggle: () => void
  onFilterProduct: (id: number, name: string) => void
}) {
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span className={`shrink-0 mt-0.5 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${LEVEL_STYLE[entry.level]}`}>
        {entry.level}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-500 dark:text-gray-400">
          <time dateTime={entry.created_at}>{formatDateTime(entry.created_at, dateFormat)}</time>
          <span>{entry.category}</span>
          {entry.product_name && (entry.product_id ? (
            <button
              type="button"
              onClick={() => onFilterProduct(entry.product_id!, entry.product_name!)}
              title="Show only this product"
              className="text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-[16rem]"
            >
              {entry.product_name}
            </button>
          ) : (
            <span className="line-through truncate max-w-[16rem]" title="Product deleted">{entry.product_name}</span>
          ))}
        </div>
        <p className="text-sm text-gray-800 dark:text-gray-200 break-words">{entry.message}</p>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          Details
        </button>
        {expanded && (
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5">
            {eventDetailRows(entry).map(([key, value]) => (
              <Fragment key={key}>
                <dt className="text-gray-500 dark:text-gray-400">{key}</dt>
                <dd className="font-mono break-all text-gray-700 dark:text-gray-200">{value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    </li>
  )
}

export default function LogsTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseLogFilters(searchParams)
  const filterKey = logQueryString(filters)
  const { data: uiSettings } = useUiSettings()

  const [search, setSearch] = useState(filters.q)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [autoRefresh, setAutoRefresh] = useState(true)
  // Which filter set the user paged past page 1 for (reset implicitly when filters change).
  const [loadedMoreFor, setLoadedMoreFor] = useState<string | null>(null)

  // Refetching every page while someone reads page 3 or an expanded row would
  // shift the list under them.
  const live = autoRefresh && expanded.size === 0 && loadedMoreFor !== filterKey
  const query = useEventLog(filters, live)
  const entries = query.data?.pages.flatMap((p) => p.items) ?? []

  const update = (patch: Partial<LogFilters>) => {
    setExpanded(new Set())
    setSearchParams(writeLogFilters(searchParams, { ...filters, ...patch }), { replace: true })
  }

  useEffect(() => {
    if (search.trim() === filters.q) return
    const timer = setTimeout(() => update({ q: search }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const toggleLevel = (level: EventLevel) =>
    update({ levels: filters.levels.includes(level) ? filters.levels.filter((l) => l !== level) : [...filters.levels, level] })

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Section icon={ScrollText} title="Event log" description="Scrapes, alerts, delivery failures and system events">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Level">
          {LEVELS.map((level) => {
            const on = filters.levels.includes(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLevel(level)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                  on
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {level}
              </button>
            )
          })}
        </div>
        <select
          aria-label="Category"
          value={filters.category ?? ''}
          onChange={(e) => update({ category: (e.target.value || null) as EventCategory | null })}
          className={controlCls}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="search"
          aria-label="Search logs"
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${controlCls} min-w-0 sm:flex-1`}
        />
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
      </div>

      {filters.productId && (
        <div>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
            Product: {filters.productName ?? `#${filters.productId}`}
            <button
              type="button"
              aria-label="Clear product filter"
              onClick={() => update({ productId: null, productName: null })}
              className="hover:text-indigo-900 dark:hover:text-indigo-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {query.isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{query.error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No events match these filters.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {entries.map((entry) => (
            <EventRow
              key={entry.id}
              entry={entry}
              dateFormat={uiSettings?.date_format}
              expanded={expanded.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
              onFilterProduct={(productId, productName) => update({ productId, productName })}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => {
            setLoadedMoreFor(filterKey)
            query.fetchNextPage()
          }}
          disabled={query.isFetchingNextPage}
          className="w-full py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </Section>
  )
}
