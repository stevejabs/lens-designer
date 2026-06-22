# Web test shells

The Next.js web app is created during `/build` phase E1. These shells are
in place so the test plan can trace and the build can wire them up to
vitest as soon as the package.json exists.

When E1 lands:
1. Next.js scaffolds `package.json`, `tsconfig.json`.
2. Add `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react` to devDeps.
3. Add a `vitest.config.ts` next to `package.json`:
   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       environment: 'jsdom',
       include: ['test/**/*.test.ts'],
     },
   });
   ```
4. `pnpm test` from `tools/lens-designer/web/` runs all the shells in
   this directory.

## Shells

- `store.test.ts` — design-store reducers + localStorage round-trip
- `coord.test.ts` — cm ↔ SVG-px conversion
- `bridge-client.test.ts` — BridgeClient hook (mirror of the bridge unit tests)
- `inspector-forms.test.ts` — Inspector form controls
