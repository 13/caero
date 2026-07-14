import { useState } from 'react'
import { Check, Shield, User } from 'lucide-react'
import { useMe } from '../api/hooks'
import PreferencesSection from '../components/setup/PreferencesSection'
import SelectorDefaultsSection from '../components/setup/SelectorDefaultsSection'
import {
  ChangePasswordSection,
  DangerZoneSection,
  MyDataSection,
  NotificationDefaultsSection,
} from '../components/setup/AccountSections'
import {
  FullDataSection,
  NotificationTestsSection,
  SchedulerJobsSection,
  UserManagementSection,
} from '../components/setup/AdminSections'
import AboutSection from '../components/setup/AboutSection'

type Tab = 'account' | 'admin'

export default function Setup() {
  const { data: me } = useMe()
  const [activeTab, setActiveTab] = useState<Tab>('account')
  const [toastMsg, setToastMsg] = useState('')

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
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
          <PreferencesSection showToast={showToast} />
          <ChangePasswordSection showToast={showToast} />
          <NotificationDefaultsSection showToast={showToast} />
          <SelectorDefaultsSection showToast={showToast} isAdmin={!!me?.is_admin} />
          <MyDataSection showToast={showToast} />
          <DangerZoneSection showToast={showToast} />
          <AboutSection />
        </div>
      )}

      {/* ── Admin tab ── */}
      {activeTab === 'admin' && me?.is_admin && (
        <div className="space-y-4">
          <NotificationTestsSection showToast={showToast} />
          <SchedulerJobsSection />
          <FullDataSection showToast={showToast} />
          <UserManagementSection showToast={showToast} />
        </div>
      )}

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
