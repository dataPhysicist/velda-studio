import { defineConfig } from 'vitest/config'

// Unit tests only: pure modules (model, import stages, checker, exports). The browser tests live in
// tests/e2e and run under Playwright.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
