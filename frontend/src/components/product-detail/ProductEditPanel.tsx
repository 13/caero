import { useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useUiSettings, useUpdateProduct } from '../../api/hooks'
import type { PriceFormat, Product } from '../../api/types'
import TimePicker from '../TimePicker'
import {
  CHECK_INTERVAL_HOUR_STEP,
  DEFAULT_CHECK_TIME_HHMM,
  MIN_CHECK_INTERVAL_HOURS,
  intervalMinutesToHours,
  normalizeCheckTimeHHMM,
  normalizeIntervalHoursToMinutes,
} from '../../utils/format'
import { inputCls, labelCls } from '../../utils/styles'

export default function ProductEditPanel({ product, onClose }: {
  product: Product
  onClose: () => void
}) {
  const { data: settings } = useUiSettings()
  const updateMutation = useUpdateProduct(product.id)

  const [editForm, setEditForm] = useState({
    name: product.name,
    category: product.category ?? '',
    memo: product.memo ?? '',
    tags: product.tags.join(', '),
    image_url: product.image_url ?? '',
    check_time_hhmm: product.check_time_hhmm ?? DEFAULT_CHECK_TIME_HHMM,
    url: product.url,
    selector: product.selector,
    check_interval_minutes: product.check_interval_minutes,
    record_all_prices: product.record_all_prices,
    price_format: product.price_format ?? 'auto',
    inverse_price: product.inverse_price,
    active: product.active && product.check_interval_minutes > 0,
  })
  const [editImageError, setEditImageError] = useState<string | null>(null)

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
          onClose()
        },
        onError: (err: Error) => toast.error(err?.message ?? 'Save failed'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end sm:flex-row sm:justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="relative w-full sm:w-auto sm:max-w-lg sm:h-full bg-white dark:bg-gray-950 shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none max-h-[90dvh] sm:max-h-full">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Edit product</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
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
              <label className={labelCls}>Price number format <span className="font-normal text-gray-400">(when prices parse wrong)</span></label>
              <select
                value={editForm.price_format}
                onChange={(e) => setEditForm({ ...editForm, price_format: e.target.value as PriceFormat })}
                style={{ colorScheme: 'light dark' }}
                className={inputCls}
              >
                <option value="auto">Auto-detect</option>
                <option value="eu">European (1.234,56)</option>
                <option value="us">US / UK (1,234.56)</option>
              </select>
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
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Record every check</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Store a price entry on every check, even when the price didn't change</p>
            </div>
            <input
              type="checkbox"
              id="edit-record-all-prices"
              checked={editForm.record_all_prices}
              onChange={(e) => setEditForm({ ...editForm, record_all_prices: e.target.checked })}
              className="rounded text-indigo-600 h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Inverse price colors</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Show rising prices green and falling prices red (e.g. resale value)</p>
            </div>
            <input
              type="checkbox"
              id="edit-inverse-price"
              checked={editForm.inverse_price}
              onChange={(e) => setEditForm({ ...editForm, inverse_price: e.target.checked })}
              className="rounded text-indigo-600 h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Active</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Run scheduled price checks for this product</p>
            </div>
            <input
              type="checkbox"
              id="edit-active"
              checked={editForm.active}
              onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
              className="rounded text-indigo-600 h-4 w-4"
            />
          </label>
          <div className="flex gap-2 pt-1 pb-4">
            <button type="submit" disabled={updateMutation.isPending} className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
