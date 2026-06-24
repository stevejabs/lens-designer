// runtime.ts — render a CLAD code-authored ("scripted") mesh natively in
// three.js instead of round-tripping through the Lens Studio scene + a preview
// screenshot.
//
// A scripted mesh is a TypeScript BaseScriptComponent whose onAwake() builds
// geometry with MeshBuilder and assigns materials. We give that code the same
// Lens API surface it expects (a shim), run it, and record what it builds into
// a serializable SceneDescription the viewer turns into three.js meshes.
//
// Boundaries (fall back to the LS preview when hit): custom graph shaders,
// runtime animation/update loops, and Lens APIs outside the shimmed surface.
// For the common case — static SimplePBR / vertex-color parametric geometry —
// this is a fast, non-destructive native render.

import { transform } from 'sucrase';

export interface ScriptMeshGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  /** Column-major world matrix (16). */
  matrix: number[];
}

export interface SceneDescription {
  ok: boolean;
  meshes: ScriptMeshGeometry[];
  /** Non-fatal notes (e.g. a Text component we didn't render). */
  notes: string[];
  error?: string;
}

// ── minimal math (kept dependency-free so this runs in node tests too) ──
type Mat4 = number[];
const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}

function compose(p: Vec3, q: Quat, s: Vec3): Mat4 {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s.x, (xy + wz) * s.x, (xz - wy) * s.x, 0,
    (xy - wz) * s.y, (1 - (xx + zz)) * s.y, (yz + wx) * s.y, 0,
    (xz + wy) * s.z, (yz - wx) * s.z, (1 - (xx + yy)) * s.z, 0,
    p.x, p.y, p.z, 1,
  ];
}

// ── shim value types ──
class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  static forward(): Vec3 { return new Vec3(0, 0, 1); }
  static up(): Vec3 { return new Vec3(0, 1, 0); }
  static right(): Vec3 { return new Vec3(1, 0, 0); }
  static one(): Vec3 { return new Vec3(1, 1, 1); }
  static zero(): Vec3 { return new Vec3(0, 0, 0); }
}
class Vec4 {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}
class Quat {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  static angleAxis(angle: number, axis: Vec3): Quat {
    const h = angle / 2;
    const s = Math.sin(h);
    return new Quat(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }
  static quatIdentity(): Quat { return new Quat(); }
}

class Transform {
  position = new Vec3();
  rotation = new Quat();
  scale = new Vec3(1, 1, 1);
  setLocalPosition(v: Vec3): void { this.position = v; }
  setLocalRotation(q: Quat): void { this.rotation = q; }
  setLocalScale(v: Vec3): void { this.scale = v; }
  getLocalPosition(): Vec3 { return this.position; }
  local(): Mat4 { return compose(this.position, this.rotation, this.scale); }
}

interface MainPass {
  baseColor: Vec4;
  metallic: number;
  roughness: number;
}
class Material {
  mainPass: MainPass = { baseColor: new Vec4(0.8, 0.8, 0.8, 1), metallic: 0, roughness: 0.6 };
  clone(): Material {
    const m = new Material();
    m.mainPass = { baseColor: new Vec4(this.mainPass.baseColor.x, this.mainPass.baseColor.y, this.mainPass.baseColor.z, this.mainPass.baseColor.w), metallic: this.mainPass.metallic, roughness: this.mainPass.roughness };
    return m;
  }
}

class MeshBuilder {
  topology = 0;
  indexType = 0;
  private stride: number;
  private verts: number[] = [];
  private indices: number[] = [];
  constructor(public layout: { name: string; components: number }[]) {
    this.stride = layout.reduce((n, a) => n + a.components, 0);
  }
  appendVerticesInterleaved(arr: number[]): void { this.verts.push(...arr); }
  appendIndices(arr: number[]): void { this.indices.push(...arr); }
  appendVertices(rows: number[][]): void { for (const r of rows) this.verts.push(...r); }
  getMesh(): RenderMesh { return new RenderMesh(this); }
  updateMesh(): void {}
  extract(): { positions: number[]; normals: number[]; uvs: number[]; indices: number[] } {
    const off: Record<string, number> = {};
    let o = 0;
    for (const a of this.layout) { off[a.name] = o; o += a.components; }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const count = this.stride > 0 ? this.verts.length / this.stride : 0;
    for (let i = 0; i < count; i++) {
      const base = i * this.stride;
      const pi = off['position'];
      if (pi !== undefined) positions.push(this.verts[base + pi]!, this.verts[base + pi + 1]!, this.verts[base + pi + 2]!);
      const ni = off['normal'];
      if (ni !== undefined) normals.push(this.verts[base + ni]!, this.verts[base + ni + 1]!, this.verts[base + ni + 2]!);
      const ti = off['texture0'] ?? off['uv'];
      if (ti !== undefined) uvs.push(this.verts[base + ti]!, this.verts[base + ti + 1]!);
    }
    return { positions, normals, uvs, indices: this.indices.slice() };
  }
}
class RenderMesh {
  constructor(public builder: MeshBuilder) {}
}

class RenderMeshVisual {
  mesh: RenderMesh | null = null;
  mainMaterial: Material | null = null;
  setMaterialAt(): void {}
}
class TextComp {
  text = '';
  size = 32;
  depthTest = true;
  textFill = { color: new Vec4(1, 1, 1, 1) };
  horizontalAlignment = 0;
  verticalAlignment = 0;
}

let soSeq = 0;
class SceneObjectShim {
  id = ++soSeq;
  parent: SceneObjectShim | null = null;
  children: SceneObjectShim[] = [];
  enabled = true;
  private transform = new Transform();
  components: unknown[] = [];
  constructor(public name = '') {}
  setParent(p: SceneObjectShim | null): void {
    this.parent = p;
    if (p) p.children.push(this);
  }
  getParent(): SceneObjectShim | null { return this.parent; }
  getTransform(): Transform { return this.transform; }
  createComponent(type: string): unknown {
    const c = /Text/.test(type) ? new TextComp() : new RenderMeshVisual();
    this.components.push(c);
    return c;
  }
  worldMatrix(): Mat4 {
    const chain: SceneObjectShim[] = [];
    for (let n: SceneObjectShim | null = this; n; n = n.parent) chain.push(n);
    let m = IDENT;
    for (let i = chain.length - 1; i >= 0; i--) m = multiply(m, chain[i]!.getTransform().local());
    return m;
  }
}

class BaseScriptComponent {
  sceneObject = new SceneObjectShim('__root__');
  getSceneObject(): SceneObjectShim { return this.sceneObject; }
  createEvent(): { bind: (cb: () => void) => void } { return { bind: () => {} }; }
}

/** Strip Lens decorators (their own line) so the TS compiles without a
 *  decorator runtime; the decorated field's initializer is preserved. */
function stripDecorators(src: string): string {
  return src.replace(/^\s*@\w+(\([^\n]*\))?\s*$/gm, '');
}

function buildScope(record: SceneObjectShim[]): Record<string, unknown> {
  const rootObjects = record;
  const scene = {
    createSceneObject: (name: string): SceneObjectShim => {
      const o = new SceneObjectShim(name);
      rootObjects.push(o);
      return o;
    },
  };
  return {
    vec3: Vec3, vec4: Vec4, quat: Quat,
    MeshBuilder, RenderMesh,
    BaseScriptComponent,
    Material,
    global: { scene, deviceInfoSystem: { isEditor: (): boolean => true } },
    requireAsset: (): Material => new Material(),
    requireType: (): string => '',
    MeshTopology: { Triangles: 0, Lines: 1, Points: 2 },
    MeshIndexType: { UInt16: 0, UInt32: 1 },
    HorizontalAlignment: { Left: 0, Center: 1, Right: 2 },
    VerticalAlignment: { Top: 0, Center: 1, Bottom: 2 },
    // no-op decorators in case any survive stripping
    component: () => () => {}, input: () => {}, label: () => () => {},
    widget: () => () => {}, hint: () => () => {}, ui: () => () => {},
    ColorWidget: class {},
    print: () => {},
  };
}

/** Compile + run a scripted-mesh source and return its geometry. */
export function runScriptMesh(tsSource: string): SceneDescription {
  const notes: string[] = [];
  try {
    const stripped = stripDecorators(tsSource);
    const { code } = transform(stripped, {
      transforms: ['typescript', 'imports'],
      // CJS-style so `export class X` lands on `exports`.
    });
    const created: SceneObjectShim[] = [];
    const scope = buildScope(created);
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    // `require` returns the shim for any import (SpectaclesUIKit etc. won't be
    // a mesh script and will fail earlier; for mesh scripts imports are LS libs).
    const requireShim = (): Record<string, unknown> => scope;
    const keys = Object.keys(scope);
    const fn = new Function(
      'exports', 'module', 'require', ...keys,
      `"use strict";\n${code}\n`,
    );
    fn(exportsObj, moduleObj, requireShim, ...keys.map((k) => scope[k]));

    // Find the BaseScriptComponent subclass that was exported.
    const Cls = Object.values(exportsObj).find(
      (v) => typeof v === 'function' && v.prototype instanceof BaseScriptComponent,
    ) as (new () => BaseScriptComponent) | undefined;
    if (!Cls) return { ok: false, meshes: [], notes, error: 'no BaseScriptComponent class found' };

    const instance = new Cls();
    const awake = (instance as unknown as { onAwake?: () => void }).onAwake;
    if (typeof awake !== 'function') return { ok: false, meshes: [], notes, error: 'no onAwake()' };
    awake.call(instance);

    // Collect meshes from every created object + the instance's own tree.
    const roots = new Set<SceneObjectShim>([instance.sceneObject, ...created]);
    const meshes: ScriptMeshGeometry[] = [];
    const visit = (o: SceneObjectShim): void => {
      for (const c of o.components) {
        if (c instanceof RenderMeshVisual && c.mesh && c.mainMaterial) {
          const g = c.mesh.builder.extract();
          if (g.positions.length === 0) continue;
          const mp = c.mainMaterial.mainPass;
          meshes.push({
            ...g,
            baseColor: [mp.baseColor.x, mp.baseColor.y, mp.baseColor.z, mp.baseColor.w],
            metallic: mp.metallic,
            roughness: mp.roughness,
            matrix: o.worldMatrix(),
          });
        } else if (c instanceof TextComp) {
          notes.push(`text "${c.text}" not rendered natively`);
        }
      }
    };
    const seen = new Set<number>();
    const walk = (o: SceneObjectShim): void => {
      if (seen.has(o.id)) return;
      seen.add(o.id);
      visit(o);
      for (const ch of o.children) walk(ch);
    };
    for (const r of roots) walk(r);

    if (meshes.length === 0) return { ok: false, meshes: [], notes, error: 'no geometry produced' };
    return { ok: true, meshes, notes };
  } catch (err) {
    return { ok: false, meshes: [], notes, error: (err as Error).message };
  }
}
