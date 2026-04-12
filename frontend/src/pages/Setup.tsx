import { useState, useEffect } from 'react'
import {
  useAdminChangeUserPassword,
  useChangePassword,
  useCreateUser,
  useDeleteUser,
  useExportData,
  useImportData,
  useMe,
  useSettings,
  useSaveSettings,
  useTestDb,
  useUsers,
} from '../api/hooks'
import type { AppSettings } from '../api/types'
import DbSelector from '../components/DbSelector'
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../constants/appInfo'

export default function Setup() {
  const { data: currentSettings, isLoading } = useSettings()
  const { data: me } = useMe()
  const { data: users = [] } = useUsers(!!me?.is_admin)
  const saveMutation = useSaveSettings()
  const testDbMutation = useTestDb()
  const changePasswordMutation = useChangePassword()
  const createUserMutation = useCreateUser()
  const deleteUserMutation = useDeleteUser()
  const adminPasswordMutation = useAdminChangeUserPassword()
  const exportDataMutation = useExportData()
  const importDataMutation = useImportData()

  const [form, setForm] = useState<AppSettings>({
    db_type: 'sqlite',
    sqlite_path: '/data/caero.db',
    pg_host: '',
    pg_port: 5432,
    pg_database: '',
    pg_user: '',
    pg_password: '',
    allow_registration: true,
    date_format: 'DD.MM.YYYY',
    updated_at: null,
  })

  const [saved, setSaved] = useState(false)
  const [switchWarning, setSwitchWarning] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserAdmin, setNewUserAdmin] = useState(false)
  const [resetPasswordByUserId, setResetPasswordByUserId] = useState<Record<number, string>>({})
  const [importError, setImportError] = useState<string | null>(null)

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

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault()
    changePasswordMutation.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('')
          setNewPassword('')
        },
      }
    )
  }

  const handleExport = () => {
    exportDataMutation.mutate(undefined, {
      onSuccess: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'caero-export.json'
        a.click()
        URL.revokeObjectURL(url)
      },
    })
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const parsed = JSON.parse(content)
      setImportError(null)
      importDataMutation.mutate(parsed)
    } catch {
      setImportError('Invalid JSON file')
    }
    e.target.value = ''
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Settings</h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Configure your Caero instance</p>

      <form onSubmit={handleSave} className="space-y-6">
        {/* DB section */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Database</h2>
          <DbSelector value={form} onChange={setForm} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date format</label>
            <select
              value={form.date_format}
              onChange={(e) =>
                setForm({
                  ...form,
                  date_format: e.target.value as AppSettings['date_format'],
                })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
            >
              <option value="DD.MM.YYYY">DD.MM.YYYY (German default)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          {me?.is_admin && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allow_registration"
                checked={form.allow_registration}
                onChange={(e) => setForm({ ...form, allow_registration: e.target.checked })}
                className="rounded text-indigo-600"
              />
              <label htmlFor="allow_registration" className="text-sm text-gray-700 dark:text-gray-300">
                Allow registration of new users
              </label>
            </div>
          )}

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
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
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

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Change password</h2>
            <form onSubmit={handlePasswordChange} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Current password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">New password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={changePasswordMutation.isPending}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Change password
            </button>
          </form>
        </div>

        {me?.is_admin && (
           <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
             <h2 className="font-semibold text-gray-800 dark:text-gray-100">Import / Export</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExport}
                disabled={exportDataMutation.isPending}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Export all data
              </button>
              <label className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                Import all data
                <input
                  type="file"
                  accept="application/json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>
            </div>
            {importError && <p className="text-sm text-red-600">{importError}</p>}
          </div>
        )}

        {me?.is_admin && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">User management (admin)</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createUserMutation.mutate(
                  {
                    username: newUserName,
                    password: newUserPassword,
                    is_admin: newUserAdmin,
                  },
                  {
                    onSuccess: () => {
                      setNewUserName('')
                      setNewUserPassword('')
                      setNewUserAdmin(false)
                    },
                  }
                )
              }}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Username</label>
                <input
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">Password</label>
                <input
                  required
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
                <input
                  type="checkbox"
                  checked={newUserAdmin}
                  onChange={(e) => setNewUserAdmin(e.target.checked)}
                />
                Admin
              </label>
              <button
                type="submit"
                disabled={createUserMutation.isPending}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Add user
              </button>
            </form>

            <ul className="space-y-2">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {user.username} {user.is_admin ? '(admin)' : ''}
                    </span>
                    <button
                      type="button"
                      disabled={user.id === me.id || deleteUserMutation.isPending}
                      onClick={() => deleteUserMutation.mutate(user.id)}
                      className="text-red-600 text-sm disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="New password"
                      value={resetPasswordByUserId[user.id] ?? ''}
                      onChange={(e) =>
                        setResetPasswordByUserId({
                          ...resetPasswordByUserId,
                          [user.id]: e.target.value,
                        })
                      }
                       className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 text-sm flex-1"
                     />
                     <button
                      type="button"
                      disabled={!resetPasswordByUserId[user.id]?.trim()}
                      onClick={() =>
                        adminPasswordMutation.mutate({
                          userId: user.id,
                          body: { new_password: resetPasswordByUserId[user.id] ?? '' },
                        })
                      }
                       className="px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm disabled:opacity-50"
                     >
                      Set password
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-2">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">About</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {APP_NAME} — {APP_TAGLINE}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300">Version: v{APP_VERSION}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Self-hosted app for tracking product price changes.
          </p>
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
