// WB1b — shared resolveLSWrites resolver (TD-8). Pins the value engine + the
// per-state override resolution both the applier and the codegen consume.

import { describe, test, expect } from 'vitest';
import { resolveLSWrites, resolveMappingValue, type ResolveValueContext } from '../src/resolve-writes.ts';
import type { DesignNode, StateProps } from '../src/protocol.ts';

function rect(props: Record<string, unknown> = {}): DesignNode {
  return {
    id: 'r1',
    type: 'Rectangle',
    name: 'rect',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    properties: {
      size: { x: 8, y: 4 },
      opacity: 100,
      fillColor: { r: 255, g: 0, b: 0, a: 100 },
      strokeColor: { r: 0, g: 0, b: 0, a: 100 },
      strokeWidth: 0,
      ...props,
    },
    children: [],
  };
}

function text(props: Record<string, unknown> = {}): DesignNode {
  return {
    id: 't1',
    type: 'Text',
    name: 'text',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    properties: { size: { x: 20, y: 4 }, opacity: 100, text: 'hi', fillColor: { r: 0, g: 26, b: 59, a: 100 }, ...props },
    children: [],
  };
}

const ctx = (opacity = 1): ResolveValueContext => ({ layerZ: 0, opacity, sizeCm: { x: 8, y: 4 } });

describe('resolveMappingValue — value engine', () => {
  test('rgb-to-vec4 normalizes channels and folds opacity into alpha', () => {
    const m = { source: 'fillColor', target: 'mainMaterial.passInfos.0.baseColor', valueType: 'vec4', transform: 'rgb-to-vec4' } as const;
    const v = resolveMappingValue(m, { r: 255, g: 0, b: 0, a: 100 }, ctx(0.5)) as { x: number; w: number };
    expect(v.x).toBeCloseTo(1);
    expect(v.w).toBeCloseTo(0.5); // 100% * 0.5 opacity
  });

  test('localTransform.position injects layerZ', () => {
    const m = { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' } as const;
    const v = resolveMappingValue(m, { x: 2, y: 3 }, { layerZ: -0.1, opacity: 1, sizeCm: null }) as { z: number };
    expect(v.z).toBeCloseTo(-0.1);
  });

  test('cm-to-text-size scales by 40', () => {
    const m = { source: 'fontSize', target: 'size', valueType: 'number', transform: 'cm-to-text-size' } as const;
    expect(resolveMappingValue(m, 1, ctx())).toBe(40);
  });
});

describe('resolveLSWrites — per-state override resolution', () => {
  test('fillColor override → one fill vec4 write, alpha at base opacity', () => {
    const w = resolveLSWrites(rect(), { fillColor: { r: 0, g: 0, b: 255, a: 100 } });
    expect(w).toHaveLength(1);
    expect(w[0]!.channel).toBe('fill');
    expect(w[0]!.valueType).toBe('vec4');
    expect((w[0]!.value as { z: number; w: number }).z).toBeCloseTo(1);
    expect((w[0]!.value as { w: number }).w).toBeCloseTo(1);
  });

  test('state opacity folds into an explicit color override', () => {
    const w = resolveLSWrites(rect(), { fillColor: { r: 0, g: 0, b: 255, a: 100 }, opacity: 50 });
    expect((w.find((x) => x.channel === 'fill')!.value as { w: number }).w).toBeCloseTo(0.5);
  });

  test('opacity-only override re-emits the base fill color at the new alpha', () => {
    const w = resolveLSWrites(rect(), { opacity: 25 });
    const fill = w.find((x) => x.channel === 'fill');
    expect(fill).toBeDefined();
    expect((fill!.value as { x: number; w: number }).x).toBeCloseTo(1); // base red
    expect((fill!.value as { w: number }).w).toBeCloseTo(0.25);
  });

  test('stroke + strokeWidth → stroke vec4 + strokeThickness number', () => {
    const w = resolveLSWrites(rect(), { strokeColor: { r: 255, g: 255, b: 255, a: 100 }, strokeWidth: 0.2 });
    expect(w.find((x) => x.channel === 'stroke')?.valueType).toBe('vec4');
    const thick = w.find((x) => x.channel === 'strokeThickness');
    expect(thick?.value).toBeCloseTo(0.2); // cm-to-units passthrough
  });

  test('visible override → boolean write', () => {
    const w = resolveLSWrites(rect(), { visible: false } as StateProps);
    expect(w).toEqual([{ channel: 'visible', valueType: 'boolean', value: false }]);
  });

  test('Text textColor → textColor channel via the Text fillColor mapping', () => {
    const w = resolveLSWrites(text(), { textColor: { r: 244, g: 236, b: 216, a: 100 } });
    expect(w).toHaveLength(1);
    expect(w[0]!.channel).toBe('textColor');
    expect(w[0]!.valueType).toBe('vec4');
  });

  test('empty override → no writes', () => {
    expect(resolveLSWrites(rect(), {})).toEqual([]);
  });
});
