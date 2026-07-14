/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    // Playwright specs live in e2e/ and must not be collected by vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
  build: {
    outDir: '../backend/app/static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
