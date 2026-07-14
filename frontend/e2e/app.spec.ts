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
