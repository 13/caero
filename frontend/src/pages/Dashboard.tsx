import { useMemo, useState, useEffect } from 'react'
import { Plus, X, Search, Package } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import apiFetch from '../api/client'
import { useProducts, useAllAlerts, useMe, useSparklines, useUiSettings, useUpdateStarred } from '../api/hooks'
import type { Product, ProductUpdate } from '../api/types'
import ProductCard from '../components/ProductCard'
import DashboardToolbar from '../components/dashboard/DashboardToolbar'
import ProductTable from '../components/dashboard/ProductTable'
import { filterProducts, sortProducts, type SortBy } from '../components/dashboard/sort'

export default function Dashboard() {
  const { data: products, isLoading, error } = useProducts()
  const { data: alerts } = useAllAlerts()
  const { data: me } = useMe()
  const { data: uiSettings } = useUiSettings()
  const showSparklines = uiSettings?.show_sparklines ?? false
  const { data: sparklines } = useSparklines(showSparklines)
  const updateStarredMutation = useUpdateStarred()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [updatingProductIds, setUpdatingProductIds] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const updateProductMutation = useMutation<Product, Error, { id: number; body: ProductUpdate }>({
    mutationFn: ({ id, body }) =>
      apiFetch<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['products', variables.id] })
    },
  })

  const [view, setView] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('caero_view') as 'grid' | 'list') || 'grid'
  )
  const [sortBy, setSortBy] = useState<SortBy>(() =>
    (localStorage.getItem('caero_sort_by') as SortBy) || 'name'
  )
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() =>
    (localStorage.getItem('caero_sort_direction') as 'asc' | 'desc') || 'asc'
  )
  // Server value with an optimistic local override; the override is cleared
  // when the mutation settles (success refetches `me`, error reverts).
  const [starredOverride, setStarredOverride] = useState<number[] | null>(null)
  const starredIds = useMemo(
    () => starredOverride ?? me?.starred_product_ids ?? [],
    [starredOverride, me?.starred_product_ids]
  )
  const searchTerm = searchParams.get('q') ?? ''
  const status = (searchParams.get('status') as 'all' | 'active' | 'paused' | null) ?? 'active'

  const updateSearchTerm = (value: string) => {
    const nextParams = new URLSearchParams(searchParams)
    const next = value.trim()
    if (next) nextParams.set('q', next)
    else nextParams.delete('q')
    setSearchParams(nextParams, { replace: true })
  }

  const setStatus = (s: 'all' | 'active' | 'paused') => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('status', s)
    setSearchParams(nextParams, { replace: true })
  }

  const handleToggleActive = (productId: number, productName: string, currentActive: boolean) => {
    setUpdatingProductIds(prev => new Set(prev).add(productId))

    updateProductMutation.mutate(
      { id: productId, body: { active: !currentActive } },
      {
        onSuccess: () => {
          toast.success(currentActive ? `Paused ${productName}` : `Activated ${productName}`)
        },
        onError: (err: Error) => {
          toast.error(err?.message ?? 'Failed to update product')
        },
        onSettled: () => {
          setUpdatingProductIds(prev => {
            const next = new Set(prev)
            next.delete(productId)
            return next
          })
        },
      }
    )
  }

  useEffect(() => {
    localStorage.setItem('caero_view', view)
  }, [view])

  useEffect(() => {
    localStorage.setItem('caero_sort_by', sortBy)
  }, [sortBy])

  useEffect(() => {
    localStorage.setItem('caero_sort_direction', sortDirection)
  }, [sortDirection])

  const handleToggleStar = (productId: number) => {
    const product = products?.find(p => p.id === productId)
    const name = product?.name ?? 'Product'
    let nextIds: number[]
    if (starredIds.includes(productId)) {
      nextIds = starredIds.filter(id => id !== productId)
      toast.success(`Removed "${name}" from favourites`)
    } else if (starredIds.length >= 3) {
      toast.error('Maximum 3 starred products allowed')
      return
    } else {
      nextIds = [...starredIds, productId]
      toast.success(`Added "${name}" to favourites`)
    }
    setStarredOverride(nextIds)
    updateStarredMutation.mutate(nextIds, {
      onSuccess: () => setStarredOverride(null),
      onError: () => {
        setStarredOverride(null)
        toast.error('Failed to save favourite')
      },
    })
  }

  const handleSort = (nextSortBy: SortBy) => {
    if (sortBy === nextSortBy) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(nextSortBy)
    setSortDirection('asc')
  }

  const sortedProducts = useMemo(
    () => sortProducts(filterProducts(products ?? [], status, searchTerm), sortBy, sortDirection, starredIds),
    [products, status, searchTerm, sortBy, sortDirection, starredIds]
  )

  // Summary stats
  const activeCount = products?.filter((p) => p.active).length ?? 0
  const inactiveCount = (products?.length ?? 0) - activeCount
  const hasAlertsActive = (productId: number) => {
    return alerts?.some(a => a.product_id === productId && a.active) || false
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-16 text-red-500 dark:text-red-400">
        Failed to load products: {error.message}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      <DashboardToolbar
        searchTerm={searchTerm}
        onSearchTerm={updateSearchTerm}
        sortBy={sortBy}
        onSort={handleSort}
        sortDirection={sortDirection}
        onToggleSortDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        view={view}
        onView={setView}
      />

      {/* ── Status Tabs ── */}
      {products && products.length > 0 && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800">
          {([
            { key: 'active', label: `Active (${activeCount})` },
            { key: 'paused', label: `Paused (${inactiveCount})` },
            { key: 'all', label: `All (${products.length})` },
          ] as { key: 'all' | 'active' | 'paused'; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatus(key)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                status === key
                  ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              role="tab"
              aria-selected={status === key}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!products?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center mb-4">
            <Package className="h-8 w-8 text-indigo-400" />
          </div>
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">No products yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 mb-5">Start tracking prices by adding your first product.</p>
          <Link
            to="/add"
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add your first product
          </Link>
        </div>
      ) : !sortedProducts.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-50 dark:bg-gray-800 flex items-center justify-center mb-4">
            <Search className="h-8 w-8 text-gray-400" />
          </div>
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">Nothing found</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 mb-5">
            {searchTerm ? `No products match "${searchTerm}"` : 'No products in this view'}
          </p>
          {searchTerm && (
            <button
              onClick={() => updateSearchTerm('')}
              className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <X className="h-4 w-4" />
              Clear search
            </button>
          )}
        </div>
      ) : (
        <>
          {view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onKeywordClick={updateSearchTerm}
                  hasActiveAlerts={hasAlertsActive(p.id)}
                  searchSuffix={location.search}
                  onToggleActive={handleToggleActive}
                  isUpdating={updatingProductIds.has(p.id)}
                  isStarred={starredIds.includes(p.id)}
                  onToggleStar={handleToggleStar}
                  sparkline={showSparklines ? sparklines?.[p.id] : undefined}
                />
              ))}
            </div>
          ) : (
            <ProductTable
              products={sortedProducts}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSort={handleSort}
              starredIds={starredIds}
              onToggleStar={handleToggleStar}
              onToggleActive={handleToggleActive}
              hasActiveAlerts={hasAlertsActive}
              onSearchTerm={updateSearchTerm}
              sparklines={showSparklines ? sparklines : undefined}
            />
          )}

          {/* ── Footer Stats ── */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-800 pt-4">
            <p>Total Products: <span className="font-medium text-gray-700 dark:text-gray-300">{products?.length || 0}</span></p>
            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700"></span>
            <p>Active: <span className="font-medium text-green-600 dark:text-green-400">{activeCount}</span></p>
            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700"></span>
            <p>Paused: <span className="font-medium text-gray-500 dark:text-gray-400">{inactiveCount}</span></p>
          </div>
        </>
      )}
    </div>
  )
}
