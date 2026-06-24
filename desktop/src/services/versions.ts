// versions.ts — per-asset version history so a refine REPLACES the asset in
// place while keeping the prior bytes restorable (rollback).
//
// Snapshots live under `<projectDir>/.lensdesigner/versions/` — deliberately
// OUTSIDE Assets/ so Lens Studio never tries to import a snapshot as a real
// asset. The directory is a single gitignore line (`.lensdesigner/`).
//
// Flow: before any refine (or restore), snapshot the current asset bytes; the
// asset file itself is then overwritten in place. Restore copies a snapshot
// back onto the asset path (snapshotting the current state first, so a restore
// is itself undoable). LS re-imports automatically when the file on disk
// changes.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const ROOT = '.lensdesigner';
const VERSIONS = 'versions';
const MAX_VERSIONS = 12;

export interface VersionEntry {
  /** Opaque id (the snapshot filename) used to restore. */
  id: string;
  /** Original capture time, ms since epoch (derived from the filename). */
  createdMs: number;
  sizeBytes: number;
}

/** A stable, filesystem-safe key for an asset path (collision-resistant). */
function keyFor(assetPath: string): string {
  const hash = createHash('sha1').update(assetPath).digest('hex').slice(0, 12);
  const safeName = basename(assetPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeName}.${hash}`;
}

function versionsDir(projectDir: string, assetPath: string): string {
  return join(projectDir, ROOT, VERSIONS, keyFor(assetPath));
}

/** Absolute path of a single version snapshot (e.g. to read its bytes for
 *  playback). The id is the snapshot filename. */
export function versionFilePath(projectDir: string, assetPath: string, versionId: string): string {
  return join(versionsDir(projectDir, assetPath), versionId);
}

// Filename: <epochMs><ext> — sortable, carries the timestamp, preserves ext.
function parseEntryTime(filename: string): number {
  const n = Number.parseInt(filename.split('.')[0] ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

/** Snapshot the current asset bytes into version history. No-op if the asset
 *  file doesn't exist yet. Returns the new version id, or null. */
export async function snapshot(
  projectDir: string,
  assetPath: string,
  nowMs: number,
): Promise<string | null> {
  let size = 0;
  try {
    size = (await stat(assetPath)).size;
  } catch {
    return null; // nothing to snapshot
  }
  const dir = versionsDir(projectDir, assetPath);
  await mkdir(dir, { recursive: true });
  const id = `${nowMs}${extname(assetPath)}`;
  await copyFile(assetPath, join(dir, id));
  await prune(dir);
  void size;
  return id;
}

async function prune(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  if (names.length <= MAX_VERSIONS) return;
  const sorted = names.sort((a, b) => parseEntryTime(b) - parseEntryTime(a));
  for (const stale of sorted.slice(MAX_VERSIONS)) {
    await rm(join(dir, stale), { force: true });
  }
}

/** List an asset's version history, newest first. */
export async function listVersions(
  projectDir: string,
  assetPath: string,
): Promise<VersionEntry[]> {
  const dir = versionsDir(projectDir, assetPath);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.map(async (name): Promise<VersionEntry | null> => {
      try {
        const s = await stat(join(dir, name));
        return { id: name, createdMs: parseEntryTime(name), sizeBytes: s.size };
      } catch {
        return null;
      }
    }),
  );
  return entries
    .filter((e): e is VersionEntry => e !== null)
    .sort((a, b) => b.createdMs - a.createdMs);
}

/** Restore a prior version onto the asset path. Snapshots the current bytes
 *  first so the restore is itself reversible. */
export async function restoreVersion(
  projectDir: string,
  assetPath: string,
  versionId: string,
  nowMs: number,
): Promise<{ ok: boolean; message: string }> {
  const dir = versionsDir(projectDir, assetPath);
  const src = join(dir, versionId);
  try {
    await stat(src);
  } catch {
    return { ok: false, message: 'version not found' };
  }
  // Preserve the current state before overwriting it.
  await snapshot(projectDir, assetPath, nowMs);
  try {
    await copyFile(src, assetPath);
    return { ok: true, message: 'restored' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
