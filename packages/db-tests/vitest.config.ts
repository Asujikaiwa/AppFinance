import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
