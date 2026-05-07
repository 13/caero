import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ArrowLeft, RefreshCw, Pencil, Trash2, ExternalLink,
  Bell, Plus, X, TrendingDown, TrendingUp, BarChart3, ZoomIn,
} from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useAlerts,
  useCheckProduct,
  useCreateAlert,
  useDeleteAlert,
  useDeleteProduct,
  useMe,
  usePrices,
  useProduct,
  useProductStats,
  useSettings,
  useUpdateAlert,
  useUpdateProduct,
} from '../api/hooks'
import type { Alert, AlertCreate, User } from '../api/types'
import apiFetch from '../api/client'
import PriceChart from '../components/PriceChart'
import TimePicker from '../components/TimePicker'
import {
  DEFAULT_CHECK_TIME_HHMM,
  CHECK_INTERVAL_HOUR_STEP,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  MIN_CHECK_INTERVAL_HOURS,
  normalizeCheckTimeHHMM,
  formatDate,
  formatDateTime,
  formatPercent,
  formatPrice,
  intervalMinutesToHours,
  normalizeIntervalHoursToMinutes,
} from '../utils/format'
import { getTagColorClass } from '../utils/tags'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'

const createDefaultAlertForm = (user?: User): AlertCreate => ({
  condition: 'below',
  threshold_price: null,
  email: user?.default_email ?? null,
  telegram_chat_id: user?.default_telegram_chat_id ?? null,
  active: true,
})

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
  const { data: alerts = [] } = useAlerts(productId)
  const { data: stats } = useProductStats(productId)
  const { data: settings } = useSettings()
  const { data: me } = useMe()

  const updateMutation = useUpdateProduct(productId)
  const deleteMutation = useDeleteProduct()
  const checkMutation = useCheckProduct()
  const deleteAlertMutation = useDeleteAlert(productId)
  const createAlertMutation = useCreateAlert(productId)
  const updateAlertMutation = useUpdateAlert(productId)
  const qc = useQueryClient()

  // Create a reusable mutation for toggling active status
  const toggleActiveMutation = useMutation<any, Error, { id: number; active: boolean }>({
    mutationFn: ({ id, active }) =>
      apiFetch<any>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['products', variables.id] })
    },
  })

  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    category: '',
    memo: '',
    tags: '',
    image_url: '',
    check_time_hhmm: DEFAULT_CHECK_TIME_HHMM,
    url: '',
    selector: '',
    check_interval_minutes: DEFAULT_CHECK_INTERVAL_MINUTES,
    active: true,
  })

  const [alertForm, setAlertForm] = useState<AlertCreate>(createDefaultAlertForm())
  const [editingAlertId, setEditingAlertId] = useState<number | null>(null)
  const [alertEditForm, setAlertEditForm] = useState<AlertCreate>(createDefaultAlertForm())
  const [showAddAlert, setShowAddAlert] = useState(false)
  const [imageZoomed, setImageZoomed] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [alertDeleteTarget, setAlertDeleteTarget] = useState<Alert | null>(null)
  const [editImageError, setEditImageError] = useState<string | null>(null)

  useEffect(() => {
    if (me) {
      setAlertForm(prev => ({
        ...prev,
        email: prev.email || me.default_email || null,
        telegram_chat_id: prev.telegram_chat_id || me.default_telegram_chat_id || null,
      }))
      setAlertEditForm(prev => ({
        ...prev,
        email: prev.email || me.default_email || null,
        telegram_chat_id: prev.telegram_chat_id || me.default_telegram_chat_id || null,
      }))
    }
  }, [me])

  const handleEdit = () => {
    if (product) {
        setEditForm({
          name: product.name,
          category: product.category ?? '',
          memo: product.memo ?? '',
          tags: product.tags.join(', '),
          image_url: product.image_url ?? '',
          check_time_hhmm: product.check_time_hhmm ?? DEFAULT_CHECK_TIME_HHMM,
          url: product.url,
          selector: product.selector,
          check_interval_minutes: product.check_interval_minutes,
        active: product.active && product.check_interval_minutes > 0,
      })
    }
    setEditMode(true)
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    // Prevent saving a local cached path into the public Image URL field
    if (editForm.image_url && editForm.image_url.startsWith('/user_images/')) {
      setEditImageError('Please enter the original image URL (https://...), not a local cached path.')
      return
    }
    updateMutation.mutate(
      {
        ...editForm,
        category: editForm.category || null,
        memo: editForm.memo || null,
        image_url: editForm.image_url || null,
        check_time_hhmm: normalizeCheckTimeHHMM(editForm.check_time_hhmm),
        tags: editForm.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
      {
        onSuccess: () => {
          toast.success('Product updated')
          setEditMode(false)
        },
        onError: (err: any) => toast.error(err?.message ?? 'Save failed'),
      }
    )
  }

  const handleDelete = () => {
    setShowDeleteConfirm(true)
  }

  const confirmDelete = () => {
    deleteMutation.mutate(productId, {
      onSuccess: () => {
        toast.success(`Deleted ${product?.name ?? 'product'}`)
        navigate(`/${dashboardSearch}`)
      },
      onError: (err: any) => toast.error(err?.message ?? 'Delete failed'),
    })
    setShowDeleteConfirm(false)
  }

  const cancelDelete = () => setShowDeleteConfirm(false)

  const handleToggleActive = (productName: string, currentActive: boolean) => {
    toggleActiveMutation.mutate(
      { id: productId, active: !currentActive },
      {
        onSuccess: () => {
          toast.success(currentActive ? `Paused ${productName}` : `Activated ${productName}`)
        },
        onError: (err: any) => {
          toast.error(err?.message ?? 'Failed to update product')
        },
      }
    )
  }

  const handleAddAlert = (e: React.FormEvent) => {
    e.preventDefault()
    createAlertMutation.mutate(alertForm, {
      onSuccess: () => {
        toast.success('Alert added')
        setAlertForm(createDefaultAlertForm(me))
        setShowAddAlert(false)
      },
      onError: (err: any) => toast.error(err?.message ?? 'Add alert failed'),
    })
  }

  const startEditAlert = (
    alert: {
      id: number
      condition: AlertCreate['condition']
      threshold_price: string | null
      email: string | null
      telegram_chat_id: string | null
      active: boolean
    }
  ) => {
    setEditingAlertId(alert.id)
    setAlertEditForm({
      condition: alert.condition,
      threshold_price: alert.threshold_price,
      email: alert.email,
      telegram_chat_id: alert.telegram_chat_id,
      active: alert.active,
    })
  }

  const handleUpdateAlert = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAlertId) return
    updateAlertMutation.mutate(
      { alertId: editingAlertId, body: alertEditForm },
      {
        onSuccess: () => {
          toast.success('Alert updated')
          setEditingAlertId(null)
        },
        onError: (err: any) => toast.error(err?.message ?? 'Update alert failed'),
      }
    )
  }

  const startDeleteAlert = (alert: Alert) => {
    setAlertDeleteTarget(alert)
  }

  const confirmDeleteAlert = () => {
    if (!alertDeleteTarget) return
    const target = alertDeleteTarget
    setAlertDeleteTarget(null)
    deleteAlertMutation.mutate(target.id, {
      onSuccess: () => {
        toast.success('Alert deleted')
      },
      onError: (err: any) => toast.error(err?.message ?? 'Delete alert failed'),
    })
  }

  const cancelDeleteAlert = () => setAlertDeleteTarget(null)

  const runCheckNow = useCallback(() => {
    checkMutation.mutate(productId, {
      onSuccess: (data) => {
        if (data.price !== null) {
          toast.success('Successfully checked: €' + data.price)
        } else if (data.error) {
          toast.error(data.error)
        } else {
          toast.error('No price found (check selector)')
        }
      },
      onError: (err) => toast.error(err.message || 'Check failed'),
    })
  }, [checkMutation, productId])

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

  const productUrlChars = Array.from(product.url)
  const productUrlPreview =
    productUrlChars.length > 50 ? `${productUrlChars.slice(0, 50).join('')}…` : product.url

  const inputCls =
    'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

      {/* ── Top nav ── */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate(`/${dashboardSearch}`)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={runCheckNow}
            disabled={checkMutation.isPending}
            className="flex flex-1 items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 font-medium transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkMutation.isPending ? 'animate-spin' : ''}`} />
            {checkMutation.isPending ? 'Checking…' : 'Check now'}
          </button>
          <button
            onClick={handleEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {/* ── Hero card ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex gap-6 items-start">
          {product.image_url && (
            <>
              {/* Lightbox */}
              {imageZoomed && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
                  onClick={() => setImageZoomed(false)}
                >
                  <button
                    onClick={() => setImageZoomed(false)}
                    className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                    aria-label="Close zoom"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
                  />
                </div>
              )}
              <div className="shrink-0 relative group cursor-zoom-in" onClick={() => setImageZoomed(true)}>
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-28 h-28 object-contain rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 transition-opacity group-hover:opacity-80"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <ZoomIn className="h-6 w-6 text-gray-700 dark:text-gray-200 drop-shadow" />
                </div>
              </div>
            </>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
                {product.name}
              </h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-opacity hover:opacity-80 ${
                product.active
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}
              onClick={() => handleToggleActive(product.name, product.active)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleToggleActive(product.name, product.active)
                }
              }}
              title={`Click to ${product.active ? 'pause' : 'activate'} tracking`}
              >
                {toggleActiveMutation.isPending ? '…' : (product.active ? 'Active' : 'Paused')}
              </span>
            </div>

            {/* Warning banner */}
            {product.consecutive_scrape_failures > 0 && (
              <div className="mt-3 text-sm px-3 py-2 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50 flex items-center gap-2 max-w-max">
                <span className="font-semibold px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900 leading-none">
                  {product.consecutive_scrape_failures}
                </span>
                <span>Consecutive failed checks. The CSS selector may be broken or the website layout changed.</span>
              </div>
            )}

            {/* Price row */}
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="text-4xl font-extrabold text-indigo-600 dark:text-indigo-400 tracking-tight">
                {formatPrice(product.latest_price, settings?.date_format)}
              </span>
              {product.last_price_change_percent !== null && (() => {
                const pct = parseFloat(product.last_price_change_percent ?? '0')
                return (
                  <span
                    className={`inline-flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full ${
                      pct < 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : pct > 0
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {pct < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingUp className="h-3.5 w-3.5" />
                    )}
                    {formatPercent(product.last_price_change_percent, settings?.date_format)}
                  </span>
                )
              })()}
            </div>

            {product.last_checked_at && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Last checked: {formatDateTime(product.last_checked_at, settings?.date_format)}
              </p>
            )}

            {/* Meta row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {product.category && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                  {product.category}
                </span>
              )}
              {product.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTagColorClass(tag)}`}
                >
                  {tag}
                </span>
              ))}
              {product.next_run_at && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
                  Next run: {formatDateTime(product.next_run_at, settings?.date_format)}
                </span>
              )}
            </div>

            {product.memo && (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                {product.memo}
              </p>
            )}

            {/* URL chip */}
            <div className="mt-3 min-w-0 max-w-full">
              <a
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                title={product.url}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors max-w-full overflow-hidden"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{productUrlPreview}</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Edit panel (bottom sheet on mobile, slide-over on desktop) ── */}
      {editMode && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end sm:flex-row sm:justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setEditMode(false)}
          />
          {/* Panel */}
          <div className="relative w-full sm:w-auto sm:max-w-lg sm:h-full bg-white dark:bg-gray-950 shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none max-h-[90dvh] sm:max-h-full">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Edit product</h2>
              <button onClick={() => setEditMode(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Name</label>
                  <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <input type="text" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Interval (hrs)</label>
                  <input
                    type="number"
                    min={MIN_CHECK_INTERVAL_HOURS}
                    step={CHECK_INTERVAL_HOUR_STEP}
                    value={intervalMinutesToHours(editForm.check_interval_minutes)}
                    onChange={(e) => setEditForm({ ...editForm, check_interval_minutes: normalizeIntervalHoursToMinutes(parseFloat(e.target.value)) })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Check time</label>
                  <TimePicker
                    value={editForm.check_time_hhmm}
                    onChange={(value) => setEditForm({ ...editForm, check_time_hhmm: value })}
                    format={settings?.time_format ?? '24h'}
                    className={inputCls}
                  />
                 </div>
                <div className="col-span-2">
                  <label className={labelCls}>Tags <span className="font-normal text-gray-400">(comma-separated)</span></label>
                  <input type="text" value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Memo</label>
                  <textarea value={editForm.memo} onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })} rows={3} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>URL</label>
                  <input type="url" value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>CSS selector</label>
                  <input type="text" value={editForm.selector} onChange={(e) => setEditForm({ ...editForm, selector: e.target.value })} className={`${inputCls} font-mono text-xs`} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Image URL</label>
                  <input
                    type="url"
                    value={editForm.image_url}
                    onChange={(e) => {
                      setEditForm({ ...editForm, image_url: e.target.value })
                      setEditImageError(null)
                    }}
                    className={inputCls}
                  />
                  {editImageError && <p className="mt-1 text-xs text-red-600">{editImageError}</p>}
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" id="edit-active" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} className="rounded text-indigo-600" />
                Active
              </label>
              <div className="flex gap-2 pt-1 pb-4">
                <button type="submit" disabled={updateMutation.isPending} className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" onClick={() => setEditMode(false)} className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete "${product.name}"?`}
        message="This will remove the product and its cached image."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      <ConfirmDialog
        open={alertDeleteTarget !== null}
        title="Delete this alert?"
        message={
          alertDeleteTarget
            ? `Condition: ${alertDeleteTarget.condition.replace('_', ' ')}${alertDeleteTarget.threshold_price ? ` • €${parseFloat(alertDeleteTarget.threshold_price).toFixed(2)}` : ''}`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={confirmDeleteAlert}
        onCancel={cancelDeleteAlert}
      />

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Average', value: formatPrice(stats?.average_price ?? null, settings?.date_format) },
          {
            label: 'All-time low',
            value: formatPrice(stats?.lowest_price ?? null, settings?.date_format),
            sub: formatDate(stats?.lowest_price_at ?? null, settings?.date_format),
            accent: 'text-green-600 dark:text-green-400',
          },
          {
            label: 'All-time high',
            value: formatPrice(stats?.highest_price ?? null, settings?.date_format),
            sub: formatDate(stats?.highest_price_at ?? null, settings?.date_format),
            accent: 'text-red-500 dark:text-red-400',
          },
          {
            label: 'Total change',
            value: formatPercent(stats?.total_change_percent ?? null, settings?.date_format),
          },
          { label: 'Data points', value: String(stats?.data_points ?? 0) },
        ].map(({ label, value, sub, accent }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
            <p className={`text-base font-bold ${accent ?? 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
            {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Price chart ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-indigo-500" />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Price history</h2>
        </div>
        <PriceChart data={prices} />
      </div>

      {/* ── Alerts ── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-indigo-500" />
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Price alerts</h2>
            {alerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">
                {alerts.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowAddAlert((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium"
          >
            {showAddAlert ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAddAlert ? 'Cancel' : 'Add alert'}
          </button>
        </div>

        {alerts.length === 0 && !showAddAlert && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Bell className="h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-400 dark:text-gray-500">No alerts yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">Add one to get notified when the price changes.</p>
          </div>
        )}

        {alerts.length > 0 && (
          <ul className="space-y-2 mb-4">
            {alerts.map((alert) => (
              <li key={alert.id} className="text-sm bg-gray-50 dark:bg-gray-800/60 rounded-xl px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="font-medium text-gray-800 dark:text-gray-200 capitalize">
                      {alert.condition.replace('_', ' ')}
                    </span>
                    {alert.threshold_price && (
                      <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                        € {parseFloat(alert.threshold_price).toFixed(2)}
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        alert.active
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {alert.active ? 'Active' : 'Paused'}
                    </span>
                    {(alert.email || alert.telegram_chat_id) && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        → {[alert.email, alert.telegram_chat_id ? `tg:${alert.telegram_chat_id}` : null].filter(Boolean).join(' • ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        startEditAlert({
                          id: alert.id,
                          condition: alert.condition as AlertCreate['condition'],
                          threshold_price: alert.threshold_price,
                          email: alert.email,
                          telegram_chat_id: alert.telegram_chat_id,
                          active: alert.active,
                        })
                      }
                      title="Edit alert"
                      aria-label="Edit alert"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => startDeleteAlert(alert)}
                      title="Delete alert"
                      aria-label="Delete alert"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {editingAlertId === alert.id && (
                  <form onSubmit={handleUpdateAlert} className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-gray-200 dark:border-gray-700">
                    <select
                      value={alertEditForm.condition}
                      onChange={(e) => setAlertEditForm({ ...alertEditForm, condition: e.target.value as AlertCreate['condition'] })}
                      className={inputCls}
                    >
                      <option value="below">Below threshold</option>
                      <option value="lowered">Price lowered</option>
                      <option value="changed">Price changed</option>
                      <option value="any_change">Any change</option>
                    </select>
                    {alertEditForm.condition === 'below' && (
                      <input type="number" step="0.01" min={0} value={alertEditForm.threshold_price ?? ''} onChange={(e) => setAlertEditForm({ ...alertEditForm, threshold_price: e.target.value || null })} placeholder="Threshold price" className={inputCls} />
                    )}
                    <input type="email" value={alertEditForm.email ?? ''} onChange={(e) => setAlertEditForm({ ...alertEditForm, email: e.target.value.trim() ? e.target.value : null })} placeholder="you@example.com" className={inputCls} />
                    <input type="text" value={alertEditForm.telegram_chat_id ?? ''} onChange={(e) => setAlertEditForm({ ...alertEditForm, telegram_chat_id: e.target.value.trim() ? e.target.value : null })} placeholder="Telegram chat ID" className={inputCls} />
                    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={alertEditForm.active} onChange={(e) => setAlertEditForm({ ...alertEditForm, active: e.target.checked })} />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" disabled={updateAlertMutation.isPending} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setEditingAlertId(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs">Cancel</button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Collapsible add-alert form */}
        {showAddAlert && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">New alert</p>
            <form
              onSubmit={(e) => { handleAddAlert(e); setShowAddAlert(false) }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <div>
                <label className={labelCls}>Condition</label>
                <select
                  value={alertForm.condition}
                  onChange={(e) => setAlertForm({ ...alertForm, condition: e.target.value as AlertCreate['condition'] })}
                  className={inputCls}
                >
                  <option value="below">Below threshold</option>
                  <option value="lowered">Price lowered</option>
                  <option value="changed">Price changed</option>
                  <option value="any_change">Any change</option>
                </select>
              </div>
              {alertForm.condition === 'below' && (
                <div>
                  <label className={labelCls}>Threshold price (€)</label>
                  <input type="number" step="0.01" min={0} value={alertForm.threshold_price ?? ''} onChange={(e) => setAlertForm({ ...alertForm, threshold_price: e.target.value || null })} className={inputCls} />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={labelCls}>Email</label>
                <input type="email" value={alertForm.email ?? ''} onChange={(e) => setAlertForm({ ...alertForm, email: e.target.value.trim() ? e.target.value : null })} placeholder="you@example.com" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Telegram chat ID</label>
                <input type="text" value={alertForm.telegram_chat_id ?? ''} onChange={(e) => setAlertForm({ ...alertForm, telegram_chat_id: e.target.value.trim() ? e.target.value : null })} placeholder="123456789" className={inputCls} />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Provide email, Telegram chat ID, or both.</p>
              </div>
              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={alertForm.active} onChange={(e) => setAlertForm({ ...alertForm, active: e.target.checked })} />
                  Active
                </label>
              </div>
              <div className="sm:col-span-2">
                <button type="submit" disabled={createAlertMutation.isPending} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {createAlertMutation.isPending ? 'Adding…' : 'Add alert'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
