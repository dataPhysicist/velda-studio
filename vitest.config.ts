import { defineConfig } from 'vitest/config'

// Unit tests only: pure modules (model, import stages, checker, exports). The browser tests live in
// tests/e2e and run under Playwright.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The timing budgets run on their own (npm run test:perf) so other test files do not share the CPU with them.
    exclude: ['tests/e2e/**', 'node_modules/**', ...(process.env.PERF ? [] : ['tests/perf/**'])],
    environment: 'node',
    testTimeout: 30_000,
  },
})
