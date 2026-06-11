// WB2 — resolveForState preview merge.

import { describe, test, expect } from 'vitest';
import { resolveForState } from '@/lib/resolve-state';
import type { DesignNode } from '@lens-designer/bridge/client';

function node(over?: DesignNode['stateOverrides']): DesignNode {
  return {
    id: 'n', type: 'Rectangle', name: 'r',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    properties: { position: { x: 10, y: 5 }, size: { x: 8, y: 4 }, opacity: 100, fillColor: { r: 1, g: 2, b: 3, a: 100 } },
    stateOverrides: over,
    children: [],
  };
}

describe('resolveForState', () => {
  test('default returns the node unchanged (identity)', () => {
    const n = node({ hover: { fillColor: { r: 9, g: 9, b: 9, a: 100 } } });
    expect(resolveForState(n, 'default')).toBe(n);
  });

  test('no override for the state → identity', () => {
    const n = node({ hover: { opacity: 50 } });
    expect(resolveForState(n, 'pinched')).toBe(n);
  });

  test('fillColor replaces', () => {
    const n = node({ hover: { fillColor: { r: 200, g: 0, b: 0, a: 100 } } });
    expect(resolveForState(n, 'hover').properties['fillColor']).toEqual({ r: 200, g: 0, b: 0, a: 100 });
  });

  test('position is a delta from base', () => {
    const n = node({ pinched: { position: { x: 0, y: -2 } } });
    expect(resolveForState(n, 'pinched').properties['position']).toEqual({ x: 10, y: 3 });
  });

  test('scale multiplies the visual size', () => {
    const n = node({ pinched: { scale: { x: 0.5, y: 0.5 } } });
    expect(resolveForState(n, 'pinched').properties['size']).toEqual({ x: 4, y: 2 });
  });

  test('visible:false collapses to opacity 0', () => {
    const n = node({ disabled: { visible: false } });
    expect(resolveForState(n, 'disabled').properties['opacity']).toBe(0);
  });

  test('does not mutate the source node', () => {
    const n = node({ hover: { position: { x: 5, y: 5 } } });
    resolveForState(n, 'hover');
    expect(n.properties['position']).toEqual({ x: 10, y: 5 });
  });
});
