// fonts-system.ts — enumerate fonts installed on the host OS.
//
// Lens Studio imports .ttf and .otf; .ttc (TrueType Collection) and
// .woff2 are filesystem-walked but skipped because LS won't import
// them on 5.15.4. Spectacles renders whatever LS can import — no
// additional restriction is needed.
//
// Family name source: the font file's `name` table is the authoritative
// answer but parsing it from JS adds a dep. For MVP we use the filename
// (minus extension) and let the user disambiguate visually. The dropdown
// already groups by family-as-typed so two faces of the same family
// (`Helvetica-Bold.ttf`, `Helvetica.ttf`) just appear as two entries —
// good enough until users complain.
//
// Platform branching is local to this module: the bridge's external API
// is platform-blind (callers just see `listSystemFonts()`). Lens
// Designer's TD-15 abstraction rule is specifically about the
// capture-addon — system fonts are a separate surface that doesn't yet
// warrant a native addon. macOS is implemented; Windows + Linux return
// [] for now (TODO: walk `%WINDIR%/Fonts`, `~/.local/share/fonts`).

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { extname, join } from 'node:path';

export interface SystemFont {
  /** Display name. Filename minus extension for now. */
  family: string;
  /** Absolute path. Bridge validates this is under a known font dir
   *  before reading bytes — see `fontPathIsTrusted`. */
  file: string;
  ext: 'ttf' | 'otf';
}

/** Trusted source dirs per platform. Reads are refused outside these. */
function fontDirs(): string[] {
  if (platform() === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/Library/Fonts',
      join(homedir(), 'Library', 'Fonts'),
    ];
  }
  if (platform() === 'win32') {
    // TODO: Windows. %WINDIR%\Fonts + %LOCALAPPDATA%\Microsoft\Windows\Fonts.
    return [];
  }
  // Linux + others: TODO. Common dirs: /usr/share/fonts, /usr/local/share/fonts, ~/.local/share/fonts.
  return [];
}

/**
 * True iff `absPath` resolves under one of the trusted font dirs. Used
 * to refuse `fonts.add-from-system` calls that pass arbitrary paths
 * (path-traversal defense — the protocol takes a path string from the
 * client and we read its bytes).
 */
export function fontPathIsTrusted(absPath: string): boolean {
  // Normalize trailing slash so comparisons aren't fooled by /Library/Fonts
  // vs /Library/Fonts/.
  const dirs = fontDirs().map((d) => (d.endsWith('/') ? d : d + '/'));
  return dirs.some((d) => absPath === d.slice(0, -1) || absPath.startsWith(d));
}

async function* walkFontFiles(dir: string): AsyncIterable<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    let s;
    try {
      s = await stat(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      yield* walkFontFiles(p);
    } else if (s.isFile() && /\.(ttf|otf)$/i.test(name)) {
      yield p;
    }
  }
}

export async function listSystemFonts(): Promise<SystemFont[]> {
  const seenFiles = new Set<string>();
  const out: SystemFont[] = [];
  for (const dir of fontDirs()) {
    for await (const file of walkFontFiles(dir)) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      const base = file.split('/').pop()!;
      const family = base.replace(/\.(ttf|otf)$/i, '');
      const ext = extname(base).slice(1).toLowerCase() as 'ttf' | 'otf';
      out.push({ family, file, ext });
    }
  }
  // Sort alphabetically, case-insensitive — matches the dropdown.
  out.sort((a, b) =>
    a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }),
  );
  return out;
}

// ---- project-font ⇄ system-font reconciliation --------------------------
//
// A font ingested into a project is written as `font_<hash>.ttf`, where
// `<hash>` is `sha256(bytes)[:16]` (see `ingestFontBytes` in mcp.ts). The
// filename is the ONLY on-disk record of the font — its display name lives
// solely in the renderer's persisted `customFonts` store. So a prior project
// opened on a fresh browser / another machine has font files with no
// recoverable identity. When the same font is installed on this host, hashing
// the system file's bytes reproduces `<hash>` deterministically, recovering
// the family name. That's what these helpers do.

/** A project font matched back to an installed system font. */
export interface ProjectFontMatch {
  /** Project font basename (`font_<hash>.ttf`). */
  file: string;
  /** Sandbox-relative path for the renderer's `addCustomFont` / FontFace load. */
  path: string;
  /** CSS family token (`ldfont-<hash>`) — the same one the add/upload flows mint. */
  family: string;
  /** Recovered display label (the matched system font's family). */
  name: string;
}

/** Content-hash length that `ingestFontBytes` uses for the filename. */
const FONT_HASH_LEN = 16;
const PROJECT_FONT_RE = /^font_([a-f0-9]+)\.(ttf|otf)$/i;

/**
 * Extract the content hash from a project font basename, or null if the name
 * isn't an ingested `font_<hash>.<ext>` file (e.g. a packaged `LDFont_*` preset,
 * which is referenced by name, not path).
 */
export function projectFontHash(basename: string): string | null {
  const m = PROJECT_FONT_RE.exec(basename);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Pure matcher (no IO) — pairs wanted project files against pre-hashed system
 * fonts by content hash. Split out from the IO so it's unit-testable. First
 * system font to match a given hash wins (system list is de-duped by path).
 */
export function pickProjectFontMatches(
  wantedFiles: string[],
  hashedSystemFonts: Array<{ family: string; hash: string }>,
): ProjectFontMatch[] {
  // hash → the project basename that wants it.
  const wanted = new Map<string, string>();
  for (const file of wantedFiles) {
    const hash = projectFontHash(file);
    if (hash) wanted.set(hash, file);
  }
  const matches: ProjectFontMatch[] = [];
  for (const sys of hashedSystemFonts) {
    const file = wanted.get(sys.hash);
    if (!file) continue;
    matches.push({
      file,
      path: `LensDesigner/fonts/${file}`,
      family: `ldfont-${sys.hash}`,
      name: sys.family,
    });
    wanted.delete(sys.hash); // first match wins; stop looking for this hash
    if (wanted.size === 0) break;
  }
  return matches;
}

// Cache system-font hashes across attaches, keyed by path + mtime + size so an
// edited/replaced font re-hashes but the common case (stable OS fonts) is read
// once per bridge lifetime. Hashing every OS font on each attach would be
// needless IO.
const systemFontHashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

/** sha256(file bytes)[:FONT_HASH_LEN], mirroring `ingestFontBytes`. Cached. */
async function hashSystemFontFile(absPath: string): Promise<string | null> {
  try {
    const s = await stat(absPath);
    const cached = systemFontHashCache.get(absPath);
    if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) return cached.hash;
    const bytes = await readFile(absPath);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, FONT_HASH_LEN);
    systemFontHashCache.set(absPath, { mtimeMs: s.mtimeMs, size: s.size, hash });
    return hash;
  } catch {
    return null; // unreadable / vanished — skip it
  }
}

/**
 * Match the given project font files against installed system fonts by content
 * hash, recovering each match's display name. Only hashes system fonts until
 * every wanted file is matched (early exit), so a fully-resolved project costs
 * one directory walk and no reads. Returns matches for whatever resolved;
 * unmatched files (font not installed here, or a non-system upload) are omitted.
 */
export async function matchProjectFontsToSystem(
  wantedFiles: string[],
): Promise<ProjectFontMatch[]> {
  const wantedHashes = new Set<string>();
  for (const file of wantedFiles) {
    const hash = projectFontHash(file);
    if (hash) wantedHashes.add(hash);
  }
  if (wantedHashes.size === 0) return [];

  const systemFonts = await listSystemFonts();
  const hashed: Array<{ family: string; hash: string }> = [];
  const remaining = new Set(wantedHashes);
  for (const sys of systemFonts) {
    const hash = await hashSystemFontFile(sys.file);
    if (hash === null) continue;
    hashed.push({ family: sys.family, hash });
    if (remaining.delete(hash) && remaining.size === 0) break; // all found — stop reading
  }
  return pickProjectFontMatches(wantedFiles, hashed);
}
