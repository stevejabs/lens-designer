// views.ts — discover UI views in the project. A "view" is a TypeScript
// BaseScriptComponent that builds a SpectaclesUIKit surface (what CLAD's
// /specs-build-ui emits, and what the WYSIWYG designer will emit). We detect
// them heuristically: a .ts under Assets/ that references SpectaclesUIKit or
// creates a Component.Canvas. Read-only.

import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join } from 'node:path';

export interface ScannedView {
  id: string;
  name: string;
  /** Module file name, e.g. SettingsPanel.ts */
  module: string;
  path: string;
  /** Born from a CLAD prompt (has a context sidecar) vs. hand-authored. */
  origin: 'prompt' | 'wysiwyg';
  updatedMs: number;
}

const SKIP_DIRS = new Set(['Cache', 'node_modules', '.git', 'Logs', 'Output']);
const MAX_DEPTH = 6;
const UIKIT_MARKER = /SpectaclesUIKit|createComponent\(\s*["']Component\.Canvas["']|Component\.Canvas/;

async function walkTs(dir: string, depth: number, out: string[]): Promise<void> {
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
      await walkTs(join(dir, e.name), depth + 1, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      out.push(join(dir, e.name));
    }
  }
}

/** Scan the project for UIKit view modules, newest first. */
export async function scanViews(projectDir: string): Promise<ScannedView[]> {
  const assetsDir = join(projectDir, 'Assets');
  const files: string[] = [];
  await walkTs(assetsDir, 0, files);

  const results = await Promise.all(
    files.map(async (path): Promise<ScannedView | null> => {
      let content: string;
      let updatedMs = 0;
      try {
        content = await readFile(path, 'utf8');
        updatedMs = (await stat(path)).mtimeMs;
      } catch {
        return null;
      }
      if (!UIKIT_MARKER.test(content)) return null;
      const module = basename(path);
      // A sibling `<module>.ldctx.json` marks a prompt-born view.
      let origin: 'prompt' | 'wysiwyg' = 'wysiwyg';
      try {
        await stat(`${path}.ldctx.json`);
        origin = 'prompt';
      } catch {
        origin = 'wysiwyg';
      }
      return { id: path, name: basename(path, '.ts'), module, path, origin, updatedMs };
    }),
  );

  return results
    .filter((r): r is ScannedView => r !== null)
    .sort((a, b) => b.updatedMs - a.updatedMs);
}
