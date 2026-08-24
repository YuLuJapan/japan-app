import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    // Both projects share one database, and every test starts by truncating it
    // — so two files running at once would pull the rug out from under each
    // other. Isolation comes from the reset, which means it has to be serial.
    fileParallelism: false,
    // Booting the stack (five containers, twenty-two migrations) happens once,
    // in globalSetup, and is most of this budget.
    hookTimeout: 300_000,
    teardownTimeout: 120_000,
    // At the run level, not per project: one stack serves both, and declaring
    // it twice would boot two.
    globalSetup: ['server/testing/global-setup.ts'],
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: ['src/tests/**/*.test.{ts,tsx}'],
          setupFiles: ['src/tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          include: ['server/tests/**/*.test.ts'],
          setupFiles: ['server/testing/setup.ts'],
        },
      },
    ],
  },
})
