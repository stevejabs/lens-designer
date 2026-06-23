import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, listVersions, restoreVersion } from '../src/services/versions.js';

let proj: string;
let asset: string;

beforeEach(async () => {
  proj = await mkdtemp(join(tmpdir(), 'ld-ver-'));
  await mkdir(join(proj, 'Assets'), { recursive: true });
  asset = join(proj, 'Assets', 'Ghost.glb');
  await writeFile(asset, 'v1-bytes');
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true });
});

describe('versions', () => {
  it('snapshots, lists, and restores prior bytes', async () => {
    await snapshot(proj, asset, 1000);
    await writeFile(asset, 'v2-bytes'); // simulate a refine overwriting in place

    const versions = await listVersions(proj, asset);
    expect(versions.length).toBe(1);
    expect(versions[0]?.createdMs).toBe(1000);

    const res = await restoreVersion(proj, asset, versions[0]!.id, 2000);
    expect(res.ok).toBe(true);
    expect(await readFile(asset, 'utf8')).toBe('v1-bytes');
  });

  it('restore snapshots the current state first (rollback is reversible)', async () => {
    await snapshot(proj, asset, 1000); // v1 captured
    await writeFile(asset, 'v2-bytes');
    const [v1] = await listVersions(proj, asset);
    await restoreVersion(proj, asset, v1!.id, 2000); // captures v2, restores v1

    const after = await listVersions(proj, asset);
    expect(after.length).toBe(2); // v1 + the v2 captured during restore
  });

  it('stores snapshots outside Assets/ so LS never imports them', async () => {
    await snapshot(proj, asset, 1000);
    const { listAssetFiles } = await import('../src/services/assets.js');
    const files = await listAssetFiles(proj);
    expect(files.some((f) => f.includes('.lensdesigner'))).toBe(false);
  });
});
