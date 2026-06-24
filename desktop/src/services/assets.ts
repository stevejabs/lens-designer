// assets.ts — scan a Lens Studio project for generated/imported assets the
// cockpit can show: GLB meshes (.glb/.gltf), code-authored "scripted" meshes
// (a .ts BaseScriptComponent that builds geometry at runtime — what CLAD's
// mesh-builder backend emits, e.g. Book.ts), audio (.wav/.mp3), and their
// distilled context sidecars. Read-only; bounded-depth walk that skips
// Cache/build dirs.

import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readContext } from './context-store.js';

export type AssetKind = 'mesh' | 'music' | 'sfx';
/** How a mesh asset is realized: a baked GLB vs. a code-authored TS script. */
export type AssetBackend = 'glb' | 'script' | 'audio';

export interface ScannedAsset {
  id: string;
  name: string;
  kind: AssetKind;
  backend: AssetBackend;
  path: string;
  origin: 'prompt' | 'import';
  updatedMs: number;
  sizeBytes: number;
  hasContext: boolean;
  prompt?: string;
}

const SKIP_DIRS = new Set(['Cache', 'node_modules', '.git', 'Logs', 'Output', '.lensdesigner']);
const MAX_DEPTH = 6;

// A code-authored mesh builds geometry at runtime (MeshBuilder or a
// RenderMeshVisual it fills). A UIKit view is excluded — those are surfaced as
// views, not assets. The LDView host + the runtime gate are bridge-owned.
const MESH_SCRIPT_MARKER = /\bMeshBuilder\b|Component\.RenderMeshVisual|\bRenderMeshVisual\b/;
const UIKIT_MARKER = /SpectaclesUIKit|Component\.Canvas/;
const COMPONENT_MARKER = /@component|BaseScriptComponent/;

export function kindFor(file: string): AssetKind | null {
  const ext = extname(file).toLowerCase();
  if (ext === '.glb' || ext === '.gltf') return 'mesh';
  if (ext === '.wav' || ext === '.mp3' || ext === '.ogg') {
    const n = file.toLowerCase();
    return /music|loop|pad|song|melody|chord|theme|ambient/.test(n) ? 'music' : 'sfx';
  }
  return null;
}

function backendFor(kind: AssetKind, path: string): AssetBackend {
  if (kind !== 'mesh') return 'audio';
  return extname(path).toLowerCase() === '.ts' ? 'script' : 'glb';
}

/** Is this .ts a code-authored mesh (vs. a UIKit view or plain script)? */
function isScriptMesh(content: string): boolean {
  return (
    COMPONENT_MARKER.test(content) &&
    MESH_SCRIPT_MARKER.test(content) &&
    !UIKIT_MARKER.test(content)
  );
}

/** Walk for files matching `keep` (by filename). */
async function walk(
  dir: string,
  depth: number,
  keep: (name: string) => boolean,
  out: string[],
): Promise<void> {
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
      await walk(join(dir, e.name), depth + 1, keep, out);
    } else if (keep(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

/** All binary asset file paths (.glb/.wav/.mp3) — used by reconcile too. */
export async function listAssetFiles(projectDir: string): Promise<string[]> {
  const files: string[] = [];
  await walk(join(projectDir, 'Assets'), 0, (n) => kindFor(n) !== null, files);
  return files;
}

async function buildAsset(path: string, kind: AssetKind): Promise<ScannedAsset | null> {
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
    backend: backendFor(kind, path),
    path,
    origin: ctx ? 'prompt' : 'import',
    updatedMs,
    sizeBytes,
    hasContext: ctx !== null,
    ...(ctx?.promptHistory?.length ? { prompt: ctx.promptHistory[ctx.promptHistory.length - 1] } : {}),
  };
}

/** Scan `projectDir/Assets` for cockpit-visible assets (GLB meshes, scripted
 *  meshes, audio), newest first. */
export async function scanAssets(projectDir: string): Promise<ScannedAsset[]> {
  const assetsDir = join(projectDir, 'Assets');
  const binary: string[] = [];
  const ts: string[] = [];
  await Promise.all([
    walk(assetsDir, 0, (n) => kindFor(n) !== null, binary),
    walk(assetsDir, 0, (n) => n.endsWith('.ts') && !n.endsWith('.d.ts'), ts),
  ]);

  const binaryAssets = await Promise.all(
    binary.map((path) => {
      const kind = kindFor(path);
      return kind ? buildAsset(path, kind) : Promise.resolve(null);
    }),
  );

  // Scripted meshes: a .ts BaseScriptComponent that builds geometry.
  const scriptAssets = await Promise.all(
    ts.map(async (path): Promise<ScannedAsset | null> => {
      let content: string;
      try {
        content = await readFile(path, 'utf8');
      } catch {
        return null;
      }
      return isScriptMesh(content) ? buildAsset(path, 'mesh') : null;
    }),
  );

  return [...binaryAssets, ...scriptAssets]
    .filter((r): r is ScannedAsset => r !== null)
    .sort((a, b) => b.updatedMs - a.updatedMs);
}
