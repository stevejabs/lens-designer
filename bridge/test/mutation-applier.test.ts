// Phase 1 — mutation applier (design tree → MCP calls).
// Plan steps D1–D4. Phase 1 implementation is teardown-and-rebuild
// (cheap diffing arrives in Phase 2).
//
// These are pure-logic tests: resolveMappingValue + ApplyNodeError.
// End-to-end against a mocked McpClient lives in
// integration/tree-apply.test.ts (real LS) and the in-process mock
// tests below for the orchestration.

import { describe, expect, test } from 'vitest';
import { _internals, ApplyNodeError, LAYER_DZ } from '../src/applier.ts';
import type { PropertyMapping } from '../src/manifests/types.ts';

const { resolveMappingValue } = _internals;

describe('resolveMappingValue — transform targets', () => {
  test('position vec2 → vec3 injects layerZ from the resolve context', () => {
    const m: PropertyMapping = {
      source: 'position',
      target: 'localTransform.position',
      valueType: 'vec3',
      transform: 'cm-to-units',
    };
    const v = resolveMappingValue(m, { x: 3, y: -2 }, { layerZ: -0.005, opacity: 1, sizeCm: null });
    expect(v).toEqual({ x: 3, y: -2, z: -0.005 });
  });

  test('rotation number → vec3 Euler around Z (degrees — LS editor uses degrees)', () => {
    const m: PropertyMapping = {
      source: 'rotation',
      target: 'localTransform.rotation',
      valueType: 'vec3',
      transform: 'deg-to-rad',
    };
    // LS's editor localTransform.rotation Euler is in DEGREES, so the
    // applier passes the designer's degree value through unchanged (the
    // deg-to-rad transform on the mapping is intentionally ignored for this
    // target — see resolveMappingValue's localTransform.rotation case).
    const v = resolveMappingValue(m, 90, { layerZ: 0, opacity: 1, sizeCm: null }) as { x: number; y: number; z: number };
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(90);
  });

  test('scale vec2 → vec3 with z=1 (uniform along z)', () => {
    const m: PropertyMapping = {
      source: 'size',
      target: 'localTransform.scale',
      valueType: 'vec3',
      transform: 'cm-to-units',
    };
    const v = resolveMappingValue(m, { x: 8, y: 4 }, { layerZ: -0.01, opacity: 1, sizeCm: null });
    // z is forced to 1 — layerZ does NOT bleed into scale.
    expect(v).toEqual({ x: 8, y: 4, z: 1 });
  });
});

describe('resolveMappingValue — scalar transforms', () => {
  test('cm-to-units passes through (Spectacles 1 cm = 1 unit today)', () => {
    const m: PropertyMapping = {
      source: 'size',
      target: 'size',
      valueType: 'number',
      transform: 'cm-to-units',
    };
    expect(resolveMappingValue(m, 1.25, { layerZ: 0, opacity: 1, sizeCm: null })).toBe(1.25);
  });

  test('deg-to-rad converts degrees to radians', () => {
    const m: PropertyMapping = {
      source: 'rotation',
      target: 'someAngle',
      valueType: 'number',
      transform: 'deg-to-rad',
    };
    expect(resolveMappingValue(m, 180, { layerZ: 0, opacity: 1, sizeCm: null })).toBeCloseTo(Math.PI, 10);
  });

  test('percent-to-01 normalizes 0–100 to 0–1', () => {
    const m: PropertyMapping = {
      source: 'opacity',
      target: 'opacity',
      valueType: 'number',
      transform: 'percent-to-01',
    };
    expect(resolveMappingValue(m, 50, { layerZ: 0, opacity: 1, sizeCm: null })).toBe(0.5);
    expect(resolveMappingValue(m, 0, { layerZ: 0, opacity: 1, sizeCm: null })).toBe(0);
    expect(resolveMappingValue(m, 100, { layerZ: 0, opacity: 1, sizeCm: null })).toBe(1);
  });

  test('identity transform is a passthrough', () => {
    const m: PropertyMapping = {
      source: 'text',
      target: 'text',
      valueType: 'string',
      transform: 'identity',
    };
    expect(resolveMappingValue(m, 'Hello', { layerZ: 0, opacity: 1, sizeCm: null })).toBe('Hello');
  });
});

describe('resolveMappingValue — rgb-to-vec4 with opacity blending', () => {
  const colorMapping: PropertyMapping = {
    source: 'fillColor',
    target: 'mainPass.baseColor',
    valueType: 'vec4',
    transform: 'rgb-to-vec4',
  };

  test('RGBA (255, alpha 100, opacity 1.0) → vec4 (1, 1, 1, 1)', () => {
    const v = resolveMappingValue(
      colorMapping,
      { r: 255, g: 255, b: 255, a: 100 },
      { layerZ: 0, opacity: 1, sizeCm: null },
    );
    expect(v).toEqual({ x: 1, y: 1, z: 1, w: 1 });
  });

  test('node opacity blends multiplicatively into alpha', () => {
    const v = resolveMappingValue(
      colorMapping,
      { r: 0, g: 0, b: 0, a: 100 },
      { layerZ: 0, opacity: 0.5, sizeCm: null },
    ) as { x: number; y: number; z: number; w: number };
    expect(v.w).toBeCloseTo(0.5, 10);
  });

  test('color alpha < 100 stacks with node opacity', () => {
    const v = resolveMappingValue(
      colorMapping,
      { r: 0, g: 0, b: 0, a: 50 },
      { layerZ: 0, opacity: 0.5, sizeCm: null },
    ) as { x: number; y: number; z: number; w: number };
    // 50% * 50% = 25%
    expect(v.w).toBeCloseTo(0.25, 10);
  });

  test('rgb channels normalize 0–255 → 0–1', () => {
    const v = resolveMappingValue(
      colorMapping,
      { r: 0xc2, g: 0xd4, b: 0xff, a: 100 },
      { layerZ: 0, opacity: 1, sizeCm: null },
    ) as { x: number; y: number; z: number; w: number };
    expect(v.x).toBeCloseTo(0xc2 / 255, 10);
    expect(v.y).toBeCloseTo(0xd4 / 255, 10);
    expect(v.z).toBeCloseTo(0xff / 255, 10);
    expect(v.w).toBe(1);
  });
});

describe('resolveMappingValue — invalid inputs', () => {
  test('throws if position source is not a vec2', () => {
    const m: PropertyMapping = {
      source: 'position',
      target: 'localTransform.position',
      valueType: 'vec3',
      transform: 'cm-to-units',
    };
    expect(() => resolveMappingValue(m, 'not-a-vec', { layerZ: 0, opacity: 1, sizeCm: null })).toThrow(TypeError);
  });

  test('throws if rotation source is not a number', () => {
    const m: PropertyMapping = {
      source: 'rotation',
      target: 'localTransform.rotation',
      valueType: 'vec3',
      transform: 'deg-to-rad',
    };
    expect(() => resolveMappingValue(m, { x: 1, y: 2 }, { layerZ: 0, opacity: 1, sizeCm: null })).toThrow(TypeError);
  });

  test('throws if rgb-to-vec4 source is not an RGBA shape', () => {
    const m: PropertyMapping = {
      source: 'fillColor',
      target: 'mainPass.baseColor',
      valueType: 'vec4',
      transform: 'rgb-to-vec4',
    };
    expect(() => resolveMappingValue(m, '#ff0000', { layerZ: 0, opacity: 1, sizeCm: null })).toThrow(TypeError);
  });
});

describe('ApplyNodeError', () => {
  test('preserves nodeId, propertyPath, lsError for design.error reply', () => {
    const err = new ApplyNodeError(
      'something failed',
      'rect-42',
      'mainPass.baseColor',
      'LS rejected vec4 with NaN component',
    );
    expect(err.name).toBe('ApplyNodeError');
    expect(err.nodeId).toBe('rect-42');
    expect(err.propertyPath).toBe('mainPass.baseColor');
    expect(err.lsError).toContain('NaN');
  });

  test('LAYER_DZ is the documented on-device-verified constant', () => {
    expect(LAYER_DZ).toBe(0.1);
  });
});

// --- Reconcile shape matcher (project-document model) ---------------------
// structurallyMatches gates the in-place reconcile: true → property-only edit,
// reconcile onto existing SceneObjects (preserve UUIDs + wiring); false →
// structure changed, fall back to rebuild.
import type { DesignNode } from '../src/protocol.ts';
import { _internals as _ap } from '../src/applier.ts';

const { structurallyMatches } = _ap;

function dnode(type: string, children: DesignNode[] = []): DesignNode {
  return {
    id: `${type}-${Math.round(children.length)}-${children.map((c) => c.type).join('')}` || type,
    type,
    name: type,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    properties: {},
    children,
  };
}
// LSSceneObject-shaped fixture; `comps` are component NAMES present on the SO.
function lso(comps: string[], children: any[] = []): any {
  return {
    id: `so-${comps.join('-')}-${children.length}`,
    name: 'so',
    components: comps.map((name, i) => ({ id: `c${i}`, name, enabled: true, properties: {} })),
    children,
  };
}

describe('structurallyMatches — reconcile gate', () => {
  test('a Group{Text, Rectangle} matches its realized scene subtree', () => {
    const tree = [dnode('Group', [dnode('Text'), dnode('Rectangle')])];
    const scene = [lso(['Interactable', 'PinchButton'], [lso(['Text']), lso(['Image'])])];
    expect(structurallyMatches(tree, scene)).toBe(true);
  });

  test('extra foreign components on a node do not break the match', () => {
    const tree = [dnode('Rectangle')];
    const scene = [lso(['Image', 'Interactable', 'BookItem'])]; // controller + SIK present
    expect(structurallyMatches(tree, scene)).toBe(true);
  });

  test('child-count mismatch → false (structural change)', () => {
    const tree = [dnode('Group', [dnode('Text'), dnode('Rectangle')])];
    const scene = [lso([], [lso(['Text'])])]; // one child fewer
    expect(structurallyMatches(tree, scene)).toBe(false);
  });

  test('missing the expected visual component → false', () => {
    const tree = [dnode('Text')];
    const scene = [lso(['Image'])]; // Text node but only an Image component
    expect(structurallyMatches(tree, scene)).toBe(false);
  });

  test('a Group needs no specific component (SceneObject kind)', () => {
    const tree = [dnode('Group', [])];
    const scene = [lso([])]; // bare SO, no components
    expect(structurallyMatches(tree, scene)).toBe(true);
  });

  test('unknown primitive type → false (never risk an in-place write)', () => {
    const tree = [dnode('Doughnut')];
    const scene = [lso(['Image'])];
    expect(structurallyMatches(tree, scene)).toBe(false);
  });

  test('top-level count mismatch → false', () => {
    expect(structurallyMatches([dnode('Rectangle')], [])).toBe(false);
    expect(structurallyMatches([], [lso(['Image'])])).toBe(false);
  });
});
