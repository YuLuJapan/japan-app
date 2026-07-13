import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
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
        },
      },
    ],
  },
})
