// asset-watch.ts — detect what an agent job actually produced on disk so the
// cockpit can keep ONE logical asset per refine (replace, not duplicate) and
// learn the path of a freshly created asset.
//
// CLAD's generators name their own output files, so a "refine" can land a
// new file next to the original instead of overwriting it. We snapshot the
// asset file set before a job and diff it after: a created asset is the new
// file; a refine that produced a stray duplicate is reconciled by moving the
// new bytes onto the canonical path and deleting the stray.

import { rename, rm, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { kindFor, listAssetFiles, type AssetKind } from './assets.js';

export interface AssetSnapshot {
  /** path → mtimeMs at snapshot time. */
  files: Map<string, number>;
  takenMs: number;
}

export async function snapshotAssets(projectDir: string): Promise<AssetSnapshot> {
  const paths = await listAssetFiles(projectDir);
  const files = new Map<string, number>();
  let takenMs = 0;
  await Promise.all(
    paths.map(async (p) => {
      try {
        const s = await stat(p);
        files.set(p, s.mtimeMs);
        takenMs = Math.max(takenMs, s.mtimeMs);
      } catch {
        /* gone already */
      }
    }),
  );
  return { files, takenMs: Date.now() };
}

interface Diff {
  created: string[]; // present now, absent before
  changed: string[]; // present before, mtime advanced
}

async function diff(projectDir: string, before: AssetSnapshot): Promise<Diff> {
  const after = await snapshotAssets(projectDir);
  const created: string[] = [];
  const changed: string[] = [];
  for (const [path, mtime] of after.files) {
    const prev = before.files.get(path);
    if (prev === undefined) created.push(path);
    else if (mtime > prev + 1) changed.push(path);
  }
  return { created, changed };
}

/** After a CREATE job: the new asset is the newest created file of `kind`
 *  (falling back to any created file). Returns its path, or null. */
export async function detectCreated(
  projectDir: string,
  before: AssetSnapshot,
  kind: AssetKind,
): Promise<string | null> {
  const { created } = await diff(projectDir, before);
  if (created.length === 0) return null;
  const ofKind = created.filter((p) => kindFor(p) === kind);
  const pool = ofKind.length > 0 ? ofKind : created;
  return newestByMtime(pool);
}

/** After a REFINE job targeting `canonicalPath`: ensure the result REPLACES
 *  the original rather than duplicating it.
 *  - canonical changed in place → nothing to do.
 *  - a single stray new file of the same kind appeared → move it onto the
 *    canonical path and delete the stray.
 *  - ambiguous (multiple candidates) → leave everything, report it. */
export async function reconcileRefine(
  projectDir: string,
  canonicalPath: string,
  before: AssetSnapshot,
): Promise<{ replaced: boolean; note: string }> {
  const { created, changed } = await diff(projectDir, before);
  if (changed.includes(canonicalPath)) {
    return { replaced: true, note: 'overwritten in place' };
  }
  const ext = extname(canonicalPath).toLowerCase();
  const strays = created.filter(
    (p) => p !== canonicalPath && extname(p).toLowerCase() === ext,
  );
  if (strays.length === 0) {
    return { replaced: false, note: 'no new file produced' };
  }
  if (strays.length > 1) {
    return { replaced: false, note: `ambiguous: ${strays.length} new files, left in place` };
  }
  const stray = strays[0] as string;
  try {
    await rm(canonicalPath, { force: true });
    await rename(stray, canonicalPath);
    return { replaced: true, note: 'reconciled duplicate onto original path' };
  } catch (err) {
    return { replaced: false, note: `reconcile failed: ${(err as Error).message}` };
  }
}

async function newestByMtime(paths: string[]): Promise<string | null> {
  let best: string | null = null;
  let bestMs = -1;
  for (const p of paths) {
    try {
      const m = (await stat(p)).mtimeMs;
      if (m > bestMs) {
        bestMs = m;
        best = p;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}
