import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { runScriptMesh } from '@/lib/v2/script-mesh/runtime';

// A representative scripted mesh: two nested boxes with a recolorable cover —
// the same shim surface a CLAD code-authored mesh (Book.ts) exercises.
const BOX_SCRIPT = `
@component
export class Crate extends BaseScriptComponent {
  @input
  @widget(new ColorWidget())
  coverColor: vec4 = new vec4(0.12, 0.20, 0.45, 1.0);

  onAwake(): void {
    const mat = requireAsset("../Materials/Surface.mat") as Material;
    const obj = global.scene.createSceneObject("Box");
    obj.setParent(this.sceneObject);
    const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    rmv.mesh = this.box(2.0, 10.5, 7.5);
    const m = mat.clone() as Material;
    m.mainPass.baseColor = this.coverColor;
    m.mainPass.roughness = 0.55;
    rmv.mainMaterial = m;
  }

  private box(hw: number, hh: number, hd: number): RenderMesh {
    const b = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3, normalized: true },
      { name: "texture0", components: 2 },
    ]);
    b.topology = MeshTopology.Triangles;
    b.indexType = MeshIndexType.UInt16;
    const v: number[] = [];
    const i: number[] = [];
    let vi = 0;
    const x0 = -hw, x1 = hw, y0 = -hh, y1 = hh, z0 = -hd, z1 = hd;
    const face = (p0: number[], p1: number[], p2: number[], p3: number[], n: number[]) => {
      v.push(...p0, ...n, 0, 0, ...p1, ...n, 0, 1, ...p2, ...n, 1, 1, ...p3, ...n, 1, 0);
      i.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    };
    face([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1],[1,0,0]);
    face([x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0],[-1,0,0]);
    face([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[0,1,0]);
    face([x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[0,-1,0]);
    face([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]);
    face([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]);
    b.appendVerticesInterleaved(v);
    b.appendIndices(i);
    const mesh = b.getMesh();
    b.updateMesh();
    return mesh;
  }
}
`;

function bbox(positions: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i + k]!);
      max[k] = Math.max(max[k]!, positions[i + k]!);
    }
  }
  return { min, max };
}

describe('runScriptMesh', () => {
  it('extracts box geometry, color, and bbox from a scripted mesh', () => {
    const d = runScriptMesh(BOX_SCRIPT);
    expect(d.ok).toBe(true);
    expect(d.meshes).toHaveLength(1);
    const m = d.meshes[0]!;
    expect(m.positions.length).toBe(72); // 24 verts * 3
    expect(m.indices.length).toBe(36); // 12 triangles
    // recolorable cover color survived the clone + assignment
    expect(m.baseColor[0]).toBeCloseTo(0.12);
    expect(m.baseColor[2]).toBeCloseTo(0.45);
    expect(m.roughness).toBeCloseTo(0.55);
    const bb = bbox(m.positions);
    expect(bb.min).toEqual([-2, -10.5, -7.5]);
    expect(bb.max).toEqual([2, 10.5, 7.5]);
  });

  it('reports an error (for fallback) when there is no geometry', () => {
    const d = runScriptMesh('export class X extends BaseScriptComponent { onAwake() {} }');
    expect(d.ok).toBe(false);
    expect(d.error).toBeTruthy();
  });

  // Best-effort: if the real Book.ts is present, it should render natively too.
  const bookPath = '/Users/jabsbot/Developer/specs/ld-bookshelf-app/Assets/Scripts/Book.ts';
  it.skipIf(!existsSync(bookPath))('renders the real Book.ts natively', () => {
    const d = runScriptMesh(readFileSync(bookPath, 'utf8'));
    expect(d.ok).toBe(true);
    expect(d.meshes.length).toBeGreaterThanOrEqual(2); // cover + pages
  });
});
