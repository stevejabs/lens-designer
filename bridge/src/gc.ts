// gc.ts — sweep orphaned assets out of <project>/Assets/LensDesigner/.
//
// Orphans accumulate naturally: deleting a node leaves its per-node
// material on disk; uploading then replacing an image leaves the old
// file behind; deleting a view drops the registry entry but not its
// prefab/controller (the latter is intentional per the dialog body —
// out of scope for this GC pass).
//
// In-scope orphan classes (this version):
//   - `LD_*.mat` — per-node materials (one per scene node)
//   - `images/img_<sha>.{png|jpg|jpeg|webp|gif}` — ingested images
//   - `fonts/font_<sha>.{ttf|otf}` — ingested fonts
//
// Out of scope (yet): view `.prefab` bundles, view `.ts` controllers,
// the bundled `LensDesigner.lspkg`, `LDStateController.ts`, the
// `views.json` registry, anything in `Cache/`.
//
// Source of truth for "in use":
//   - Every saved view's tree (loaded from the registry on disk)
//   - The caller's current in-memory tree (renderer's working copy —
//     covers unsaved work the registry doesn't know about)
//   - The caller's `customFonts` mapping — needed to resolve
//     font-name (`'LibreBaskerville'`) → file (`font_xxx.ttf`)
//
// Algorithm:
//   1. Compute in-use sets (material names, image paths, font files)
//   2. Read the on-disk inventory under Assets/LensDesigner/
//   3. Diff → orphan filenames
//   4. Filesystem unlink (file + `.meta` sidecar). LS re-indexes the
//      directory and drops the assets from its asset browser.

import { readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { DesignNode } from './protocol.ts';
import { sandboxLensDesignerDir } from './mcp.ts';
import { materialSlotName } from './applier.ts';

export interface GcInputs {
  /**
   * The renderer's current in-memory tree. Saved views aren't enough —
   * the user may be editing a brand-new view that hasn't been saved
   * yet, and its referenced assets must not be GC'd.
   */
  currentTree: DesignNode[];
  /**
   * Saved view trees, loaded by the daemon from the registry.
   * Flat sequence; each element is one view's root tree.
   */
  savedTrees: DesignNode[][];
  /**
   * Client-side custom-font mapping. The bridge has no copy of this
   * (font-name → file resolution lives in the renderer's design
   * store). Without it, every uploaded font looks orphaned because
   * node.properties.font is a name, not a path.
   */
  customFonts: Array<{ family: string; path: string }>;
}

export interface GcResult {
  deleted: { materials: number; images: number; fonts: number };
  kept: { materials: number; images: number; fonts: number };
  errors: string[];
  /**
   * Filenames (not full paths) of deleted font files — `font_<hash>.ttf`
   * etc. The renderer uses this to drop matching entries from its
   * `customFonts` array; otherwise the font picker keeps showing
   * fonts whose underlying file was just swept.
   */
  deletedFontFiles: string[];
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const FONT_EXTS = new Set(['ttf', 'otf']);

/**
 * Walk a DesignNode tree depth-first, yielding every node.
 */
function* walk(nodes: DesignNode[]): Generator<DesignNode> {
  for (const n of nodes) {
    yield n;
    const children = (n as { children?: DesignNode[] }).children;
    if (children) yield* walk(children);
  }
}

/**
 * Extract the filename (e.g. `img_abc.png`) from a node property that
 * holds an `LensDesigner/images/...` path. Returns null if it's not a
 * sandbox-ingested image (URL, empty, etc.).
 */
function imageFileFromPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^LensDesigner\/images\/(img_[A-Za-z0-9]+\.[a-z]+)$/);
  return m ? m[1]! : null;
}

/**
 * Resolve a node's `font` property to its on-disk font filename
 * (`font_<hash>.ttf`), or null for built-ins / unset.
 *
 * CRITICAL: the designer stores custom/uploaded/system fonts as a sandbox
 * PATH (`LensDesigner/fonts/font_<hash>.ttf`) in `node.properties.font`, and
 * built-ins as a family NAME (`LibreBaskerville`). The old code only did the
 * family→file lookup, so a path-valued reference never matched → the font read
 * as orphaned → the GC swept an in-use font off disk (and out of LS). Handle
 * both: a path resolves to its basename directly; a name via the mapping.
 */
function fontFileFromValue(value: unknown, fontFamilyToFile: Map<string, string>): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const pathMatch = value.match(/(?:^|\/)(font_[A-Za-z0-9]+\.(?:ttf|otf))$/i);
  if (pathMatch) return pathMatch[1]!;
  return fontFamilyToFile.get(value) ?? null;
}

/**
 * Compute the set of in-use material slot names, image filenames, and
 * font filenames across every supplied tree.
 */
function computeInUse(
  trees: DesignNode[][],
  fontFamilyToFile: Map<string, string>,
): { materials: Set<string>; images: Set<string>; fonts: Set<string> } {
  const materials = new Set<string>();
  const images = new Set<string>();
  const fonts = new Set<string>();
  for (const tree of trees) {
    for (const node of walk(tree)) {
      materials.add(materialSlotName(node));
      const imgFile = imageFileFromPath(node.properties['imageSource']);
      if (imgFile) images.add(imgFile);
      const fontFile = fontFileFromValue(node.properties['font'], fontFamilyToFile);
      if (fontFile) fonts.add(fontFile);
    }
  }
  return { materials, images, fonts };
}

/**
 * Best-effort delete of a file + its `.meta` sidecar. Errors are
 * collected, never thrown — one stuck file shouldn't abort the sweep.
 */
async function unlinkPair(absPath: string, errors: string[]): Promise<boolean> {
  try {
    await unlink(absPath);
  } catch (err) {
    errors.push(`unlink ${absPath}: ${(err as Error).message}`);
    return false;
  }
  try {
    await unlink(`${absPath}.meta`);
  } catch {
    // .meta may not exist (older LS imports) — non-fatal.
  }
  return true;
}

/**
 * List entries in a directory, returning [] if the directory doesn't
 * exist. Filters out hidden files and `.meta` sidecars (which we
 * delete alongside their primary file).
 */
async function listAssetFiles(absDir: string): Promise<string[]> {
  try {
    const s = await stat(absDir);
    if (!s.isDirectory()) return [];
  } catch {
    return [];
  }
  const entries = await readdir(absDir);
  return entries.filter((n) => !n.startsWith('.') && !n.endsWith('.meta'));
}

/**
 * Run a sweep. Idempotent; safe to call repeatedly. Touches only files
 * under the active project's `Assets/LensDesigner/{*.mat,images,fonts}`.
 */
export async function runGc(inputs: GcInputs): Promise<GcResult> {
  const result: GcResult = {
    deleted: { materials: 0, images: 0, fonts: 0 },
    kept: { materials: 0, images: 0, fonts: 0 },
    errors: [],
    deletedFontFiles: [],
  };

  const fontFamilyToFile = new Map<string, string>();
  for (const f of inputs.customFonts) {
    // CustomFont.path is sandbox-relative like
    // `LensDesigner/fonts/font_<hash>.ttf` — strip the dir prefix.
    const m = f.path.match(/^LensDesigner\/fonts\/(.+)$/);
    if (m) fontFamilyToFile.set(f.family, m[1]!);
  }

  // Safety: if NOTHING references any asset — no current tree and no saved
  // views — the keep-set is empty and the sweep below would delete the entire
  // pool. In practice that state means the manifest hasn't loaded (fresh
  // attach, wrong project, or client teardown), NOT a genuine "delete
  // everything." This once wiped 9 materials on shutdown. Refuse: a truly
  // empty project has no LD_ assets to collect anyway, so skipping is a no-op
  // there and a lifesaver otherwise.
  const currentEmpty = !inputs.currentTree || inputs.currentTree.length === 0;
  const savedEmpty = inputs.savedTrees.every((t) => !t || t.length === 0);
  if (currentEmpty && savedEmpty) {
    result.errors.push('skipped: no views loaded — refusing to sweep the asset pool');
    return result;
  }

  const inUse = computeInUse(
    [inputs.currentTree, ...inputs.savedTrees],
    fontFamilyToFile,
  );

  const baseDir = sandboxLensDesignerDir();
  const imagesDir = join(baseDir, 'images');
  const fontsDir = join(baseDir, 'fonts');

  // Materials: top-level .mat files starting with `LD_` (and NOT
  // `LDFont_` — that's a different namespace for the font preset assets).
  const rootEntries = await listAssetFiles(baseDir);
  for (const name of rootEntries) {
    if (!name.startsWith('LD_') || !name.endsWith('.mat')) continue;
    if (name.startsWith('LDFont_')) continue;
    const slotName = name.replace(/\.mat$/, '');
    if (inUse.materials.has(slotName)) {
      result.kept.materials += 1;
      continue;
    }
    if (await unlinkPair(join(baseDir, name), result.errors)) {
      result.deleted.materials += 1;
    }
  }

  // Images.
  const imageEntries = await listAssetFiles(imagesDir);
  for (const name of imageEntries) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!name.startsWith('img_') || !IMAGE_EXTS.has(ext)) continue;
    if (inUse.images.has(name)) {
      result.kept.images += 1;
      continue;
    }
    if (await unlinkPair(join(imagesDir, name), result.errors)) {
      result.deleted.images += 1;
    }
  }

  // Fonts.
  const fontEntries = await listAssetFiles(fontsDir);
  for (const name of fontEntries) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    // Only sweep our `font_<hash>` namespace. The packaged
    // `LDFont_<Name>` fonts shipped via the .lspkg stay put.
    if (!name.startsWith('font_') || !FONT_EXTS.has(ext)) continue;
    if (inUse.fonts.has(name)) {
      result.kept.fonts += 1;
      continue;
    }
    if (await unlinkPair(join(fontsDir, name), result.errors)) {
      result.deleted.fonts += 1;
      result.deletedFontFiles.push(name);
    }
  }

  // Touch the parent dir so LS notices the changes on its next index.
  // No-op if nothing was deleted; harmless either way.
  void dirname(baseDir);

  return result;
}
