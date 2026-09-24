import { expect, test } from '@playwright/test'

// Runs against a fresh database: the first registered user becomes admin.
const USERNAME = `e2e-${Date.now()}`
const PASSWORD = 'e2e-password'

test.describe.configure({ mode: 'serial' })

test('register, login, add a product, see it on the dashboard', async ({ page }) => {
  await page.goto('/')

  // ── Register ──
  await page.getByRole('button', { name: 'Register' }).click()
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Account created, please login')).toBeVisible()

  // ── Login ──
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('No products yet')).toBeVisible()

  // ── Add product ──
  await page.getByRole('link', { name: 'Add your first product' }).click()
  await page.getByPlaceholder('e.g. Sony WH-1000XM5').fill('E2E Widget')
  await page.getByPlaceholder('https://example.com/product').fill('https://example.com/widget')
  await page.getByPlaceholder('.price, #product-price, [data-price]').fill('.price')
  // Don't auto-check on save — CI has no scraping browser installed.
  const startTracking = page.locator('#active')
  if (await startTracking.isChecked()) await startTracking.click()
  await page.getByRole('button', { name: 'Add product' }).click()

  // Lands on the product detail page
  await expect(page.getByRole('heading', { name: 'E2E Widget' })).toBeVisible()

  // ── Dashboard shows it ──
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('tab', { name: /All \(/ }).click()
  await expect(page.getByText('E2E Widget').first()).toBeVisible()
})

test('settings page is reachable', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Search products')).toBeVisible()

  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  // Sections every user gets, admin or not.
  await expect(page.getByText('Change password')).toBeVisible()
  await expect(page.getByText('Preferences')).toBeVisible()
})

test('settings tabs: about for everyone, schedulers and logs for admins', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Search products')).toBeVisible()

  await page.goto('/setup?tab=about')
  // Wait for /me so admin-ness is known before inspecting tabs.
  await expect(page.getByText('Signed in as')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Backend Version:')).toBeVisible()

  // On a reused (non-fresh) DB this user may not be the admin — then only
  // the non-admin expectations apply.
  if (!(await page.getByRole('tab', { name: 'Logs' }).isVisible())) {
    await expect(page.getByRole('tab', { name: 'Schedulers' })).toHaveCount(0)
    return
  }

  await page.getByRole('tab', { name: 'Schedulers' }).click()
  await expect(page).toHaveURL(/tab=schedulers/)
  await page.getByRole('button', { name: 'Run Nightly retention now' }).click()

  await page.getByRole('tab', { name: 'Logs' }).click()
  await page.getByLabel('Category').selectOption('maintenance')
  await expect(page).toHaveURL(/category=maintenance/)
  // The one-off job runs asynchronously; reload until its event shows up.
  await expect(async () => {
    await page.reload()
    await expect(page.getByText(/Retention finished/).first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
})

test('schedulers: disable and re-enable the nightly backup inline', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Search products')).toBeVisible()

  await page.goto('/setup?tab=about')
  await expect(page.getByText('Signed in as')).toBeVisible()
  if (!(await page.getByRole('tab', { name: 'Logs' }).isVisible())) return // not admin on a reused DB

  await page.goto('/setup?tab=schedulers')
  const toggle = page.getByRole('checkbox', { name: 'Enable Nightly backup' })
  const backupRow = page.getByRole('listitem').filter({ has: toggle })
  // State-agnostic, so a retry on a reused DB still passes: normalise to on first.
  // The box is controlled by the saved setting, so click and wait for the state.
  if (!(await toggle.isChecked())) {
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(backupRow.getByText('Disabled', { exact: true })).toHaveCount(0)
  }

  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(backupRow.getByText('Disabled', { exact: true })).toBeVisible()
  await expect(backupRow.getByText('disabled', { exact: true })).toBeVisible()

  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(backupRow.getByText('Disabled', { exact: true })).toHaveCount(0)
})
