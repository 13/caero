import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateProduct, useSettings } from '../api/hooks'
import { ArrowLeft, Package, Link as LinkIcon, Code, Clock, Image, Tag, FileText, FolderOpen } from 'lucide-react'
import {
  DEFAULT_CHECK_TIME_HHMM,
  CHECK_INTERVAL_HOUR_STEP,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  normalizeCheckTimeHHMM,
  intervalMinutesToHours,
  normalizeIntervalHoursToMinutes,
} from '../utils/format'
import TimePicker from '../components/TimePicker'
import toast from 'react-hot-toast'

const inputCls = 'w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors placeholder:text-gray-400 dark:placeholder:text-gray-600'
//const labelCls = 'text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block uppercase tracking-wide'

function Field({ icon: Icon, label, required, hint, children }: {
  icon: React.ElementType
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {label}
        {required && <span className="text-indigo-500 font-bold">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  )
}

export default function AddProduct() {
  const navigate = useNavigate()
  const createMutation = useCreateProduct()
  const { data: settings } = useSettings()

  const [form, setForm] = useState({
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

  const isIntervalDisabled = form.check_interval_minutes <= 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const autoCheckOnLoad = form.active
    createMutation.mutate(
      {
        ...form,
        category: form.category || null,
        memo: form.memo || null,
        image_url: form.image_url || null,
        check_time_hhmm: normalizeCheckTimeHHMM(form.check_time_hhmm),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      },
      {
        onSuccess: (product) => {
          toast.success('Product added')
          navigate(`/products/${product.id}`, {
            state: autoCheckOnLoad ? { autoCheckOnLoad: true } : null,
          })
        },
      }
    )
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center">
            <Package className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add product</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Start tracking a new price</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {createMutation.error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm">
            {createMutation.error.message}
          </div>
        )}

        {/* Core info card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Product info</p>

          <Field icon={Package} label="Product name" required>
            <input
              required
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sony WH-1000XM5"
              className={inputCls}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field icon={FolderOpen} label="Category">
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Electronics"
                className={inputCls}
              />
            </Field>
            <Field icon={Tag} label="Tags" hint="Comma-separated">
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="audio, sony"
                className={inputCls}
              />
            </Field>
          </div>

          <Field icon={FileText} label="Memo">
            <textarea
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="Optional notes about this product"
              rows={3}
              className={inputCls}
            />
          </Field>

          <Field icon={Image} label="Image URL">
            <input
              type="url"
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              placeholder="https://example.com/image.jpg"
              className={inputCls}
            />
          </Field>

          <Field icon={Clock} label="Check time" hint="Optional — defaults to 10:00">
            <TimePicker
              value={form.check_time_hhmm}
              onChange={(value) => setForm({ ...form, check_time_hhmm: value })}
              format={settings?.time_format ?? '24h'}
              className={inputCls}
            />
          </Field>
        </div>

        {/* Tracking config card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tracking config</p>

          <Field icon={LinkIcon} label="Product URL" required>
            <input
              required
              type="url"
              value={form.url}
              onChange={(e) => {
                const newUrl = e.target.value
                let newSelector = form.selector
                try {
                  const hostname = new URL(newUrl).hostname.toLowerCase()
                  if (hostname.includes('amazon.')) {
                    newSelector = '.a-offscreen, .a-price-whole, .a-price-fraction'
                  } else if (hostname.includes('reichelt.')) {
                    newSelector = '.productPrice'
                  } else if (hostname.includes('zalando.')) {
                    newSelector = '[data-testid="pdp-price-container"] span'
                  }
                } catch {
                  // ignore invalid URL
                }
                setForm({ ...form, url: newUrl, selector: newSelector })
              }}
              placeholder="https://example.com/product"
              className={inputCls}
            />
          </Field>

          <Field
            icon={Code}
            label="CSS selector"
            required
            hint="The CSS selector that points to the price element on the page"
          >
            <input
              required
              type="text"
              value={form.selector}
              onChange={(e) => setForm({ ...form, selector: e.target.value })}
              placeholder=".price, #product-price, [data-price]"
              className={`${inputCls} font-mono`}
            />
          </Field>

          <Field icon={Clock} label="Check interval (hours)" hint="0 or empty disables scheduling">
            <input
              type="number"
              min={0}
              step={CHECK_INTERVAL_HOUR_STEP}
              value={form.check_interval_minutes > 0 ? intervalMinutesToHours(form.check_interval_minutes) : ''}
              onChange={(e) => {
                const rawValue = e.target.value
                const nextMinutes = rawValue === '' ? 0 : normalizeIntervalHoursToMinutes(parseFloat(rawValue))
                setForm({
                  ...form,
                  check_interval_minutes: nextMinutes,
                  active: nextMinutes > 0 ? form.active : false,
                })
              }}
              className={inputCls}
            />
          </Field>

          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Start tracking immediately</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">First price check will run right away</p>
            </div>
            <input
              type="checkbox"
              id="active"
              checked={isIntervalDisabled ? false : form.active}
              disabled={isIntervalDisabled}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 disabled:cursor-not-allowed"
            />
          </label>
        </div>

        {/* Submit */}
        <div className="flex gap-3 pb-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {createMutation.isPending ? 'Adding…' : 'Add product'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
