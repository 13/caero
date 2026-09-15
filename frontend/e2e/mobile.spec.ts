import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Phone-width layout checks. Uses its own user and product, so it survives a
// non-fresh database (CI retries reuse it) and runs independently of app.spec.
const USERNAME = `e2e-mobile-${Date.now()}`
const PASSWORD = 'e2e-password'

test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })
test.describe.configure({ mode: 'serial' })

let productId = 0

async function apiPost(api: APIRequestContext, path: string, token: string, data: object) {
  return api.post(path, { headers: { Authorization: `Bearer ${token}` }, data })
}

/** Uploaded as a CI artifact on pull requests (see .github/workflows/ci.yml). */
async function screenshot(page: Page, name: string) {
  await page.waitForTimeout(1500) // let chart animations finish
  await page.screenshot({ path: `test-results/mobile-screens/${name}.png`, fullPage: true })
}

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Search products')).toBeVisible()
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL })
  const register = await api.post('/api/auth/register', { data: { username: USERNAME, password: PASSWORD } })
  expect(register.status()).toBe(201)
  const loginResp = await api.post('/api/auth/login', { form: { username: USERNAME, password: PASSWORD } })
  const { access_token: token } = await loginResp.json()

  const product = await apiPost(api, '/api/products', token, {
    name: 'Anker SOLIX Solarbank 4 E5000 Pro Mobile Layout Check',
    url: 'https://example.com/a-rather-long-product-url-that-should-truncate-cleanly',
    selector: '.price',
    category: 'pv',
    tags: ['inverter'],
    active: false,
  })
  expect(product.status()).toBe(201)
  productId = (await product.json()).id

  const now = Date.now()
  for (const [daysAgo, price] of [[40, '2049.00'], [20, '1950.00'], [0, '1695.80']] as const) {
    const resp = await apiPost(api, `/api/products/${productId}/prices`, token, {
      price,
      scraped_at: new Date(now - daysAgo * 86_400_000).toISOString(),
    })
    expect(resp.status()).toBe(201)
  }
  await api.dispose()
})

test('product detail fits a phone screen', async ({ page }) => {
  await login(page)
  await page.goto(`/products/${productId}`)
  await expect(page.getByRole('heading', { name: /Anker SOLIX/ })).toBeVisible()

  await expectNoHorizontalScroll(page)

  // "Check now" stays on one line (it used to wrap into a two-line pill).
  const checkNow = page.getByRole('button', { name: 'Check now' })
  const lineHeight = await checkNow.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  expect((await checkNow.boundingBox())!.height).toBeLessThan(lineHeight * 2)

  // Every chart range button is fully on screen (the "All" tab used to be clipped).
  const viewport = page.viewportSize()!
  for (const label of ['7d', '30d', '90d', '1y', 'All']) {
    const box = (await page.getByRole('group', { name: 'Chart range' }).getByRole('button', { name: label }).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  }
  await expect(page.getByRole('button', { name: 'Add price' })).toBeInViewport()
  await screenshot(page, 'product-detail')
})

test('dashboard list and add product fit a phone screen', async ({ page }) => {
  await login(page)
  await page.getByRole('tab', { name: /All \(/ }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByRole('link', { name: /Anker SOLIX/ })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await screenshot(page, 'dashboard-list')

  await page.goto('/add')
  await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await screenshot(page, 'add-product')
})

test('settings fits a phone screen', async ({ page }) => {
  await login(page)
  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await screenshot(page, 'settings')
})
