import { useEffect, useState } from 'react'
import { Bell, Check, Download, KeyRound, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
  useChangePassword,
  useCheckAllProducts,
  useDeleteMyProducts,
  useDownloadAllImages,
  useExportMyData,
  useImportMyData,
  useMe,
  useUpdateNotificationDefaults,
} from '../../api/hooks'
import ConfirmDialog from '../ConfirmDialog'
import { inputCls, labelCls } from '../../utils/styles'
import Section from './Section'
import { downloadJson, exportDateSuffix, formatErrorMessage } from './common'

export function ChangePasswordSection({ showToast }: { showToast: (msg: string) => void }) {
  const changePasswordMutation = useChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword.trim().length < 5) {
      setPasswordError('New password must be at least 5 characters.')
      return
    }
    changePasswordMutation.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          showToast('Password updated.')
          setCurrentPassword('')
          setNewPassword('')
        },
      }
    )
  }

  return (
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
  )
}

export function NotificationDefaultsSection({ showToast }: { showToast: (msg: string) => void }) {
  const { data: me } = useMe()
  const updateDefaultsMutation = useUpdateNotificationDefaults()
  // null = untouched → show the server value; a string = user is editing.
  const [emailInput, setEmailInput] = useState<string | null>(null)
  const [telegramInput, setTelegramInput] = useState<string | null>(null)
  const defaultEmail = emailInput ?? me?.default_email ?? ''
  const defaultTelegram = telegramInput ?? me?.default_telegram_chat_id ?? ''

  const handleDefaultsChange = (e: React.FormEvent) => {
    e.preventDefault()
    updateDefaultsMutation.mutate({
      default_email: defaultEmail || null,
      default_telegram_chat_id: defaultTelegram || null,
    }, {
      onSuccess: () => {
        setEmailInput(null)
        setTelegramInput(null)
        showToast('Notification defaults saved.')
      }
    })
  }

  return (
    <Section icon={Bell} title="Notification defaults" description="Pre-fill these values when creating new alerts">
      <form onSubmit={handleDefaultsChange} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Default email</label>
          <input type="email" value={defaultEmail} onChange={(e) => setEmailInput(e.target.value)} placeholder="you@example.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Default Telegram chat ID</label>
          <input type="text" value={defaultTelegram} onChange={(e) => setTelegramInput(e.target.value)} placeholder="123456789" className={inputCls} />
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
  )
}

export function MyDataSection({ showToast }: { showToast: (msg: string) => void }) {
  const exportMyDataMutation = useExportMyData()
  const importMyDataMutation = useImportMyData()
  const checkAllProductsMutation = useCheckAllProducts()
  const downloadAllImagesMutation = useDownloadAllImages()

  useEffect(() => {
    if (importMyDataMutation.isSuccess) {
      showToast('My data imported successfully.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importMyDataMutation.isSuccess])

  useEffect(() => {
    if (checkAllProductsMutation.isSuccess) {
      showToast(checkAllProductsMutation.data?.message ?? 'Check completed.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAllProductsMutation.isSuccess, checkAllProductsMutation.data?.message])

  useEffect(() => {
    if (downloadAllImagesMutation.isSuccess) {
      showToast(downloadAllImagesMutation.data?.message ?? 'Image download started.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadAllImagesMutation.isSuccess, downloadAllImagesMutation.data?.message])

  const handleMyImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      importMyDataMutation.mutate(JSON.parse(await file.text()), {
        onError: (err: Error) => showToast((err && err.message) || 'Import failed'),
      })
    } catch { showToast('Invalid JSON file') }
    e.target.value = ''
  }

  return (
    <Section icon={Download} title="My product data" description="Export or import your tracked products and price history">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => exportMyDataMutation.mutate(undefined, {
            onSuccess: (data) => { downloadJson(data, `caero-export-${exportDateSuffix()}.json`); showToast('Export successful.') },
            onError: (err: Error) => showToast((err && err.message) || 'Export failed'),
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
          onClick={() => downloadAllImagesMutation.mutate()}
          disabled={downloadAllImagesMutation.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          <Download className={`h-3.5 w-3.5 ${downloadAllImagesMutation.isPending ? 'animate-pulse' : ''}`} />
          {downloadAllImagesMutation.isPending ? 'Downloading…' : 'Download missing images'}
        </button>
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
    </Section>
  )
}

export function DangerZoneSection({ showToast }: { showToast: (msg: string) => void }) {
  const deleteMyProductsMutation = useDeleteMyProducts()
  const [showDeleteMyProducts, setShowDeleteMyProducts] = useState(false)

  return (
    <>
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
              onClick={() => setShowDeleteMyProducts(true)}
              disabled={deleteMyProductsMutation.isPending}
              className="shrink-0 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              Delete all
            </button>
          </div>
        </div>
      </div>

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
            onError: (err: Error) => showToast((err && err.message) || 'Delete failed'),
          })
        }}
        onCancel={() => setShowDeleteMyProducts(false)}
      />
    </>
  )
}
