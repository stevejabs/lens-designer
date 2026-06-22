// assets.ts — scan a Lens Studio project for generated/imported assets the
// cockpit can show: meshes (.glb/.gltf), audio (.wav/.mp3), and their distilled
// context sidecars. Read-only; bounded-depth walk that skips Cache/build dirs.

import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readContext } from './context-store.js';

export type AssetKind = 'mesh' | 'music' | 'sfx';

export interface ScannedAsset {
  id: string;
  name: string;
  kind: AssetKind;
  path: string;
  origin: 'prompt' | 'import';
  updatedMs: number;
  sizeBytes: number;
  hasContext: boolean;
  prompt?: string;
}

const SKIP_DIRS = new Set(['Cache', 'node_modules', '.git', 'Logs', 'Output']);
const MAX_DEPTH = 6;

function kindFor(file: string): AssetKind | null {
  const ext = extname(file).toLowerCase();
  if (ext === '.glb' || ext === '.gltf') return 'mesh';
  if (ext === '.wav' || ext === '.mp3' || ext === '.ogg') {
    const n = file.toLowerCase();
    return /music|loop|pad|song|melody|chord|theme|ambient/.test(n) ? 'music' : 'sfx';
  }
  return null;
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), depth + 1, out);
    } else if (kindFor(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

/** Scan `projectDir/Assets` for cockpit-visible assets, newest first. */
export async function scanAssets(projectDir: string): Promise<ScannedAsset[]> {
  const assetsDir = join(projectDir, 'Assets');
  const files: string[] = [];
  await walk(assetsDir, 0, files);

  const results = await Promise.all(
    files.map(async (path): Promise<ScannedAsset | null> => {
      const kind = kindFor(path);
      if (!kind) return null;
      let sizeBytes = 0;
      let updatedMs = 0;
      try {
        const s = await stat(path);
        sizeBytes = s.size;
        updatedMs = s.mtimeMs;
      } catch {
        return null;
      }
      const ctx = await readContext(path);
      return {
        id: path,
        name: basename(path, extname(path)),
        kind,
        path,
        origin: ctx ? 'prompt' : 'import',
        updatedMs,
        sizeBytes,
        hasContext: ctx !== null,
        ...(ctx?.promptHistory?.length ? { prompt: ctx.promptHistory[ctx.promptHistory.length - 1] } : {}),
      };
    }),
  );

  return results
    .filter((r): r is ScannedAsset => r !== null)
    .sort((a, b) => b.updatedMs - a.updatedMs);
}
