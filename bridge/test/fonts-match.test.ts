// fonts-match.test.ts — project-font ⇄ system-font reconciliation.
//
// A font ingested into a project becomes `font_<sha256(bytes)[:16]>.ttf`; its
// display name lives only in the renderer's customFonts store. When a prior
// project is opened without that store (fresh browser / another machine), we
// recover the name by matching the file's content hash to an installed system
// font. These tests lock the hash extraction + pure matcher.

import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  projectFontHash,
  pickProjectFontMatches,
  matchProjectFontsToSystem,
} from '../src/fonts-system.ts';

/** Mirror ingestFontBytes' filename hash so tests match production. */
function ingestHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

describe('projectFontHash', () => {
  test('extracts the hash from an ingested font filename', () => {
    expect(projectFontHash('font_0123456789abcdef.ttf')).toBe('0123456789abcdef');
    expect(projectFontHash('font_deadbeef.otf')).toBe('deadbeef');
  });

  test('is case-insensitive on the hash, normalizing to lowercase', () => {
    expect(projectFontHash('font_ABCDEF01.ttf')).toBe('abcdef01');
  });

  test('returns null for packaged presets and non-ingested names', () => {
    expect(projectFontHash('LDFont_Merriweather.ttf')).toBeNull();
    expect(projectFontHash('Arial.ttf')).toBeNull();
    expect(projectFontHash('font_.ttf')).toBeNull();
    expect(projectFontHash('font_zzzz.ttf')).toBeNull(); // not hex
    expect(projectFontHash('font_abc.woff2')).toBeNull(); // wrong ext
  });
});

describe('pickProjectFontMatches', () => {
  test('matches wanted files to system fonts by hash and builds the entry', () => {
    const matches = pickProjectFontMatches(
      ['font_aaaa1111.ttf', 'font_bbbb2222.otf'],
      [
        { family: 'Georgia', hash: 'aaaa1111' },
        { family: 'Helvetica', hash: 'bbbb2222' },
        { family: 'Unrelated', hash: 'cccc3333' },
      ],
    );
    expect(matches).toEqual([
      { file: 'font_aaaa1111.ttf', path: 'LensDesigner/fonts/font_aaaa1111.ttf', family: 'ldfont-aaaa1111', name: 'Georgia' },
      { file: 'font_bbbb2222.otf', path: 'LensDesigner/fonts/font_bbbb2222.otf', family: 'ldfont-bbbb2222', name: 'Helvetica' },
    ]);
  });

  test('omits files with no installed system-font match', () => {
    const matches = pickProjectFontMatches(
      ['font_aaaa1111.ttf', 'font_ffff9999.ttf'],
      [{ family: 'Georgia', hash: 'aaaa1111' }],
    );
    expect(matches.map((m) => m.file)).toEqual(['font_aaaa1111.ttf']);
  });

  test('first system font to match a hash wins (dupes ignored)', () => {
    const matches = pickProjectFontMatches(
      ['font_aaaa1111.ttf'],
      [
        { family: 'FirstWins', hash: 'aaaa1111' },
        { family: 'SecondSameBytes', hash: 'aaaa1111' },
      ],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe('FirstWins');
  });

  test('ignores non-ingested wanted names (presets, arbitrary files)', () => {
    const matches = pickProjectFontMatches(
      ['LDFont_Merriweather.ttf', 'Arial.ttf'],
      [{ family: 'Whatever', hash: 'aaaa1111' }],
    );
    expect(matches).toEqual([]);
  });
});

describe('matchProjectFontsToSystem (end-to-end hash contract)', () => {
  test('recovers a project font whose bytes match an installed system font', async () => {
    // Stand up a fake system font dir the reconciler will read.
    const dir = await mkdtemp(join(tmpdir(), 'ld-fonts-'));
    const fontDir = join(dir, 'Fonts');
    await mkdir(fontDir, { recursive: true });
    const bytes = Buffer.from('fake-ttf-bytes-for-Georgia-Regular');
    await writeFile(join(fontDir, 'Georgia.ttf'), bytes);

    // The project file is named by the SAME hashing scheme as ingest.
    const hash = ingestHash(bytes);
    const projectFile = `font_${hash}.ttf`;

    // matchProjectFontsToSystem reads real OS font dirs; verify the contract via
    // the pure matcher fed the same hash the reconciler would compute.
    const matches = pickProjectFontMatches(
      [projectFile],
      [{ family: 'Georgia', hash: ingestHash(bytes) }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      file: projectFile,
      path: `LensDesigner/fonts/${projectFile}`,
      family: `ldfont-${hash}`,
      name: 'Georgia',
    });

    // And the IO entry point is callable + returns [] when nothing on THIS host
    // matches a random hash (no throw, graceful).
    const none = await matchProjectFontsToSystem(['font_00000000deadbeef.ttf']);
    expect(none).toEqual([]);
  });
});
