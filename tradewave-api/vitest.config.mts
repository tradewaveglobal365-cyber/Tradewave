import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Auth tests share one database; parallel files would race on the same rows.
    fileParallelism: false,
    setupFiles: ['./src/test/setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
