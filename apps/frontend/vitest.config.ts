import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15_000,
    maxWorkers: process.env.CI ? 2 : 4,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 75,
        branches: 70,
        statements: 65,
        functions: 60,
        'src/clinic.ts': { lines: 90, branches: 90, statements: 90, functions: 90 },
        'src/workflow.ts': { lines: 90, branches: 90, statements: 90, functions: 90 },
      },
    },
  },
})
