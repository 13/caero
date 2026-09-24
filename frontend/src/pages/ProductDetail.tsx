import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Pencil, Trash2, BarChart3, Plus } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  useCheckProduct,
  useDeleteProduct,
  usePrices,
  useProduct,
  useProductStats,
  useUpdateProduct,
} from '../api/hooks'
import PriceChart, { type PricePoint } from '../components/PriceChart'
import ProductHero from '../components/product-detail/ProductHero'
import ProductEditPanel, { type EditFocusField } from '../components/product-detail/ProductEditPanel'
import StatsStrip from '../components/product-detail/StatsStrip'
import AlertsSection from '../components/product-detail/AlertsSection'
import { AddPriceDialog, PricePointDialog } from '../components/product-detail/PriceDialogs'
import ConfirmDialog from '../components/ConfirmDialog'
import { currencySymbol } from '../utils/format'
import { checkFailureMessage } from '../utils/scrapeFailure'
import toast from 'react-hot-toast'

const CHART_RANGES = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: '1y', label: '1y', days: 365 },
  { key: 'all', label: 'All', days: null },
] as const

type ChartRange = (typeof CHART_RANGES)[number]['key']

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const productId = parseInt(id ?? '0')
  const location = useLocation()
  const navigate = useNavigate()
  const dashboardSearch = location.search || ''
  const autoCheckTriggeredRef = useRef(false)
  const autoCheckOnLoad =
    (location.state as { autoCheckOnLoad?: boolean } | null)?.autoCheckOnLoad === true

  const { data: product, isLoading } = useProduct(productId)
  const { data: prices = [] } = usePrices(productId)
  const { data: stats } = useProductStats(productId)

  const updateMutation = useUpdateProduct(productId)
  const deleteMutation = useDeleteProduct()
  const checkMutation = useCheckProduct()

  const [editMode, setEditMode] = useState(false)
  const [editFocus, setEditFocus] = useState<{ field: EditFocusField } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<PricePoint | null>(null)
  const [showAddPrice, setShowAddPrice] = useState(false)
  const [chartRange, setChartRange] = useState<ChartRange>('all')

  // Range is anchored to the newest data point (not the wall clock), which
  // keeps the computation pure and shows the last N days *of data* even for
  // products that haven't been checked recently.
  const chartPrices = useMemo(() => {
    const days = CHART_RANGES.find((r) => r.key === chartRange)?.days
    if (!days || prices.length === 0) return prices
    const newest = Math.max(...prices.map((p) => new Date(p.scraped_at).getTime()))
    const cutoff = newest - days * 24 * 60 * 60 * 1000
    return prices.filter((p) => new Date(p.scraped_at).getTime() >= cutoff)
  }, [prices, chartRange])

  const confirmDelete = () => {
    deleteMutation.mutate(productId, {
      onSuccess: () => {
        toast.success(`Deleted ${product?.name ?? 'product'}`)
        navigate(`/${dashboardSearch}`)
      },
      onError: (err: Error) => toast.error(err?.message ?? 'Delete failed'),
    })
    setShowDeleteConfirm(false)
  }

  const handleToggleActive = () => {
    if (!product) return
    updateMutation.mutate(
      { active: !product.active },
      {
        onSuccess: () => {
          toast.success(product.active ? `Paused ${product.name}` : `Activated ${product.name}`)
        },
        onError: (err: Error) => {
          toast.error(err?.message ?? 'Failed to update product')
        },
      }
    )
  }

  const runCheckNow = useCallback(() => {
    checkMutation.mutate(productId, {
      onSuccess: (data) => {
        if (data.price !== null) {
          toast.success(`Successfully checked: ${currencySymbol(product?.currency)}${data.price}`)
        } else {
          toast.error(checkFailureMessage(data))
        }
      },
      onError: (err) => toast.error(err.message || 'Check failed'),
    })
  }, [checkMutation, productId, product?.currency])

  useEffect(() => {
    if (!autoCheckOnLoad || autoCheckTriggeredRef.current || isLoading || !product || productId <= 0) {
      return
    }

    autoCheckTriggeredRef.current = true
    runCheckNow()
    // Consume one-shot navigation state so refresh/back does not auto-trigger again.
    navigate(location.pathname, { replace: true, state: null })
  }, [autoCheckOnLoad, isLoading, location.pathname, navigate, product, productId, runCheckNow])

  if (isLoading || !product) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

      {/* ── Top nav ── */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => navigate(`/${dashboardSearch}`)}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        {/* Labels collapse to icons on phones so the row never wraps. */}
        <div className="flex items-center gap-2">
          <button
            onClick={runCheckNow}
            disabled={checkMutation.isPending}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 font-medium transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkMutation.isPending ? 'animate-spin' : ''}`} />
            {checkMutation.isPending ? 'Checking…' : 'Check now'}
          </button>
          <button
            onClick={() => setEditMode(true)}
            aria-label="Edit"
            title="Edit"
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            aria-label="Delete"
            title="Delete"
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm rounded-lg border border-transparent text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>

      <ProductHero
        product={product}
        onToggleActive={handleToggleActive}
        togglePending={updateMutation.isPending}
        onCheckNow={runCheckNow}
        checkPending={checkMutation.isPending}
        onEdit={(field) => {
          setEditMode(true)
          setEditFocus({ field })
        }}
      />

      {editMode && (
        <ProductEditPanel
          product={product}
          focusRequest={editFocus}
          onClose={() => {
            setEditMode(false)
            setEditFocus(null)
          }}
        />
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete "${product.name}"?`}
        message="This will remove the product and its cached image."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {selectedPoint && (
        <PricePointDialog
          productId={productId}
          point={selectedPoint}
          onClose={() => setSelectedPoint(null)}
        />
      )}

      {showAddPrice && (
        <AddPriceDialog productId={productId} onClose={() => setShowAddPrice(false)} />
      )}

      <StatsStrip stats={stats} currency={product.currency} inversePrice={product.inverse_price} />

      {/* ── Price chart ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        {/* Phones: title + Add on one row, full-width range picker below.
            sm+: everything on one row. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3 mb-4">
          <BarChart3 className="h-4 w-4 shrink-0 text-indigo-500" />
          <h2 className="font-semibold whitespace-nowrap text-gray-800 dark:text-gray-100">Price history</h2>
          {prices.length > 0 && (
            <span className="hidden md:inline text-xs text-gray-400 dark:text-gray-500">
              Tip: click a point to edit or delete it
            </span>
          )}
          {prices.length > 0 && (
            <div
              role="group"
              aria-label="Chart range"
              className="order-last w-full sm:order-none sm:w-auto sm:ml-auto flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {CHART_RANGES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setChartRange(key)}
                  aria-pressed={chartRange === key}
                  className={`flex-1 sm:flex-none px-2.5 py-2.5 sm:py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                    chartRange === key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowAddPrice(true)}
            aria-label="Add price"
            className={`${prices.length > 0 ? 'ml-auto sm:ml-0' : 'ml-auto'} inline-flex items-center gap-1.5 whitespace-nowrap text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add price</span>
          </button>
        </div>
        {chartPrices.length === 0 && prices.length > 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            No price entries in this range
          </div>
        ) : (
          <PriceChart
            data={chartPrices}
            currency={product.currency}
            extendTo={product.last_checked_at}
            onPointClick={setSelectedPoint}
          />
        )}
      </div>

      <AlertsSection productId={productId} currency={product.currency} />
    </div>
  )
}
