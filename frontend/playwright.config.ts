import { defineConfig } from '@playwright/test'

// E2E tests run against a full backend serving the built frontend
// (see .github/workflows/ci.yml). Start one locally with:
//   npm run build
//   cd ../backend && SQLITE_PATH=/tmp/caero-e2e.db uv run uvicorn app.main:app --port 8000
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
  },
})
