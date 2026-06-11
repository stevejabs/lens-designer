// Base-component pack installer (TD-2, plan Step 5). The LensDesigner.lspkg
// shipped in `bridge/assets/` is the canonical source of the procedural
// materials, shaders, fonts, and LDStateController. Install on attach so
// designs render against the connected project's installed assets.
//
// Idempotent: if `ListInstalledPackagesTool` already reports the pack, skip
// the install. UUIDs are preserved cross-project for Editable installs when
// there's no conflict (S1 finding), so the asset id `LENSDESIGNER_PACK_UUID`
// stays stable across every fresh install — that's our idempotency key.

import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  type McpClient,
  installPackage,
  listInstalledPackages,
} from './mcp.ts';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute filesystem path to the vendored `.lspkg`.
 *
 * Resolution order:
 *   1. `LENS_DESIGNER_PACK_PATH` env var — the Electron main process
 *      sets this before forking the bridge utilityProcess so the
 *      packaged-build path (`process.resourcesPath/LensDesigner.lspkg`)
 *      reaches the bridge without it needing to know about Electron.
 *   2. `here/../assets/LensDesigner.lspkg` — the dev fallback when
 *      running `pnpm bridge:dev` against the in-tree workspace.
 */
export const LENSDESIGNER_PACK_PATH =
  process.env['LENS_DESIGNER_PACK_PATH'] ??
  resolve(here, '..', 'assets', 'LensDesigner.lspkg');

/**
 * Stable asset UUID of the LensDesigner package's NativePackageDescriptor.
 * Authored when the `.lspkg` was created via LS's Create Package flow;
 * preserved cross-project on Editable install (no conflict). If the pack is
 * ever re-authored from a fresh Create Package, regenerate this constant from
 * `ListInstalledPackagesTool` output and bump the changelog.
 */
export const LENSDESIGNER_PACK_UUID = 'c2020390-1158-4e5a-90fd-fd3566b2b58e';

export interface EnsurePackResult {
  /** True iff the install actually ran (not already present). */
  installed: boolean;
  /** Asset UUID of the installed pack — always `LENSDESIGNER_PACK_UUID`. */
  packUUID: string;
}

/**
 * Install the base pack into the connected project if not already present.
 *
 * The `.lspkg` must exist at `LENSDESIGNER_PACK_PATH`. If it doesn't, throw
 * — that's a build-system failure, not a runtime condition.
 */
export async function ensureLensDesignerPackInstalled(
  client: McpClient,
): Promise<EnsurePackResult> {
  // Confirm the vendored artifact exists before talking to LS — clearer
  // error than letting MCP report "Package not found at path".
  try {
    await stat(LENSDESIGNER_PACK_PATH);
  } catch {
    throw new Error(
      `LensDesigner pack not vendored at ${LENSDESIGNER_PACK_PATH} — ` +
        `expected bridge/assets/LensDesigner.lspkg`,
    );
  }

  const existing = await listInstalledPackages(client);
  if (existing.some((p) => p.id === LENSDESIGNER_PACK_UUID)) {
    return { installed: false, packUUID: LENSDESIGNER_PACK_UUID };
  }

  // S1 finding: InstallLensStudioPackage rejects `file://` URIs. Use the
  // plain absolute path.
  await installPackage(client, LENSDESIGNER_PACK_PATH);
  return { installed: true, packUUID: LENSDESIGNER_PACK_UUID };
}

/**
 * Read a packed asset's content out of the bundled `.lspkg` zip.
 *
 * When MCP installs the package, files like `LensDesignerRoundedRect.mat`
 * live inside the .lspkg (locked install) — MCP's `ReadWriteTextFile`
 * can't see them and reports "Does not exist" against the loose path
 * `Assets/LensDesigner/<name>`. Material-duplication in the applier
 * falls back to this helper to read the template content from the
 * bundled .lspkg directly.
 *
 * `sourceRelPath` is the project-relative path the manifests use,
 * e.g. `'LensDesigner/LensDesignerRoundedRect.mat'`. Inside the
 * `.lspkg` zip, the asset lives at `Package/Assets/<filename>` — we
 * map by stripping the leading `LensDesigner/` segment and prepending
 * `Package/Assets/`.
 */
export async function readPackedAsset(sourceRelPath: string): Promise<string> {
  // Strip the leading "LensDesigner/" segment (manifests use it; the
  // .lspkg's internal layout is Package/Assets/<name>).
  const tail = sourceRelPath.replace(/^LensDesigner\//, '');
  const insideZipPath = `Package/Assets/${tail}`;
  try {
    const { stdout } = await execFileAsync(
      'unzip',
      ['-p', LENSDESIGNER_PACK_PATH, insideZipPath],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  } catch (err) {
    throw new Error(
      `failed to read ${insideZipPath} from ${LENSDESIGNER_PACK_PATH}: ${
        (err as Error).message
      }`,
    );
  }
}

/**
 * Binary variant of `readPackedAsset` for fonts + other non-text files.
 * Uses `unzip -p`'s binary stdout via execFile's `encoding: 'buffer'`.
 */
export async function readPackedAssetBytes(filename: string): Promise<Buffer> {
  const insideZipPath = `Package/Assets/${filename}`;
  return new Promise((resolveP, rejectP) => {
    execFile(
      'unzip',
      ['-p', LENSDESIGNER_PACK_PATH, insideZipPath],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        if (err) {
          rejectP(
            new Error(
              `failed to read ${insideZipPath} from ${LENSDESIGNER_PACK_PATH}: ${err.message}`,
            ),
          );
          return;
        }
        resolveP(stdout as Buffer);
      },
    );
  });
}

/**
 * Map a built-in font name (e.g. `'LibreBaskerville'`) to the .ttf
 * filename inside the bundled .lspkg. Returns null if no mapping
 * exists.
 */
export function packedFontFilename(fontName: string): string | null {
  // The .lspkg ships fonts as Package/Assets/LDFont_<Name>.ttf.
  const mapping: Record<string, string> = {
    LibreBaskerville: 'LDFont_LibreBaskerville.ttf',
    CutiveMono: 'LDFont_CutiveMono.ttf',
    Merriweather: 'LDFont_Merriweather.ttf',
  };
  return mapping[fontName] ?? null;
}
