import { useEffect, useState } from 'react'
import { Bell, Clock, Download, Eye, EyeOff, Upload, Users } from 'lucide-react'
import {
  useAdminChangeUserPassword,
  useAdminDeleteUserProducts,
  useCreateUser,
  useDeleteUser,
  useExportData,
  useImportData,
  useJobs,
  useMe,
  useSaveSettings,
  useSettings,
  useTestEmail,
  useTestTelegram,
  useTestWebhooks,
  useUiSettings,
  useUsers,
} from '../../api/hooks'
import { formatDateTime } from '../../utils/format'
import ConfirmDialog from '../ConfirmDialog'
import { inputCls, labelCls } from '../../utils/styles'
import Section from './Section'
import { downloadJson, exportDateSuffix, formatErrorMessage } from './common'

/** Telegram bot token + notification test tools. Admin only. */
export function NotificationTestsSection({ showToast }: { showToast: (msg: string) => void }) {
  const { data: settings } = useSettings()
  const saveMutation = useSaveSettings()
  const testEmailMutation = useTestEmail()
  const testTelegramMutation = useTestTelegram()
  const testWebhooksMutation = useTestWebhooks()

  const [botTokenInput, setBotTokenInput] = useState('')
  const [showBotToken, setShowBotToken] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testTelegramChatId, setTestTelegramChatId] = useState('')

  // The API never returns the stored token; the input stays empty and a typed
  // value replaces it, '' via the Clear button removes it.
  const saveBotToken = (token: string) => {
    if (!settings) return
    saveMutation.mutate(
      {
        allow_registration: settings.allow_registration,
        date_format: settings.date_format,
        time_format: settings.time_format,
        telegram_bot_token: token,
      },
      {
        onSuccess: () => {
          setBotTokenInput('')
          showToast(token ? 'Telegram bot token saved.' : 'Telegram bot token cleared.')
        },
      }
    )
  }

  return (
    <Section icon={Bell} title="Notification tests" description="Verify email and Telegram alerts are working">
      <div className="space-y-2 pb-2 border-b border-gray-100 dark:border-gray-800">
        <label className={labelCls}>Telegram bot token</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showBotToken ? 'text' : 'password'}
              value={botTokenInput}
              onChange={(e) => setBotTokenInput(e.target.value)}
              placeholder={settings?.telegram_bot_token_set ? '••••••••  (configured — enter new token to replace)' : '123456789:ABCDEFabcdef...'}
              className={`${inputCls} pr-9 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowBotToken((v) => !v)}
              className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              tabIndex={-1}
            >
              {showBotToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => saveBotToken(botTokenInput.trim())}
            disabled={saveMutation.isPending || !botTokenInput.trim()}
            className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          {settings?.telegram_bot_token_set && (
            <button
              type="button"
              onClick={() => saveBotToken('')}
              disabled={saveMutation.isPending}
              className="shrink-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Obtain from <span className="font-mono">@BotFather</span> on Telegram. Overrides the <span className="font-mono">TELEGRAM_BOT_TOKEN</span> env var. The stored token is never shown again.
        </p>
      </div>
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
      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <label className={labelCls}>Webhook channels (ntfy / Gotify / Discord)</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={testWebhooksMutation.isPending}
            onClick={() => testWebhooksMutation.mutate()}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {testWebhooksMutation.isPending ? 'Sending…' : 'Send test to all webhooks'}
          </button>
          {testWebhooksMutation.data && (
            <p className={`text-xs font-medium ${testWebhooksMutation.data.status === 'sent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {testWebhooksMutation.data.message}
            </p>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Configured via <span className="font-mono">NTFY_URL</span>, <span className="font-mono">GOTIFY_URL</span>+<span className="font-mono">GOTIFY_TOKEN</span>, <span className="font-mono">DISCORD_WEBHOOK_URL</span> in <span className="font-mono">.env</span>. Every notification from every user is broadcast to these channels.
        </p>
      </div>
    </Section>
  )
}

/** Live view of APScheduler jobs (per-product checks + maintenance). */
export function SchedulerJobsSection() {
  const { data: jobs = [] } = useJobs()
  const { data: uiSettings } = useUiSettings()

  return (
    <Section icon={Clock} title="Scheduler" description="Upcoming scrape and maintenance runs (refreshes every 30s)">
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No jobs scheduled.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {[...jobs]
            .sort((a, b) => (a.next_run_time ?? '').localeCompare(b.next_run_time ?? ''))
            .map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-mono text-xs text-gray-600 dark:text-gray-300 truncate">{job.id}</span>
                <span className="shrink-0 text-gray-500 dark:text-gray-400">
                  {job.next_run_time ? formatDateTime(job.next_run_time, uiSettings?.date_format) : 'paused'}
                </span>
              </li>
            ))}
        </ul>
      )}
    </Section>
  )
}


export function FullDataSection({ showToast }: { showToast: (msg: string) => void }) {
  const exportDataMutation = useExportData()
  const importDataMutation = useImportData()

  useEffect(() => {
    if (importDataMutation.isSuccess) {
      showToast('Full data imported successfully.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importDataMutation.isSuccess])

  const handleAdminImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      importDataMutation.mutate(JSON.parse(await file.text()), {
        onError: (err: Error) => showToast((err && err.message) || 'Import failed'),
      })
    } catch { showToast('Invalid JSON file') }
    e.target.value = ''
  }

  return (
    <Section icon={Download} title="Full import / export" description="Backup or restore all data across all users">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => exportDataMutation.mutate(undefined, {
            onSuccess: (data) => { downloadJson(data, `caero-export-all-${exportDateSuffix()}.json`); showToast('Export successful.') },
            onError: (err: Error) => showToast((err && err.message) || 'Export failed'),
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
    </Section>
  )
}

export function UserManagementSection({ showToast }: { showToast: (msg: string) => void }) {
  const { data: me } = useMe()
  const { data: settings } = useSettings()
  const { data: users = [] } = useUsers()
  const saveMutation = useSaveSettings()
  const createUserMutation = useCreateUser()
  const deleteUserMutation = useDeleteUser()
  const adminPasswordMutation = useAdminChangeUserPassword()
  const adminDeleteUserProductsMutation = useAdminDeleteUserProducts()

  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserAdmin, setNewUserAdmin] = useState(false)
  const [resetPasswordByUserId, setResetPasswordByUserId] = useState<Record<number, string>>({})
  const [clearUserProductsTarget, setClearUserProductsTarget] = useState<{ id: number; username: string } | null>(null)
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ id: number; username: string } | null>(null)
  const [userDeleteSuccess, setUserDeleteSuccess] = useState<string | null>(null)
  const [userCreateSuccess, setUserCreateSuccess] = useState<string | null>(null)
  const [userPasswordSuccess, setUserPasswordSuccess] = useState<string | null>(null)

  const toggleRegistration = (allow: boolean) => {
    if (!settings) return
    saveMutation.mutate(
      {
        allow_registration: allow,
        date_format: settings.date_format,
        time_format: settings.time_format,
      },
      { onSuccess: () => showToast('Settings saved successfully.') }
    )
  }

  return (
    <>
      <Section icon={Users} title="User management" description="Create users and manage accounts">
        {/* Toggle registration */}
        <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer">
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Allow new registrations</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Let new users create their own accounts</p>
          </div>
          <input
            type="checkbox"
            checked={settings?.allow_registration ?? true}
            onChange={(e) => toggleRegistration(e.target.checked)}
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

      <ConfirmDialog
        open={!!deleteUserTarget}
        title={deleteUserTarget ? `Delete user "${deleteUserTarget.username}"?` : 'Delete user'}
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
        open={!!clearUserProductsTarget}
        title={clearUserProductsTarget ? `Clear products for "${clearUserProductsTarget.username}"?` : 'Clear products'}
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
            onError: (err: Error) => showToast((err && err.message) || 'Clear failed'),
          })
        }}
        onCancel={() => setClearUserProductsTarget(null)}
      />
    </>
  )
}
