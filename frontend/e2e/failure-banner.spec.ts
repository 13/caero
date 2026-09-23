import { expect, test, type Page } from '@playwright/test'

// Scrape-failure banners. CI has no scraping browser, so a real failure streak
// can't be produced; the product API responses are patched in the page
// instead. Own user and product, so it survives a non-fresh database.
const USERNAME = `e2e-failure-${Date.now()}`
const PASSWORD = 'e2e-password'

test.describe.configure({ mode: 'serial' })

let productId = 0

const failing = {
  consecutive_scrape_failures: 4,
  last_scrape_error: 'no_match',
  scrape_failing_since: new Date(Date.now() - 2 * 86_400_000).toISOString(),
}

/** Overlay a failure streak on every product the API returns. */
async function mockFailures(page: Page, overrides: object, degraded = false) {
  await page.route(/\/api\/products(\/\d+)?(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const body = await response.json()
    const patch = (p: object) => ({ ...p, ...overrides })
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) })
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', scraping_degraded: degraded, last_successful_scrape_at: null } })
  )
}

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByLabel('Search products')).toBeVisible()
}

/** Not asserted — for eyeballing light/dark (test-results/failure-banner/). */
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/failure-banner/${name}.png`, fullPage: true })
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL })
  const register = await api.post('/api/auth/register', { data: { username: USERNAME, password: PASSWORD } })
  expect(register.status()).toBe(201)
  const loginResp = await api.post('/api/auth/login', { form: { username: USERNAME, password: PASSWORD } })
  const { access_token: token } = await loginResp.json()
  const product = await api.post('/api/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Failure Banner Check', url: 'https://example.com/failing', selector: '.price', active: false },
  })
  expect(product.status()).toBe(201)
  productId = (await product.json()).id
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`broken selector: card and detail explain it (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await mockFailures(page, failing)
    await login(page)

    await page.getByRole('tab', { name: /All \(/ }).click()
    const card = page.getByRole('link', { name: /4 failed checks/ })
    await expect(card).toBeVisible()
    await screenshot(page, `dashboard-${colorScheme}`)

    await page.goto(`/products/${productId}`)
    await expect(page.getByText('Last 4 price checks failed')).toBeVisible()
    await expect(page.getByText(/found nothing on the page/)).toBeVisible()
    await expect(page.getByText('Failing since 2 days ago')).toBeVisible()
    await screenshot(page, `detail-${colorScheme}`)
  })
}

test('edit selector opens the panel focused on the selector', async ({ page }) => {
  await mockFailures(page, failing)
  await login(page)
  await page.goto(`/products/${productId}`)

  await page.getByRole('button', { name: 'Edit selector' }).click()
  await expect(page.getByRole('heading', { name: 'Edit product' })).toBeVisible()
  await expect(page.locator('input.font-mono')).toBeFocused()
})

test('below the threshold the notice stays quiet', async ({ page }) => {
  await mockFailures(page, { ...failing, consecutive_scrape_failures: 1, last_scrape_error: 'timeout' })
  await login(page)
  await page.goto(`/products/${productId}`)

  await expect(page.getByText('Last price check failed')).toBeVisible()
  await expect(page.getByText('Caero retries on the next scheduled check.')).toBeVisible()
  // A slow page isn't a selector problem.
  await expect(page.getByRole('button', { name: 'Edit selector' })).toHaveCount(0)
})

test('a scraping-wide outage does not blame the selector', async ({ page }) => {
  await mockFailures(page, failing, true)
  await login(page)
  await page.goto(`/products/${productId}`)

  await expect(page.getByText(/failing for many products/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit selector' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check now' }).last()).toBeVisible()
})
