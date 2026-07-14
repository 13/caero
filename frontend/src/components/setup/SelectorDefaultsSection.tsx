import { useState } from 'react'
import { Check, Code, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  useCreateSelectorDefault,
  useDeleteSelectorDefault,
  useSelectorDefaults,
  useUpdateSelectorDefault,
} from '../../api/hooks'
import type { SelectorDefault } from '../../api/types'
import { inputCls, labelCls } from '../../utils/styles'
import Section from './Section'
import { formatErrorMessage } from './common'

export default function SelectorDefaultsSection({ showToast, isAdmin }: { showToast: (msg: string) => void; isAdmin: boolean }) {
  const { data: selectors = [] } = useSelectorDefaults()
  const createMutation = useCreateSelectorDefault()
  const updateMutation = useUpdateSelectorDefault()
  const deleteMutation = useDeleteSelectorDefault()

  const [newDomain, setNewDomain] = useState('')
  const [newSelector, setNewSelector] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editDomain, setEditDomain] = useState('')
  const [editSelector, setEditSelector] = useState('')
  const [error, setError] = useState<string | null>(null)

  const startEdit = (s: SelectorDefault) => {
    setEditId(s.id)
    setEditDomain(s.domain)
    setEditSelector(s.selector)
    setError(null)
  }
  const cancelEdit = () => {
    setEditId(null)
    setEditDomain('')
    setEditSelector('')
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    createMutation.mutate(
      { domain: newDomain.trim(), selector: newSelector.trim() },
      {
        onSuccess: () => {
          setNewDomain('')
          setNewSelector('')
          showToast('Selector added.')
        },
        onError: (err) => setError(formatErrorMessage(err)),
      }
    )
  }

  const handleSaveEdit = () => {
    if (editId == null) return
    setError(null)
    updateMutation.mutate(
      { id: editId, body: { domain: editDomain.trim(), selector: editSelector.trim() } },
      {
        onSuccess: () => {
          cancelEdit()
          showToast('Selector updated.')
        },
        onError: (err) => setError(formatErrorMessage(err)),
      }
    )
  }

  return (
    <Section
      icon={Code}
      title="Default price selectors"
      description="Auto-fill the CSS selector when adding a product, matched by site"
    >
      {/* Existing entries */}
      {selectors.length > 0 ? (
        <ul className="space-y-2">
          {selectors.map((s) => (
            <li key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3">
              {isAdmin && editId === s.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      value={editDomain}
                      onChange={(e) => setEditDomain(e.target.value)}
                      placeholder="amazon."
                      className={inputCls}
                    />
                    <input
                      value={editSelector}
                      onChange={(e) => setEditSelector(e.target.value)}
                      placeholder=".price"
                      className={`${inputCls} sm:col-span-2 font-mono`}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={updateMutation.isPending || !editDomain.trim() || !editSelector.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" /> Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.domain}</p>
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">{s.selector}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        className="text-xs px-2.5 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors inline-flex items-center gap-1"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() =>
                          deleteMutation.mutate(s.id, {
                            onSuccess: () => showToast('Selector deleted.'),
                            onError: (err) => setError(formatErrorMessage(err)),
                          })
                        }
                        className="text-xs px-2.5 py-1 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 transition-colors inline-flex items-center gap-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">No default selectors configured yet.</p>
      )}

      {/* Add new — admin only */}
      {isAdmin && (
        <form onSubmit={handleAdd} className="pt-1 space-y-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Add selector</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Domain match</label>
              <input
                required
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="amazon."
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>CSS selector</label>
              <input
                required
                value={newSelector}
                onChange={(e) => setNewSelector(e.target.value)}
                placeholder="#corePrice_feature_div .a-offscreen"
                className={`${inputCls} font-mono`}
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Domain is matched as a substring of the product URL's hostname — e.g. <span className="font-mono">amazon.</span> matches amazon.it and amazon.de. The most specific match wins.
          </p>
          <button
            type="submit"
            disabled={createMutation.isPending || !newDomain.trim() || !newSelector.trim()}
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? 'Adding…' : 'Add selector'}
          </button>
        </form>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </Section>
  )
}
