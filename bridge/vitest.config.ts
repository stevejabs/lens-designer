import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Integration tests touch a real Lens Studio instance — slower, and
    // each one shouldn't trample the next.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
});
