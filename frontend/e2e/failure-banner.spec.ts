import { expect, test, type Page } from '@playwright/test'

// Scrape-failure banners. CI has no scraping browser, so a real failure streak
// can't be produced; the product API responses are patched in the page
// instead. Own user and product, so it survives a non-fresh database.
const USERNAME = `e2e-failure-${Date.now()}`
const PASSWORD = 'e2e-password'

test.describe.configure({ mode: 'serial' })

let productId = 0
let steadyId = 0

const failing = {
  consecutive_scrape_failures: 4,
  last_scrape_error: 'no_match',
  scrape_failing_since: new Date(Date.now() - 2 * 86_400_000).toISOString(),
}

/** Overlay a failure streak on the test product wherever the API returns it. */
async function mockFailures(page: Page, overrides: object, degraded = false) {
  await page.route(/\/api\/products(\/\d+)?(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const body = await response.json()
    const patch = (p: { id: number }) => (p.id === productId ? { ...p, ...overrides } : p)
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

  // One price, two months old: nothing inside the 30-day sparkline window.
  const steady = await api.post('/api/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Steady Price Check', url: 'https://example.com/steady', selector: '.price', active: false },
  })
  steadyId = (await steady.json()).id
  const price = await api.post(`/api/products/${steadyId}/prices`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { price: '42.00', scraped_at: new Date(Date.now() - 60 * 86_400_000).toISOString() },
  })
  expect(price.status()).toBe(201)
})

/** Top edge of a, relative to the bottom edge of b: > 0 means a sits below b. */
async function gapBelow(a: ReturnType<Page['locator']>, b: ReturnType<Page['locator']>) {
  const [boxA, boxB] = [await a.boundingBox(), await b.boundingBox()]
  return boxA!.y - (boxB!.y + boxB!.height)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`broken selector: card and detail explain it (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await mockFailures(page, failing)
    await login(page)

    await page.getByRole('tab', { name: /All \(/ }).click()
    // Grid: the notice takes the chart's place, below the product URL.
    const notice = page.getByRole('link', { name: /4 failed checks/ })
    await expect(notice).toBeVisible()
    expect(await gapBelow(notice, page.getByRole('link', { name: 'https://example.com/failing' }))).toBeGreaterThan(0)
    await screenshot(page, `dashboard-${colorScheme}`)

    // Table: a badge in the Trend column (the name-row copy is for phones only).
    await page.getByRole('button', { name: 'List view' }).click()
    await expect(page.getByRole('row', { name: /Failure Banner Check/ }).getByText('4 failed').filter({ visible: true })).toHaveCount(1)
    await screenshot(page, `table-${colorScheme}`)
    await page.getByRole('button', { name: 'Grid view' }).click()

    // Product page: the notice sits under the website link.
    await page.goto(`/products/${productId}`)
    const title = page.getByText('Last 4 price checks failed')
    await expect(title).toBeVisible()
    await expect(page.getByText(/found nothing on the page/)).toBeVisible()
    await expect(page.getByText('Failing since 2 days ago')).toBeVisible()
    expect(await gapBelow(title, page.getByRole('link', { name: /example\.com\/failing/ }))).toBeGreaterThan(0)
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

test('a price that has not moved in 30 days still draws a sparkline', async ({ page }) => {
  await login(page)
  await page.getByRole('tab', { name: /All \(/ }).click()
  await expect(page.locator(`a[href^="/products/${steadyId}"] svg[viewBox="0 0 100 28"]`)).toBeVisible()
})
