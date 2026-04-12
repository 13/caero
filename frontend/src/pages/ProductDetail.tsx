import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useAlerts,
  useCheckProduct,
  useCreateAlert,
  useDeleteAlert,
  useDeleteProduct,
  usePrices,
  useProduct,
  useUpdateProduct,
} from '../api/hooks'
import type { AlertCreate } from '../api/types'
import PriceChart from '../components/PriceChart'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const productId = parseInt(id ?? '0')
  const navigate = useNavigate()

  const { data: product, isLoading } = useProduct(productId)
  const { data: prices = [] } = usePrices(productId)
  const { data: alerts = [] } = useAlerts(productId)

  const updateMutation = useUpdateProduct(productId)
  const deleteMutation = useDeleteProduct()
  const checkMutation = useCheckProduct()
  const deleteAlertMutation = useDeleteAlert(productId)
  const createAlertMutation = useCreateAlert(productId)

  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    url: '',
    selector: '',
    check_interval_minutes: 30,
    active: true,
  })

  const [alertForm, setAlertForm] = useState<AlertCreate>({
    condition: 'below',
    threshold_price: null,
    email: '',
    active: true,
  })

  const handleEdit = () => {
    if (product) {
      setEditForm({
        name: product.name,
        url: product.url,
        selector: product.selector,
        check_interval_minutes: product.check_interval_minutes,
        active: product.active,
      })
    }
    setEditMode(true)
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    updateMutation.mutate(editForm, { onSuccess: () => setEditMode(false) })
  }

  const handleDelete = () => {
    if (confirm(`Delete "${product?.name}"?`)) {
      deleteMutation.mutate(productId, { onSuccess: () => navigate('/') })
    }
  }

  const handleAddAlert = (e: React.FormEvent) => {
    e.preventDefault()
    createAlertMutation.mutate(alertForm, {
      onSuccess: () =>
        setAlertForm({ condition: 'below', threshold_price: null, email: '', active: true }),
    })
  }

  if (isLoading || !product) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-400 hover:text-gray-600 mb-2 block"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-500 hover:underline truncate block max-w-md"
          >
            {product.url}
          </a>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => checkMutation.mutate(productId)}
            disabled={checkMutation.isPending}
            className="px-3 py-1.5 text-sm rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium disabled:opacity-50"
          >
            {checkMutation.isPending ? 'Checking…' : 'Check now'}
          </button>
          <button
            onClick={handleEdit}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-sm rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editMode && (
        <form
          onSubmit={handleSave}
          className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4"
        >
          <h2 className="font-semibold text-gray-800">Edit product</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Name</label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Check interval (min)
              </label>
              <input
                type="number"
                min={1}
                value={editForm.check_interval_minutes}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    check_interval_minutes: parseInt(e.target.value) || 30,
                  })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 mb-1 block">URL</label>
              <input
                type="url"
                value={editForm.url}
                onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 mb-1 block">CSS selector</label>
              <input
                type="text"
                value={editForm.selector}
                onChange={(e) => setEditForm({ ...editForm, selector: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit-active"
              checked={editForm.active}
              onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
              className="rounded text-indigo-600"
            />
            <label htmlFor="edit-active" className="text-sm text-gray-700">
              Active
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Current price + stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Current price</p>
          <p className="text-3xl font-bold text-indigo-600">
            {product.latest_price ? `€ ${parseFloat(product.latest_price).toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">All-time low</p>
          <p className="text-2xl font-bold text-green-600">
            {prices.length
              ? `€ ${Math.min(...prices.map((p) => parseFloat(p.price))).toFixed(2)}`
              : '—'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Data points</p>
          <p className="text-2xl font-bold text-gray-700">{prices.length}</p>
        </div>
      </div>

      {/* Price chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Price history</h2>
        <PriceChart data={prices} />
      </div>

      {/* Alerts */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Price alerts</h2>

        {alerts.length > 0 && (
          <ul className="space-y-2 mb-4">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2"
              >
                <div>
                  <span className="font-medium text-gray-800 capitalize">
                    {alert.condition.replace('_', ' ')}
                  </span>
                  {alert.threshold_price && (
                    <span className="text-gray-500 ml-1">
                      € {parseFloat(alert.threshold_price).toFixed(2)}
                    </span>
                  )}
                  <span className="text-gray-400 ml-2">→ {alert.email}</span>
                </div>
                <button
                  onClick={() => deleteAlertMutation.mutate(alert.id)}
                  className="text-red-400 hover:text-red-600 ml-4"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddAlert} className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Condition</label>
            <select
              value={alertForm.condition}
              onChange={(e) =>
                setAlertForm({
                  ...alertForm,
                  condition: e.target.value as AlertCreate['condition'],
                })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="below">Below threshold</option>
              <option value="changed">Price changed</option>
              <option value="any_change">Any change</option>
            </select>
          </div>
          {alertForm.condition === 'below' && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Threshold price (€)
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={alertForm.threshold_price ?? ''}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, threshold_price: e.target.value || null })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
            <input
              required
              type="email"
              value={alertForm.email}
              onChange={(e) => setAlertForm({ ...alertForm, email: e.target.value })}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={createAlertMutation.isPending}
              className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {createAlertMutation.isPending ? 'Adding…' : 'Add alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
