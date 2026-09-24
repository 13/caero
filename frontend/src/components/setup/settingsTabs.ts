export type SettingsTab = 'account' | 'schedulers' | 'admin' | 'about'

const ALL_TABS: readonly SettingsTab[] = ['account', 'schedulers', 'admin', 'about']
const ADMIN_TABS: ReadonlySet<SettingsTab> = new Set<SettingsTab>(['schedulers', 'admin'])

export function visibleTabs(isAdmin: boolean): SettingsTab[] {
  return ALL_TABS.filter((tab) => isAdmin || !ADMIN_TABS.has(tab))
}

/** Tab from the URL, or 'account' when missing, unknown or not permitted. */
export function resolveTab(raw: string | null, isAdmin: boolean): SettingsTab {
  const match = visibleTabs(isAdmin).find((tab) => tab === raw)
  return match ?? 'account'
}
