import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
    // Path aliases used by the web app (next.js TS auto-resolves these
    // for the app build; vitest needs an explicit mapping).
    alias: {
      '@/lib': new URL('./lib', import.meta.url).pathname,
      '@/components': new URL('./components', import.meta.url).pathname,
      '@/app': new URL('./app', import.meta.url).pathname,
    },
  },
});
