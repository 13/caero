import { ArrowDown, ArrowUp, Grid2x2, List, Search, X } from 'lucide-react'
import type { SortBy } from './sort'

export default function DashboardToolbar({
  searchTerm, onSearchTerm,
  sortBy, onSort,
  sortDirection, onToggleSortDirection,
  view, onView,
}: {
  searchTerm: string
  onSearchTerm: (value: string) => void
  sortBy: SortBy
  onSort: (key: SortBy) => void
  sortDirection: 'asc' | 'desc'
  onToggleSortDirection: () => void
  view: 'grid' | 'list'
  onView: (view: 'grid' | 'list') => void
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-[160px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <input
          value={searchTerm}
          onChange={(e) => onSearchTerm(e.target.value)}
          placeholder="Search…"
          aria-label="Search products"
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => onSearchTerm('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Sort select */}
      <select
        value={sortBy}
        onChange={(e) => onSort(e.target.value as SortBy)}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="name">Name</option>
        <option value="category">Category</option>
        <option value="latest_price">Price</option>
        <option value="last_change_percent">Change %</option>
        <option value="last_change_date">Change date</option>
      </select>

      {/* Sort direction */}
      <button
        onClick={onToggleSortDirection}
        aria-label={sortDirection === 'asc' ? 'Switch to descending' : 'Switch to ascending'}
        className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

      {/* View toggle */}
      <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => onView('grid')}
          aria-label="Grid view"
          className={`px-2.5 py-1.5 transition-colors ${
            view === 'grid'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <Grid2x2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => onView('list')}
          aria-label="List view"
          className={`px-2.5 py-1.5 transition-colors ${
            view === 'list'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <List className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
