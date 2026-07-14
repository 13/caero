import { useState } from 'react'
import { Bell, Pencil, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  useAlerts,
  useCreateAlert,
  useDeleteAlert,
  useMe,
  useUpdateAlert,
} from '../../api/hooks'
import type { Alert, AlertCreate, User } from '../../api/types'
import ConfirmDialog from '../ConfirmDialog'
import { currencySymbol } from '../../utils/format'
import { inputCls, labelCls } from '../../utils/styles'

const createDefaultAlertForm = (user?: User): AlertCreate => ({
  condition: 'below',
  threshold_price: null,
  threshold_percent: null,
  email: user?.default_email ?? null,
  telegram_chat_id: user?.default_telegram_chat_id ?? null,
  active: true,
})

const CONDITION_OPTIONS = (
  <>
    <option value="below">Below threshold</option>
    <option value="lowered">Price lowered</option>
    <option value="lowered_percent">Dropped by at least %</option>
    <option value="changed">Price changed</option>
    <option value="any_change">Any change</option>
  </>
)

export default function AlertsSection({ productId, currency }: { productId: number; currency?: string }) {
  const symbol = currencySymbol(currency)
  const { data: alerts = [] } = useAlerts(productId)
  const { data: me } = useMe()
  const createAlertMutation = useCreateAlert(productId)
  const updateAlertMutation = useUpdateAlert(productId)
  const deleteAlertMutation = useDeleteAlert(productId)

  const [alertForm, setAlertForm] = useState<AlertCreate>(createDefaultAlertForm())
  const [editingAlertId, setEditingAlertId] = useState<number | null>(null)
  const [alertEditForm, setAlertEditForm] = useState<AlertCreate>(createDefaultAlertForm())
  const [showAddAlert, setShowAddAlert] = useState(false)
  const [alertDeleteTarget, setAlertDeleteTarget] = useState<Alert | null>(null)

  // Seed the form with the user's notification defaults at open time — no
  // effect needed, `me` is loaded long before anyone clicks "Add alert".
  const toggleAddAlert = () => {
    if (!showAddAlert) setAlertForm(createDefaultAlertForm(me))
    setShowAddAlert((v) => !v)
  }

  const handleAddAlert = (e: React.FormEvent) => {
    e.preventDefault()
    createAlertMutation.mutate(alertForm, {
      onSuccess: () => {
        toast.success('Alert added')
        setAlertForm(createDefaultAlertForm(me))
        setShowAddAlert(false)
      },
      onError: (err: Error) => toast.error(err?.message ?? 'Add alert failed'),
    })
  }

  const startEditAlert = (alert: Alert) => {
    setEditingAlertId(alert.id)
    setAlertEditForm({
      condition: alert.condition,
      threshold_price: alert.threshold_price,
      threshold_percent: alert.threshold_percent ?? null,
      email: alert.email ?? me?.default_email ?? null,
      telegram_chat_id: alert.telegram_chat_id ?? me?.default_telegram_chat_id ?? null,
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
        onError: (err: Error) => toast.error(err?.message ?? 'Update alert failed'),
      }
    )
  }

  const confirmDeleteAlert = () => {
    if (!alertDeleteTarget) return
    const target = alertDeleteTarget
    setAlertDeleteTarget(null)
    deleteAlertMutation.mutate(target.id, {
      onSuccess: () => {
        toast.success('Alert deleted')
      },
      onError: (err: Error) => toast.error(err?.message ?? 'Delete alert failed'),
    })
  }

  return (
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
          onClick={toggleAddAlert}
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
                  {alert.condition === 'below' && alert.threshold_price && (
                    <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      {symbol} {parseFloat(alert.threshold_price).toFixed(2)}
                    </span>
                  )}
                  {alert.condition === 'lowered_percent' && alert.threshold_percent && (
                    <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      ≥ {parseFloat(alert.threshold_percent).toFixed(1)}%
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
                    onClick={() => startEditAlert(alert)}
                    title="Edit alert"
                    aria-label="Edit alert"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setAlertDeleteTarget(alert)}
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
                    {CONDITION_OPTIONS}
                  </select>
                  {alertEditForm.condition === 'below' && (
                    <input type="number" step="0.01" min={0} value={alertEditForm.threshold_price ?? ''} onChange={(e) => setAlertEditForm({ ...alertEditForm, threshold_price: e.target.value || null })} placeholder="Threshold price" className={inputCls} />
                  )}
                  {alertEditForm.condition === 'lowered_percent' && (
                    <input type="number" step="0.1" min={0.1} max={100} value={alertEditForm.threshold_percent ?? ''} onChange={(e) => setAlertEditForm({ ...alertEditForm, threshold_percent: e.target.value || null })} placeholder="Drop percent (e.g. 10)" className={inputCls} />
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
                {CONDITION_OPTIONS}
              </select>
            </div>
            {alertForm.condition === 'below' && (
              <div>
                <label className={labelCls}>Threshold price ({symbol})</label>
                <input type="number" step="0.01" min={0} value={alertForm.threshold_price ?? ''} onChange={(e) => setAlertForm({ ...alertForm, threshold_price: e.target.value || null })} className={inputCls} />
              </div>
            )}
            {alertForm.condition === 'lowered_percent' && (
              <div>
                <label className={labelCls}>Drop percent (%)</label>
                <input type="number" step="0.1" min={0.1} max={100} value={alertForm.threshold_percent ?? ''} onChange={(e) => setAlertForm({ ...alertForm, threshold_percent: e.target.value || null })} placeholder="10" className={inputCls} />
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

      <ConfirmDialog
        open={alertDeleteTarget !== null}
        title="Delete this alert?"
        message={
          alertDeleteTarget
            ? `Condition: ${alertDeleteTarget.condition.replace('_', ' ')}${alertDeleteTarget.threshold_price ? ` • ${symbol}${parseFloat(alertDeleteTarget.threshold_price).toFixed(2)}` : ''}`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={confirmDeleteAlert}
        onCancel={() => setAlertDeleteTarget(null)}
      />
    </div>
  )
}
