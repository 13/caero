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
  useCheckAllProducts,
  useSystemInfo,
  useTestDb,
  useTestEmail,
  useTestTelegram,
  useUpdateNotificationDefaults,
  useUsers,
} from '../api/hooks'
import type { AppSettings } from '../api/types'
import CaeroBrand from '../components/CaeroBrand'
import ConfirmDialog from '../components/ConfirmDialog'
import DbSelector from '../components/DbSelector'
import { APP_DESCRIPTION, APP_VERSION } from '../constants/appInfo'
import {
  User, KeyRound, Download, Upload, Trash2, RefreshCw,
  Shield, Database, Bell, Users, Check, Info
} from 'lucide-react'

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportDateSuffix() {
  return new Date().toISOString().slice(0, 10)
}

// Reusable section card
function Section({ icon: Icon, title, description, children }: {
  icon: React.ElementType
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{title}</h2>
          {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'

const formatErrorMessage = (error: unknown): string | null => {
  if (!error) return null
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    if (typeof error.message === 'string') return error.message
    if (error.message && typeof error.message === 'object') {
      try {
        return JSON.stringify(error.message)
      } catch {
        return 'Request failed.'
      }
    }
    if (error.message) return String(error.message)
  }
  if (typeof error === 'object' && error !== null) {
    const responseMessage = (error as { response?: { data?: { message?: unknown; detail?: unknown } } }).response?.data
    const message = (error as { message?: unknown; detail?: unknown }).message
      ?? (error as { detail?: unknown }).detail
      ?? responseMessage?.message
      ?? responseMessage?.detail
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.map((item) => String(item)).join(', ')
    if (message && typeof message === 'object') {
      try {
        return JSON.stringify(message)
      } catch {
        return 'Request failed.'
      }
    }
  }
  return 'Request failed.'
}

type Tab = 'account' | 'admin'

export default function Setup() {
  const { data: currentSettings, isLoading } = useSettings()
  const { data: systemInfo } = useSystemInfo()
  const { data: me } = useMe()
  const { data: users = [] } = useUsers(!!me?.is_admin)

  const saveMutation = useSaveSettings()
  const testDbMutation = useTestDb()
  const testEmailMutation = useTestEmail()
  const testTelegramMutation = useTestTelegram()
  const changePasswordMutation = useChangePassword()
  const createUserMutation = useCreateUser()
  const deleteUserMutation = useDeleteUser()
  const adminPasswordMutation = useAdminChangeUserPassword()
  const updateDefaultsMutation = useUpdateNotificationDefaults()
  const exportDataMutation = useExportData()
  const importDataMutation = useImportData()
  const exportMyDataMutation = useExportMyData()
  const importMyDataMutation = useImportMyData()
  const deleteMyProductsMutation = useDeleteMyProducts()
  const adminDeleteUserProductsMutation = useAdminDeleteUserProducts()
  const checkAllProductsMutation = useCheckAllProducts()

  const [activeTab, setActiveTab] = useState<Tab>('account')
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
    time_format: '24h',
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
  const [testEmail, setTestEmail] = useState('')
  const [testTelegramChatId, setTestTelegramChatId] = useState('')

  const [defaultEmail, setDefaultEmail] = useState('')
  const [defaultTelegram, setDefaultTelegram] = useState('')

  const [hideHeader, setHideHeader] = useState(() => localStorage.getItem('caero_hide_header') === 'true')
  const [hideStats, setHideStats] = useState(() => localStorage.getItem('caero_hide_stats') === 'true')

  const [toastMsg, setToastMsg] = useState('')
  const [showDeleteMyProducts, setShowDeleteMyProducts] = useState(false)
  const [clearUserProductsTarget, setClearUserProductsTarget] = useState<{ id: number; username: string } | null>(null)
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ id: number; username: string } | null>(null)
  const [userDeleteSuccess, setUserDeleteSuccess] = useState<string | null>(null)
  const [userCreateSuccess, setUserCreateSuccess] = useState<string | null>(null)
  const [userPasswordSuccess, setUserPasswordSuccess] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  useEffect(() => {
    if (currentSettings) setForm(currentSettings)
  }, [currentSettings])

  useEffect(() => {
    if (me) {
      setDefaultEmail(me.default_email ?? '')
      setDefaultTelegram(me.default_telegram_chat_id ?? '')
    }
  }, [me])

  useEffect(() => {
    if (importMyDataMutation.isSuccess) {
      showToast('My data imported successfully.')
    }
  }, [importMyDataMutation.isSuccess])

  useEffect(() => {
    if (checkAllProductsMutation.isSuccess) {
      showToast(checkAllProductsMutation.data?.message ?? 'Check completed.')
    }
  }, [checkAllProductsMutation.isSuccess, checkAllProductsMutation.data?.message])

  useEffect(() => {
    if (importDataMutation.isSuccess) {
      showToast('Full data imported successfully.')
    }
  }, [importDataMutation.isSuccess])

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
        showToast('Settings saved successfully.')
        setTimeout(() => setSaved(false), 3000)
      },
    })
  }

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword.trim().length < 5) {
      setPasswordError('New password must be at least 5 characters.')
      return
    }
    changePasswordMutation.mutate(
      { current_password: currentPassword, new_password: newPassword },
      { onSuccess: () => {
          showToast('Password updated.')
          setCurrentPassword('')
          setNewPassword('')
        }
      }
    )
  }

  const handleDefaultsChange = (e: React.FormEvent) => {
    e.preventDefault()
    updateDefaultsMutation.mutate({
      default_email: defaultEmail || null,
      default_telegram_chat_id: defaultTelegram || null,
    }, {
      onSuccess: () => {
        showToast('Notification defaults saved.')
      }
    })
  }

  const handleAdminImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      importDataMutation.mutate(JSON.parse(await file.text()))
      setAdminImportError(null)
    } catch { setAdminImportError('Invalid JSON file') }
    e.target.value = ''
  }

  const handleMyImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      importMyDataMutation.mutate(JSON.parse(await file.text()))
      setMyImportError(null)
    } catch { setMyImportError('Invalid JSON file') }
    e.target.value = ''
  }

  const handleDeleteMyProducts = () => {
    setShowDeleteMyProducts(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'account', label: 'Account', icon: User },
    ...(me?.is_admin ? [{ key: 'admin' as Tab, label: 'Admin', icon: Shield }] : []),
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        {me?.username && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Signed in as <span className="font-medium text-gray-700 dark:text-gray-300">{me.username}</span>
            {me.is_admin && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">Admin</span>
            )}
          </p>
        )}
      </div>

      {/* Tab bar */}
      {me?.is_admin && (
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === key
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Account tab ── */}
      {activeTab === 'account' && (
        <div className="space-y-4">

           {/* Preferences */}
           <Section icon={User} title="Preferences" description="Customize your experience">
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date format</label>
                 <select
                   value={form.date_format}
                   onChange={(e) => {
                     const nextForm = { ...form, date_format: e.target.value as AppSettings['date_format'] }
                     setForm(nextForm)
                     saveSettings(nextForm)
                   }}
                   style={{ colorScheme: 'light dark' }}
                   className={inputCls}
                 >
                   <option value="DD.MM.YYYY">DD.MM.YYYY</option>
                   <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                   <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                   <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                 </select>
               </div>

               <div>
                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Time format</label>
                 <select
                   value={form.time_format}
                   onChange={(e) => {
                     const nextForm = { ...form, time_format: e.target.value as AppSettings['time_format'] }
                     setForm(nextForm)
                     saveSettings(nextForm)
                   }}
                   style={{ colorScheme: 'light dark' }}
                   className={inputCls}
                 >
                   <option value="24h">24-hour (HH:MM)</option>
                   <option value="12h">12-hour (HH:MM AM/PM)</option>
                 </select>
               </div>

               <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                 <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Dashboard visibility</p>
                 <label className="flex items-center gap-3 cursor-pointer">
                   <input
                     type="checkbox"
                     checked={hideStats}
                     onChange={(e) => {
                       setHideStats(e.target.checked)
                       localStorage.setItem('caero_hide_stats', e.target.checked ? 'true' : 'false')
                     }}
                     className="rounded text-indigo-600 h-4 w-4"
                   />
                   <span className="text-sm text-gray-800 dark:text-gray-200">Hide total tracked stats (active, price drops)</span>
                 </label>
                 <label className="flex items-center gap-3 cursor-pointer">
                   <input
                     type="checkbox"
                     checked={hideHeader}
                     onChange={(e) => {
                       setHideHeader(e.target.checked)
                       localStorage.setItem('caero_hide_header', e.target.checked ? 'true' : 'false')
                     }}
                     className="rounded text-indigo-600 h-4 w-4"
                   />
                   <span className="text-sm text-gray-800 dark:text-gray-200">Hide header on products list</span>
                 </label>
               </div>
             </div>
           </Section>

          {/* Change password */}
          <Section icon={KeyRound} title="Change password" description="Update your login credentials">
            <form onSubmit={handlePasswordChange} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Current password</label>
                <input type="password" required minLength={5} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>New password</label>
                <input type="password" required minLength={5} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={changePasswordMutation.isPending} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {changePasswordMutation.isPending ? 'Updating…' : 'Update password'}
                </button>
                {changePasswordMutation.isSuccess && (
                  <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
                    <Check className="h-4 w-4" /> Updated
                  </span>
                )}
                {(passwordError ?? formatErrorMessage(changePasswordMutation.error)) && (
                  <span className="text-sm text-red-600 font-medium">
                    {passwordError ?? formatErrorMessage(changePasswordMutation.error)}
                  </span>
                )}
              </div>
            </form>
          </Section>

          {/* Notification defaults */}
          <Section icon={Bell} title="Notification defaults" description="Pre-fill these values when creating new alerts">
            <form onSubmit={handleDefaultsChange} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Default email</label>
                <input type="email" value={defaultEmail} onChange={(e) => setDefaultEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Default Telegram chat ID</label>
                <input type="text" value={defaultTelegram} onChange={(e) => setDefaultTelegram(e.target.value)} placeholder="123456789" className={inputCls} />
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={updateDefaultsMutation.isPending} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {updateDefaultsMutation.isPending ? 'Saving…' : 'Save defaults'}
                </button>
                {updateDefaultsMutation.isSuccess && (
                  <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
                    <Check className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </form>
          </Section>

          {/* My data */}
          <Section icon={Download} title="My product data" description="Export or import your tracked products and price history">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportMyDataMutation.mutate(undefined, {
                  onSuccess: (data) => downloadJson(data, `caero-my-products-export-${exportDateSuffix()}.json`),
                })}
                disabled={exportMyDataMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {exportMyDataMutation.isPending ? 'Exporting…' : 'Export my data'}
              </button>
              <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Import my data
                <input type="file" accept="application/json" onChange={handleMyImportFile} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => checkAllProductsMutation.mutate()}
                disabled={checkAllProductsMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checkAllProductsMutation.isPending ? 'animate-spin' : ''}`} />
                {checkAllProductsMutation.isPending ? 'Checking…' : 'Check all prices'}
              </button>
            </div>
            {myImportError && <p className="text-sm text-red-600 dark:text-red-400">{myImportError}</p>}
            {importMyDataMutation.isSuccess && (
              <p className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
                <Check className="h-4 w-4" /> Import successful
              </p>
            )}
            {checkAllProductsMutation.isSuccess && (
              <p className="inline-flex items-center gap-1 text-sm text-green-600 font-medium mt-2">
                <Check className="h-4 w-4" /> {checkAllProductsMutation.data?.message}
              </p>
            )}
          </Section>

          {/* Danger zone */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-red-200 dark:border-red-900/40 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-red-100 dark:border-red-900/30">
              <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950 flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="font-semibold text-red-700 dark:text-red-300 text-sm">Danger zone</h2>
                <p className="text-xs text-red-500 dark:text-red-400/70 mt-0.5">These actions are permanent and cannot be undone</p>
              </div>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Delete all my products</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Removes all your products, alerts, and price history</p>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteMyProducts}
                  disabled={deleteMyProductsMutation.isPending}
                  className="shrink-0 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  Delete all
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Admin tab ── */}
      {activeTab === 'admin' && me?.is_admin && (
        <div className="space-y-4">

          {/* System config */}
          <Section icon={Database} title="System configuration" description="Database engine">
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <DbSelector value={form} onChange={setForm} />

              {switchWarning && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200">
                  <p className="font-semibold mb-1">⚠️ Switching database engine</p>
                  <p className="text-amber-700 dark:text-amber-300">Switching databases will not migrate existing data. Export your data first.</p>
                  <div className="flex gap-2 mt-3">
                    <button type="button" onClick={() => saveSettings()} className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700">Switch anyway</button>
                    <button type="button" onClick={() => setSwitchWarning(false)} className="px-3 py-1.5 rounded-lg border border-amber-300 text-sm text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40">Cancel</button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => testDbMutation.mutate({
                    db_type: form.db_type, sqlite_path: form.sqlite_path,
                    pg_host: form.pg_host, pg_port: form.pg_port,
                    pg_database: form.pg_database, pg_user: form.pg_user, pg_password: form.pg_password,
                  })}
                  disabled={testDbMutation.isPending}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {testDbMutation.isPending ? 'Testing…' : 'Test connection'}
                </button>
                {testDbMutation.data && (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    testDbMutation.data.status === 'connected'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  }`}>
                    {testDbMutation.data.status === 'connected' ? '✓ Connected' : '✗ Error'}
                  </span>
                )}
                <button type="submit" disabled={saveMutation.isPending} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {saveMutation.isPending ? 'Saving…' : 'Save settings'}
                </button>
                {saved && (
                  <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400 font-medium">
                    <Check className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </form>
          </Section>

          {/* Notification tests */}
          <Section icon={Bell} title="Notification tests" description="Verify email and Telegram alerts are working">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={labelCls}>Test email recipient</label>
                <div className="flex gap-2">
                  <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
                  <button
                    type="button"
                    disabled={testEmailMutation.isPending || !testEmail.trim()}
                    onClick={() => testEmailMutation.mutate({ email: testEmail.trim() })}
                    className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {testEmailMutation.isPending ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                {testEmailMutation.data && (
                  <p className={`text-xs font-medium ${testEmailMutation.data.status === 'sent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {testEmailMutation.data.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className={labelCls}>Test Telegram chat ID</label>
                <div className="flex gap-2">
                  <input type="text" value={testTelegramChatId} onChange={(e) => setTestTelegramChatId(e.target.value)} placeholder="123456789" className={inputCls} />
                  <button
                    type="button"
                    disabled={testTelegramMutation.isPending || !testTelegramChatId.trim()}
                    onClick={() => testTelegramMutation.mutate({ chat_id: testTelegramChatId.trim() })}
                    className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {testTelegramMutation.isPending ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                {testTelegramMutation.data && (
                  <p className={`text-xs font-medium ${testTelegramMutation.data.status === 'sent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {testTelegramMutation.data.message}
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* Full import / export */}
          <Section icon={Download} title="Full import / export" description="Backup or restore all data across all users">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportDataMutation.mutate(undefined, {
                  onSuccess: (data) => downloadJson(data, `caero-export-all-${exportDateSuffix()}.json`),
                })}
                disabled={exportDataMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {exportDataMutation.isPending ? 'Exporting…' : 'Export all data'}
              </button>
              <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Import all data
                <input type="file" accept="application/json" onChange={handleAdminImportFile} className="hidden" />
              </label>
            </div>
            {adminImportError && <p className="text-sm text-red-600 dark:text-red-400">{adminImportError}</p>}
            {importDataMutation.isSuccess && (
              <p className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400 font-medium">
                <Check className="h-4 w-4" /> Import successful
              </p>
            )}
          </Section>

          {/* User management */}
          <Section icon={Users} title="User management" description="Create users and manage accounts">
            {/* Toggle registration */}
            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Allow new registrations</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Let new users create their own accounts</p>
              </div>
              <input
                type="checkbox"
                checked={form.allow_registration}
                onChange={(e) => {
                  const nextForm = { ...form, allow_registration: e.target.checked }
                  setForm(nextForm)
                  saveSettings(nextForm)
                }}
                className="rounded text-indigo-600 h-4 w-4"
              />
            </label>

            {/* Add user form */}
            <div className="pt-1">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Add user</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setUserCreateSuccess(null)
                  createUserMutation.mutate(
                    { username: newUserName, password: newUserPassword, is_admin: newUserAdmin },
                    {
                      onSuccess: () => {
                        setNewUserName('')
                        setNewUserPassword('')
                        setNewUserAdmin(false)
                          showToast('User created.')
                        setUserCreateSuccess('User created.')
                      },
                    }
                  )
                }}
                className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
              >
                <div>
                  <label className={labelCls}>Username</label>
                  <input required value={newUserName} onChange={(e) => setNewUserName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Password</label>
                  <input required type="password" minLength={5} value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} className={inputCls} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer pb-0.5">
                  <input type="checkbox" checked={newUserAdmin} onChange={(e) => setNewUserAdmin(e.target.checked)} className="rounded text-indigo-600" />
                  Admin
                </label>
                <button type="submit" disabled={createUserMutation.isPending} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {createUserMutation.isPending ? 'Adding…' : 'Add user'}
                </button>
              </form>
              {formatErrorMessage(createUserMutation.error) && (
                <p className="text-xs text-red-600 dark:text-red-400">{formatErrorMessage(createUserMutation.error)}</p>
              )}
              {userCreateSuccess && (
                <p className="text-xs text-green-600 dark:text-green-400">{userCreateSuccess}</p>
              )}
            </div>

            {/* User list */}
            {users.length > 0 && (
              <ul className="space-y-2 pt-1">
                {users.map((user) => (
                  <li key={user.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                          {user.username[0].toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{user.username}</span>
                        {user.is_admin && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">Admin</span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={adminDeleteUserProductsMutation.isPending}
                          onClick={() => setClearUserProductsTarget({ id: user.id, username: user.username })}
                          className="text-xs px-2.5 py-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-50 transition-colors"
                        >
                          Clear products
                        </button>
                        <button
                          type="button"
                          disabled={user.id === me?.id || deleteUserMutation.isPending}
                          onClick={() => {
                            setUserDeleteSuccess(null)
                            setDeleteUserTarget({ id: user.id, username: user.username })
                          }}
                          className="text-xs px-2.5 py-1 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPasswordByUserId[user.id] ?? ''}
                        onChange={(e) => setResetPasswordByUserId({ ...resetPasswordByUserId, [user.id]: e.target.value })}
                        minLength={5}
                        className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        disabled={(resetPasswordByUserId[user.id] ?? '').trim().length < 5}
                        onClick={() => {
                          setUserPasswordSuccess(null)
                          adminPasswordMutation.mutate({
                            userId: user.id,
                            body: { new_password: resetPasswordByUserId[user.id] ?? '' },
                          }, {
                            onSuccess: () => {
                              showToast(`Password updated for ${user.username}.`)
                              setUserPasswordSuccess(`Password updated for ${user.username}.`)
                            },
                          })
                        }}
                        className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                      >
                        Set password
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {formatErrorMessage(adminPasswordMutation.error) && (
              <p className="text-xs text-red-600 dark:text-red-400">{formatErrorMessage(adminPasswordMutation.error)}</p>
            )}
            {formatErrorMessage(deleteUserMutation.error) && (
              <p className="text-xs text-red-600 dark:text-red-400">{formatErrorMessage(deleteUserMutation.error)}</p>
            )}
            {userPasswordSuccess && (
              <p className="text-xs text-green-600 dark:text-green-400">{userPasswordSuccess}</p>
            )}
            {userDeleteSuccess && (
              <p className="text-xs text-green-600 dark:text-green-400">{userDeleteSuccess}</p>
            )}
          </Section>

        </div>
      )}

      {/* About — Move to Account Tab only according to request */}
      {activeTab === 'account' && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 mt-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Info className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">About</h2>
          </div>
          <div className="flex flex-col items-center gap-3 py-2">
            <CaeroBrand showText={false} logoAriaHidden={false} logoSizeClassName="h-16 w-16" className="justify-center mb-1" />
            <p className="text-sm text-gray-600 dark:text-gray-300 text-center mb-2">{APP_DESCRIPTION}</p>

            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl text-gray-700 dark:text-gray-200">
              <div className="text-right font-medium text-gray-500 hover:text-gray-700">Frontend Version:</div>
              <div className="font-mono">{APP_VERSION}</div>

              <div className="text-right font-medium text-gray-500 hover:text-gray-700">Backend Version:</div>
              <div className="font-mono">{systemInfo?.version || '...'}</div>

              <div className="text-right font-medium text-gray-500 hover:text-gray-700">Active Database:</div>
              <div className="font-mono">{systemInfo?.db_type || '...'}</div>

              <div className="text-right font-medium text-gray-500 hover:text-gray-700">DB Version:</div>
              <div className="font-mono">{systemInfo?.db_version || '...'}</div>

              <div className="text-right font-medium text-gray-500 hover:text-gray-700">Scraper Backend:</div>
              <div className="font-mono">{systemInfo?.scraper_backend || '...'}</div>

              <div className="text-right font-medium text-gray-500 hover:text-gray-700">Headless Mode:</div>
              <div className="font-mono">{systemInfo?.scraper_headless === false ? 'No' : 'Yes'}</div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteUserTarget}
        title={deleteUserTarget ? `Delete user \"${deleteUserTarget.username}\"?` : 'Delete user'}
        message="This will delete the user account. This action cannot be undone."
        confirmLabel="Delete user"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={() => {
          if (!deleteUserTarget) return
          const userId = deleteUserTarget.id
          const username = deleteUserTarget.username
          setDeleteUserTarget(null)
          deleteUserMutation.mutate(userId, {
            onSuccess: () => setUserDeleteSuccess(`Deleted ${username}.`),
          })
        }}
        onCancel={() => setDeleteUserTarget(null)}
      />

      <ConfirmDialog
        open={showDeleteMyProducts}
        title="Delete all your products?"
        message="This will remove all your products, alerts, price history, and cached images. This cannot be undone."
        confirmLabel="Delete all"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={() => {
          setShowDeleteMyProducts(false)
          deleteMyProductsMutation.mutate(undefined, {
            onSuccess: () => showToast('Deleted all your products.'),
            onError: (err: any) => showToast((err && err.message) || 'Delete failed'),
          })
        }}
        onCancel={() => setShowDeleteMyProducts(false)}
      />

      <ConfirmDialog
        open={!!clearUserProductsTarget}
        title={clearUserProductsTarget ? `Clear products for \"${clearUserProductsTarget.username}\"?` : 'Clear products'}
        message="This removes the user's products, alerts, price history, and cached images. This cannot be undone."
        confirmLabel="Clear products"
        cancelLabel="Cancel"
        isDestructive
        onConfirm={() => {
          if (!clearUserProductsTarget) return
          const userId = clearUserProductsTarget.id
          setClearUserProductsTarget(null)
          adminDeleteUserProductsMutation.mutate(userId, {
            onSuccess: (data) => showToast(data?.message ?? 'Cleared products.'),
            onError: (err: any) => showToast((err && err.message) || 'Clear failed'),
          })
        }}
        onCancel={() => setClearUserProductsTarget(null)}
      />

      {/* Global Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white dark:bg-white dark:text-gray-900 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-400 dark:text-green-600" />
          {toastMsg}
        </div>
      )}

    </div>
  )
}
