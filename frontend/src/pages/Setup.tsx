import { useState, useEffect } from 'react'
import { useSettings, useSaveSettings, useTestDb } from '../api/hooks'
import type { AppSettings } from '../api/types'
import DbSelector from '../components/DbSelector'

export default function Setup() {
  const { data: currentSettings, isLoading } = useSettings()
  const saveMutation = useSaveSettings()
  const testDbMutation = useTestDb()

  const [form, setForm] = useState<AppSettings>({
    db_type: 'sqlite',
    sqlite_path: '/data/caero.db',
    pg_host: '',
    pg_port: 5432,
    pg_database: '',
    pg_user: '',
    pg_password: '',
    updated_at: null,
  })

  const [saved, setSaved] = useState(false)
  const [switchWarning, setSwitchWarning] = useState(false)

  useEffect(() => {
    if (currentSettings) {
      setForm(currentSettings)
    }
  }, [currentSettings])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (currentSettings && form.db_type !== currentSettings.db_type) {
      setSwitchWarning(true)
      return
    }
    doSave()
  }

  const doSave = () => {
    setSwitchWarning(false)
    saveMutation.mutate(form, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      },
    })
  }

  const handleTest = () => {
    testDbMutation.mutate({
      db_type: form.db_type,
      sqlite_path: form.sqlite_path,
      pg_host: form.pg_host,
      pg_port: form.pg_port,
      pg_database: form.pg_database,
      pg_user: form.pg_user,
      pg_password: form.pg_password,
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
      <p className="text-gray-500 text-sm mb-6">Configure your Caero instance</p>

      <form onSubmit={handleSave} className="space-y-6">
        {/* DB section */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Database</h2>
          <DbSelector value={form} onChange={setForm} />

          {/* Switch warning */}
          {switchWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              <p className="font-medium mb-2">⚠️ Switching database engine</p>
              <p>
                Switching databases will not migrate existing data. Export your data first.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={doSave}
                  className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700"
                >
                  Switch anyway
                </button>
                <button
                  type="button"
                  onClick={() => setSwitchWarning(false)}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 text-sm text-amber-800 hover:bg-amber-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testDbMutation.isPending}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {testDbMutation.isPending ? 'Testing…' : 'Test connection'}
            </button>
            {testDbMutation.data && (
              <span
                className={`text-sm px-2.5 py-0.5 rounded-full font-medium ${
                  testDbMutation.data.status === 'connected'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {testDbMutation.data.status === 'connected' ? '✓ Connected' : '✗ Error'}
              </span>
            )}
            {testDbMutation.data?.status === 'error' && (
              <span className="text-xs text-red-600">{testDbMutation.data.message}</span>
            )}
          </div>
        </div>

        {/* Save */}
        {saveMutation.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {saveMutation.error.message}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">✓ Saved</span>
          )}
        </div>
      </form>
    </div>
  )
}
