import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Clock, Info, Shield, User } from 'lucide-react'
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
  UserManagementSection,
} from '../components/setup/AdminSections'
import SchedulersTab from '../components/setup/SchedulersTab'
import AboutSection from '../components/setup/AboutSection'
import { resolveTab, visibleTabs, type SettingsTab } from '../components/setup/settingsTabs'

const TAB_META: Record<SettingsTab, { label: string; icon: React.ElementType }> = {
  account: { label: 'Account', icon: User },
  schedulers: { label: 'Schedulers', icon: Clock },
  admin: { label: 'Admin', icon: Shield },
  about: { label: 'About', icon: Info },
}

export default function Setup() {
  const { data: me } = useMe()
  const isAdmin = !!me?.is_admin
  const [searchParams, setSearchParams] = useSearchParams()
  // Derived, not state: the URL is the source of truth, so refresh and shared
  // links keep the tab, and a non-admin's ?tab=admin quietly lands on Account.
  const activeTab = resolveTab(searchParams.get('tab'), isAdmin)
  const [toastMsg, setToastMsg] = useState('')

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  const selectTab = (tab: SettingsTab) =>
    setSearchParams(tab === 'account' ? {} : { tab }, { replace: true })

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

      {/* Tab bar — scrolls sideways on narrow phones instead of the page */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto"
      >
        {visibleTabs(isAdmin).map((key) => {
          const { label, icon: Icon } = TAB_META[key]
          const selected = activeTab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(key)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selected
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          )
        })}
      </div>

      {activeTab === 'account' && (
        <div className="space-y-4">
          <PreferencesSection showToast={showToast} />
          <ChangePasswordSection showToast={showToast} />
          <NotificationDefaultsSection showToast={showToast} />
          <SelectorDefaultsSection showToast={showToast} isAdmin={isAdmin} />
          <MyDataSection showToast={showToast} />
          <DangerZoneSection showToast={showToast} />
        </div>
      )}

      {activeTab === 'schedulers' && <SchedulersTab showToast={showToast} />}

      {activeTab === 'admin' && (
        <div className="space-y-4">
          <NotificationTestsSection showToast={showToast} />
          <FullDataSection showToast={showToast} />
          <UserManagementSection showToast={showToast} />
        </div>
      )}

      {activeTab === 'about' && <AboutSection />}

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
