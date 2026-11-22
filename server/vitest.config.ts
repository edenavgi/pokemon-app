import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@app': path.resolve(import.meta.dirname, '../src') },
  },
  test: {
    environment: 'node',
    // The first test that needs MongoDB starts an in-memory mongod (and, on a fresh machine,
    // downloads it), which can take longer than the 5 s default.
    testTimeout: 30_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
