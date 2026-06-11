// dev.ts — local dev launcher.
//
// Sequence:
//   1. Build main + preload bundles via build.ts (one-shot, not watch
//      — Electron doesn't hot-reload its main process anyway).
//   2. Spawn electron pointing at the built main bundle.
//   3. Pipe stdout/stderr so the dev sees logs.
//
// Web app dev server is handled separately (Step 9 wires the
// app:// protocol so the Electron window can load it). For Step 7
// the renderer just shows the boot HTML.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function main(): Promise<void> {
  // 1. Build.
  process.stdout.write('[dev] building main + preload…\n');
  await run('tsx', [resolve(here, 'build.ts')], root);

  // 2. Launch electron.
  process.stdout.write('[dev] launching electron…\n');
  // Find electron's binary via the workspace node_modules.
  const electronBin = await resolveElectronBinary(root);
  // --remote-debugging-port exposes the renderer's Chrome DevTools
  // Protocol on localhost:9223. Lets us drive the renderer
  // programmatically (read zustand state, query DOM) during dev
  // debugging without asking the user to read DevTools back to us.
  await run(
    electronBin,
    [resolve(root, 'dist/main/main.cjs'), '--remote-debugging-port=9223'],
    root,
  );
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolveP();
      else rejectP(new Error(`${cmd} exited with ${code}`));
    });
    child.on('error', rejectP);
  });
}

async function resolveElectronBinary(root: string): Promise<string> {
  // electron's package exports a `cli.js` that prints the binary path
  // when required. The simpler path: require the package; default
  // export is the binary path string.
  const { createRequire } = await import('node:module');
  const localRequire = createRequire(resolve(root, 'package.json'));
  const electron = localRequire('electron');
  if (typeof electron !== 'string') {
    throw new Error('electron package did not resolve to a binary path');
  }
  return electron;
}

main().catch((err) => {
  process.stderr.write(`[dev] failed: ${(err as Error).message}\n`);
  process.exit(1);
});
