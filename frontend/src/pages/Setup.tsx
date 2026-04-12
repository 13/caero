import { useEffect, useState } from 'react'
import {
  useAdminChangeUserPassword,
  useAdminDeleteUserProducts,
  useChangePassword,
  useCreateUser,
  useDeleteMyProducts,
  useDeleteUser,
  useExportData,
  useExportMyData,
  useImportData,
  useImportMyData,
  useMe,
  useSettings,
  useSaveSettings,
  useTestDb,
  useUsers,
} from '../api/hooks'
import type { AppSettings } from '../api/types'
import CaeroBrand from '../components/CaeroBrand'
import DbSelector from '../components/DbSelector'
import { APP_DESCRIPTION, APP_VERSION } from '../constants/appInfo'

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

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
  const exportMyDataMutation = useExportMyData()
  const importMyDataMutation = useImportMyData()
  const deleteMyProductsMutation = useDeleteMyProducts()
  const adminDeleteUserProductsMutation = useAdminDeleteUserProducts()

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
  const [adminImportError, setAdminImportError] = useState<string | null>(null)
  const [myImportError, setMyImportError] = useState<string | null>(null)

  useEffect(() => {
    if (currentSettings) {
      setForm(currentSettings)
    }
  }, [currentSettings])

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault()
    if (currentSettings && form.db_type !== currentSettings.db_type) {
      setSwitchWarning(true)
      return
    }
    saveSettings()
  }

  const saveSettings = (settingsToSave: AppSettings = form) => {
    setSwitchWarning(false)
    saveMutation.mutate(settingsToSave, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      },
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

  const handleAdminImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      importDataMutation.mutate(JSON.parse(content))
      setAdminImportError(null)
    } catch {
      setAdminImportError('Invalid JSON file')
    }
    e.target.value = ''
  }

  const handleMyImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      importMyDataMutation.mutate(JSON.parse(content))
      setMyImportError(null)
    } catch {
      setMyImportError('Invalid JSON file')
    }
    e.target.value = ''
  }

  const handleDeleteMyProducts = () => {
    if (confirm('Delete all your products, alerts, and price history? This cannot be undone.')) {
      deleteMyProductsMutation.mutate()
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">User</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Account and personal product data management.
        </p>

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

        <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
          <h3 className="font-medium text-gray-800 dark:text-gray-100">My product data import / export</h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                exportMyDataMutation.mutate(undefined, {
                  onSuccess: (data) => downloadJson(data, 'caero-my-products-export.json'),
                })
              }
              disabled={exportMyDataMutation.isPending}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Export my product data
            </button>
            <label className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              Import my product data
              <input type="file" accept="application/json" onChange={handleMyImportFile} className="hidden" />
            </label>
          </div>
          {myImportError && <p className="text-sm text-red-600">{myImportError}</p>}
        </div>

        <div className="pt-3 border-t border-red-200 dark:border-red-900/30 space-y-2">
          <h3 className="font-medium text-red-700 dark:text-red-300">Danger zone</h3>
          <button
            type="button"
            onClick={handleDeleteMyProducts}
            disabled={deleteMyProductsMutation.isPending}
            className="px-4 py-2 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 text-sm font-medium disabled:opacity-50"
          >
            Delete all my products
          </button>
        </div>
      </div>

      {me?.is_admin && (
        <>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Admin — System configuration</h2>
            <form onSubmit={handleSaveSettings} className="space-y-4">
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
                  style={{ colorScheme: 'light dark' }}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
                >
                  <option value="DD.MM.YYYY">DD.MM.YYYY (German default)</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>

              {switchWarning && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                  <p className="font-medium mb-2">⚠️ Switching database engine</p>
                  <p>Switching databases will not migrate existing data. Export your data first.</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => saveSettings()}
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

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() =>
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
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save settings'}
                </button>
                {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
              </div>
            </form>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Admin — Full import / export</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  exportDataMutation.mutate(undefined, {
                    onSuccess: (data) => downloadJson(data, 'caero-export-all.json'),
                  })
                }
                disabled={exportDataMutation.isPending}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Export all data
              </button>
              <label className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                Import all data
                <input type="file" accept="application/json" onChange={handleAdminImportFile} className="hidden" />
              </label>
            </div>
            {adminImportError && <p className="text-sm text-red-600">{adminImportError}</p>}
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Admin — User management</h2>
            <div className="pt-1 pb-3 border-b border-gray-200 dark:border-gray-800">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  id="allow_registration"
                  checked={form.allow_registration}
                  onChange={(e) => {
                    const nextForm = { ...form, allow_registration: e.target.checked }
                    setForm(nextForm)
                    saveSettings(nextForm)
                  }}
                  className="rounded text-indigo-600"
                />
                Allow registration of new users
              </label>
            </div>
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
                <input type="checkbox" checked={newUserAdmin} onChange={(e) => setNewUserAdmin(e.target.checked)} />
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
                  className="border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-3 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {user.username} {user.is_admin ? '(admin)' : ''}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={adminDeleteUserProductsMutation.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete all products, alerts, and price history for user "${user.username}"?`
                            )
                          ) {
                            adminDeleteUserProductsMutation.mutate(user.id)
                          }
                        }}
                        className="text-amber-700 dark:text-amber-300 text-sm disabled:opacity-50"
                      >
                        Delete all products
                      </button>
                      <button
                        type="button"
                        disabled={user.id === me?.id || deleteUserMutation.isPending}
                        onClick={() => deleteUserMutation.mutate(user.id)}
                        className="text-red-600 text-sm disabled:opacity-50"
                      >
                        Delete user
                      </button>
                    </div>
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
        </>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-2">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">About</h2>
        <CaeroBrand
          showText={false}
          logoAriaHidden={false}
          logoSizeClassName="h-20 w-20"
          className="w-full justify-center"
        />
        <p className="text-sm text-gray-600 dark:text-gray-300 text-center">{APP_DESCRIPTION}</p>
        <p className="text-sm text-gray-600 dark:text-gray-300 text-center">Version: v{APP_VERSION}</p>
      </div>

      {(saveMutation.error || changePasswordMutation.error || importDataMutation.error || importMyDataMutation.error) && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {saveMutation.error?.message ||
            changePasswordMutation.error?.message ||
            importDataMutation.error?.message ||
            importMyDataMutation.error?.message}
        </div>
      )}
    </div>
  )
}
