import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotAssets, detectCreated, reconcileRefine } from '../src/services/asset-watch.js';

let proj: string;
let assets: string;

beforeEach(async () => {
  proj = await mkdtemp(join(tmpdir(), 'ld-watch-'));
  assets = join(proj, 'Assets');
  await mkdir(assets, { recursive: true });
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true });
});

describe('detectCreated', () => {
  it('finds a newly generated asset of the requested kind', async () => {
    const before = await snapshotAssets(proj);
    await writeFile(join(assets, 'NewGhost.glb'), 'bytes');
    const created = await detectCreated(proj, before, 'mesh');
    expect(created).toBe(join(assets, 'NewGhost.glb'));
  });
});

describe('reconcileRefine', () => {
  it('reports in-place when the canonical file itself was overwritten', async () => {
    const canonical = join(assets, 'Ghost.glb');
    await writeFile(canonical, 'old');
    const before = await snapshotAssets(proj);
    // Ensure a detectable mtime bump.
    await new Promise((r) => setTimeout(r, 5));
    await writeFile(canonical, 'new-bigger-bytes');
    const res = await reconcileRefine(proj, canonical, before);
    expect(res.replaced).toBe(true);
    expect(res.note).toMatch(/in place/);
  });

  it('moves a stray duplicate onto the canonical path (replace, not duplicate)', async () => {
    const canonical = join(assets, 'Ghost.glb');
    await writeFile(canonical, 'old');
    const before = await snapshotAssets(proj);
    // Generator ignored the path and wrote a sibling instead.
    await writeFile(join(assets, 'Ghost 2.glb'), 'regenerated');
    const res = await reconcileRefine(proj, canonical, before);
    expect(res.replaced).toBe(true);

    const { readFile, readdir } = await import('node:fs/promises');
    expect(await readFile(canonical, 'utf8')).toBe('regenerated');
    const left = await readdir(assets);
    expect(left).toEqual(['Ghost.glb']); // the stray is gone
    await stat(canonical); // still exists
  });

  it('leaves both files when the result is ambiguous', async () => {
    const canonical = join(assets, 'Ghost.glb');
    await writeFile(canonical, 'old');
    const before = await snapshotAssets(proj);
    await writeFile(join(assets, 'Ghost 2.glb'), 'a');
    await writeFile(join(assets, 'Ghost 3.glb'), 'b');
    const res = await reconcileRefine(proj, canonical, before);
    expect(res.replaced).toBe(false);
    expect(res.note).toMatch(/ambiguous/);
  });
});
