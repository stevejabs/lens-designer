// Phase 1 — layer-to-z math. D-7 in the implementation plan.
// Design tree is a flat ordered list: index 0 = front, index N = back.
// Bridge translates list position to z position: z = -index * LAYER_DZ.

import { describe, expect, test } from 'vitest';
import { layerIndexToZ, LAYER_DZ } from '../src/applier.ts';

describe('layerIndexToZ(index)', () => {
  test('returns 0 for layer index 0 (front)', () => {
    expect(layerIndexToZ(0)).toBe(0);
  });

  test('returns -LAYER_DZ for layer index 1', () => {
    expect(layerIndexToZ(1)).toBeCloseTo(-LAYER_DZ, 10);
  });

  test('returns -N * LAYER_DZ for layer index N', () => {
    expect(layerIndexToZ(7)).toBeCloseTo(-7 * LAYER_DZ, 10);
    expect(layerIndexToZ(19)).toBeCloseTo(-19 * LAYER_DZ, 10);
  });

  test('preserves ordering: index a < index b implies z(a) > z(b)', () => {
    // Smaller index = closer to viewer = larger z in LS world space.
    expect(layerIndexToZ(0)).toBeGreaterThan(layerIndexToZ(1));
    expect(layerIndexToZ(2)).toBeGreaterThan(layerIndexToZ(5));
    expect(layerIndexToZ(5)).toBeGreaterThan(layerIndexToZ(19));
  });

  test('LAYER_DZ is 0.1 cm — big enough for the depth buffer, small enough to read flat', () => {
    // LS world unit is 1 cm. 0.001 cm was below depth-buffer precision at AR
    // distance (~52 cm), so adjacent layers z-fought and flipped with head
    // angle; 0.1 cm clears it ON DEVICE while still reading as flat 2D. See
    // the LAYER_DZ doc in applier.ts before "fixing" this back down.
    // even 20 stacked layers stay within 0.2 mm of the front. The user
    // shouldn't read this as 3D depth.
    expect(LAYER_DZ).toBe(0.1);
    expect(LAYER_DZ).toBeGreaterThan(0);
  });
});
