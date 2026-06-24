import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAssets } from '../src/services/assets.js';
import { buildScriptMeshRefinePrompt } from '../src/services/gen-prompt.js';

let proj: string;

const SCRIPT_MESH = `@component
export class Book extends BaseScriptComponent {
  onAwake() {
    const b = new MeshBuilder([{ name: "position", components: 3 }]);
    const rmv = this.sceneObject.createComponent("Component.RenderMeshVisual");
    rmv.mesh = b.getMesh();
  }
}`;

const UIKIT_VIEW = `import { Frame } from "SpectaclesUIKit/...";
@component
export class PanelUI extends BaseScriptComponent { onAwake() {} }`;

const PLAIN_SCRIPT = `@component
export class Helper extends BaseScriptComponent { onAwake() { print("hi"); } }`;

beforeEach(async () => {
  proj = await mkdtemp(join(tmpdir(), 'ld-scan-'));
  await mkdir(join(proj, 'Assets', 'Scripts'), { recursive: true });
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true });
});

describe('scanAssets — scripted meshes', () => {
  it('detects a code-authored mesh as a mesh asset with backend "script"', async () => {
    await writeFile(join(proj, 'Assets', 'Scripts', 'Book.ts'), SCRIPT_MESH);
    const assets = await scanAssets(proj);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ name: 'Book', kind: 'mesh', backend: 'script' });
  });

  it('does NOT treat a UIKit view or a plain script as a mesh asset', async () => {
    await writeFile(join(proj, 'Assets', 'PanelUI.ts'), UIKIT_VIEW);
    await writeFile(join(proj, 'Assets', 'Helper.ts'), PLAIN_SCRIPT);
    expect(await scanAssets(proj)).toHaveLength(0);
  });

  it('classifies a GLB as backend "glb" alongside a scripted mesh', async () => {
    await writeFile(join(proj, 'Assets', 'Scripts', 'Book.ts'), SCRIPT_MESH);
    await writeFile(join(proj, 'Assets', 'Tree.glb'), 'binary');
    const assets = await scanAssets(proj);
    const byName = Object.fromEntries(assets.map((a) => [a.name, a.backend]));
    expect(byName).toEqual({ Book: 'script', Tree: 'glb' });
  });
});

describe('buildScriptMeshRefinePrompt', () => {
  it('routes to an in-place code edit, not a GLB regeneration', () => {
    const p = buildScriptMeshRefinePrompt({
      artifactPath: '/proj/Assets/Scripts/Book.ts',
      userText: 'round the spine',
      priorPrompt: 'a hardcover book',
    });
    expect(p).toContain('/proj/Assets/Scripts/Book.ts');
    expect(p).toMatch(/Edit that TypeScript file in place/i);
    expect(p).toMatch(/do NOT replace it with a GLB/i);
    expect(p).toContain('a hardcover book');
  });
});
