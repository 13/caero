import { describe, expect, it } from 'vitest'
import { resolveTab, visibleTabs } from './settingsTabs'

describe('settings tabs', () => {
  it('shows admin-only tabs to admins only', () => {
    expect(visibleTabs(false)).toEqual(['account', 'about'])
    expect(visibleTabs(true)).toEqual(['account', 'schedulers', 'admin', 'about'])
  })

  it('resolves known tabs', () => {
    expect(resolveTab('about', false)).toBe('about')
    expect(resolveTab('schedulers', true)).toBe('schedulers')
  })

  it('falls back to account for missing, unknown or forbidden tabs', () => {
    expect(resolveTab(null, true)).toBe('account')
    expect(resolveTab('garbage', true)).toBe('account')
    expect(resolveTab('schedulers', false)).toBe('account')
    expect(resolveTab('admin', false)).toBe('account')
  })
})
