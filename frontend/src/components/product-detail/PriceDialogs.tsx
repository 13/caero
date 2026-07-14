import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCreatePrice, useDeletePrice, useUiSettings, useUpdatePrice } from '../../api/hooks'
import type { PricePoint } from '../PriceChart'
import TimePicker from '../TimePicker'
import { formatDateTime } from '../../utils/format'
import { inputCls, labelCls } from '../../utils/styles'

/** Popup to edit or delete a single price-history point. */
export function PricePointDialog({ productId, point, onClose }: {
  productId: number
  point: PricePoint
  onClose: () => void
}) {
  const { data: settings } = useUiSettings()
  const updatePriceMutation = useUpdatePrice(productId)
  const deletePriceMutation = useDeletePrice(productId)

  const [editPriceValue, setEditPriceValue] = useState(point.price.toFixed(2))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSave = () => {
    const parsed = parseFloat(editPriceValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter a valid price greater than 0')
      return
    }
    updatePriceMutation.mutate(
      { priceId: point.id, price: parsed.toFixed(2) },
      {
        onSuccess: () => {
          toast.success('Price updated')
          onClose()
        },
        onError: (err) => toast.error(err.message || 'Update failed'),
      }
    )
  }

  const handleDelete = () => {
    deletePriceMutation.mutate(point.id, {
      onSuccess: () => {
        toast.success('Price entry deleted')
        onClose()
      },
      onError: (err) => toast.error(err.message || 'Delete failed'),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Price entry</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {formatDateTime(new Date(point.date).toISOString(), settings?.date_format)}
          </p>

          {confirmDelete ? (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Delete this price entry? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deletePriceMutation.isPending}
                  className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {deletePriceMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls}>Price</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={editPriceValue}
                  onChange={(e) => setEditPriceValue(e.target.value)}
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={updatePriceMutation.isPending}
                  className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {updatePriceMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 text-sm font-medium transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Popup to record a manual price entry. */
export function AddPriceDialog({ productId, onClose }: {
  productId: number
  onClose: () => void
}) {
  const { data: settings } = useUiSettings()
  const createPriceMutation = useCreatePrice(productId)

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const [form, setForm] = useState({
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    price: '',
  })

  const handleAdd = () => {
    const parsed = parseFloat(form.price)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter a valid price greater than 0')
      return
    }
    const [y, mo, d] = form.date.split('-').map(Number)
    const [h, mi] = form.time.split(':').map(Number)
    const dt = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0)
    if (!y || !mo || !d || Number.isNaN(dt.getTime())) {
      toast.error('Enter a valid date and time')
      return
    }
    createPriceMutation.mutate(
      { price: parsed.toFixed(2), scraped_at: dt.toISOString() },
      {
        onSuccess: () => {
          toast.success('Price added')
          onClose()
        },
        onError: (err) => toast.error(err.message || 'Add failed'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add price</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); handleAdd() }}
          className="p-5 space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Time</label>
              <TimePicker
                value={form.time}
                onChange={(value) => setForm({ ...form, time: value })}
                format={settings?.time_format ?? '24h'}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Price</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className={inputCls}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createPriceMutation.isPending}
              className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {createPriceMutation.isPending ? 'Adding…' : 'Add price'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
