import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app's tsconfig sets jsx: "preserve" (Next compiles JSX itself), so the
  // esbuild transform vitest uses would otherwise fall back to the classic
  // runtime and need React in scope. Use the automatic runtime — matches how
  // Next builds (react-jsx) and lets component tests render JSX without an
  // explicit React import.
  esbuild: { jsx: 'automatic' },
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
