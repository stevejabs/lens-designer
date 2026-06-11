// build.ts — esbuild driver for the Electron main + preload bundles.
//
// Outputs:
//   dist/main/main.cjs       — Electron main process bundle (CJS, Node target)
//   dist/preload/preload.cjs — Preload script bundle (CJS, Node target)
//
// Why CJS: Electron's preload + main loaders are most reliable with
// CommonJS in v33. We keep `.ts` source as ESM and let esbuild emit
// CJS at build time.

import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cp, rm, stat } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const here = dirname(__filename);
const root = resolve(here, '..');

const watch = process.argv.includes('--watch');

type BundleFormat = 'cjs' | 'esm';

interface BundleTarget {
  entry: string;
  outfile: string;
  format: BundleFormat;
  /**
   * Set to true if the bundle's source uses `import.meta.url` and is
   * targeted at CJS. Adds a banner+define that yields a runtime file://
   * URL for the bundle. **Do NOT set on preload** — Electron's
   * sandboxed preload context forbids `require('url')`, which is what
   * the banner calls; the banner running there breaks
   * contextBridge.exposeInMainWorld silently.
   */
  importMetaShim?: boolean;
}

const TARGETS: ReadonlyArray<BundleTarget> = [
  // Electron's main + preload loaders prefer CJS; we keep them CJS.
  // Main + preload don't use import.meta.url so no shim needed.
  { entry: 'src/main.ts', outfile: 'dist/main/main.cjs', format: 'cjs' },
  { entry: 'src/preload.ts', outfile: 'dist/preload/preload.cjs', format: 'cjs' },
  // utilityProcess.fork loads .cjs natively. CJS bundling lets us pull
  // in CJS-only deps (ws, node-stream-zip) without the ESM-from-CJS
  // dance. `import.meta.url` usages in bridge/src are substituted via
  // esbuild's `define` to a CJS-compatible runtime expression.
  {
    entry: '../bridge/src/daemon.ts',
    outfile: 'dist/bridge/bridge.cjs',
    format: 'cjs',
    importMetaShim: true,
  },
];

async function run(): Promise<void> {
  for (const t of TARGETS) {
    const cfg = {
      entryPoints: [resolve(root, t.entry)],
      outfile: resolve(root, t.outfile),
      bundle: true,
      platform: 'node' as const,
      format: t.format,
      target: 'node22',
      external: [
        'electron',
        // The capture-addon ships a native .node; never bundle it.
        '@lens-designer/capture-addon',
        // The bridge package re-exports from its own source. Let
        // Node's resolver find it at runtime.
        '@lens-designer/bridge',
        // electron-store has dynamic-require + atomic file writes;
        // keeping it external is the documented pattern.
        'electron-store',
      ],
      sourcemap: true,
      logLevel: 'info' as const,
      define: {
        'process.env.LENS_DESIGNER_APP_VERSION': JSON.stringify(
          process.env.LENS_DESIGNER_APP_VERSION ?? '0.1.0-dev',
        ),
        // Bridge's pack.ts + export.ts use `import.meta.url`. In CJS
        // output that's not natively available; we substitute a
        // bundle-local identifier that the banner initializes at load.
        // Preload + main don't use import.meta.url, so we skip the
        // shim there (and crucially keep it OUT of the preload's
        // sandboxed context which forbids `require('url')`).
        ...(t.importMetaShim
          ? { 'import.meta.url': '__ld_import_meta_url' }
          : {}),
      },
      ...(t.importMetaShim
        ? {
            banner: {
              js:
                "const __ld_import_meta_url = " +
                "require('url').pathToFileURL(__filename).toString();",
            },
          }
        : {}),
    };

    if (watch) {
      const ctx = await context(cfg);
      await ctx.watch();
      process.stdout.write(`[build] watching ${t.entry} → ${t.outfile}\n`);
    } else {
      await build(cfg);
      process.stdout.write(`[build] built  ${t.entry} → ${t.outfile}\n`);
    }
  }
}

async function copyWebExport(): Promise<void> {
  const src = resolve(root, '..', 'web', 'out');
  const dst = resolve(root, 'dist', 'web');
  try {
    await stat(src);
  } catch {
    process.stdout.write(
      `[build] web export not found at ${src} — run \`pnpm --filter @lens-designer/web build\` first.\n`,
    );
    return;
  }
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });
  process.stdout.write(`[build] copied web export to ${dst}\n`);
}

/**
 * Stage the LensDesigner.lspkg (used by attach-mode's MCP install path)
 * at `dist/assets/`. In dev the Electron main process reads from there;
 * electron-builder's extraResources pulls from there into the packaged
 * app's resources/ tree.
 */
async function copyLensDesignerPack(): Promise<void> {
  const src = resolve(root, '..', 'bridge', 'assets', 'LensDesigner.lspkg');
  const dst = resolve(root, 'dist', 'assets', 'LensDesigner.lspkg');
  try {
    await stat(src);
  } catch {
    process.stdout.write(
      `[build] LensDesigner.lspkg not found at ${src} — attach mode's package install will fail until the artifact is restored.\n`,
    );
    return;
  }
  await rm(dst, { force: true });
  await cp(src, dst);
  process.stdout.write(`[build] copied LensDesigner.lspkg to ${dst}\n`);
}

run()
  .then(copyWebExport)
  .then(copyLensDesignerPack)
  .catch((err) => {
    process.stderr.write(`[build] failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
