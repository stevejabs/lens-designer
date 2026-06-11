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

import { readdir, stat } from 'node:fs/promises';
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
