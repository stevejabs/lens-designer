// Tests for the Image fit/alignment math.

import { describe, expect, test } from 'vitest';
import { ALIGN_9, computeTexTransform, type FitMode } from '../src/image-fit.ts';

describe('computeTexTransform — stretch', () => {
  test('identity regardless of aspects (image distorts to box)', () => {
    const t = computeTexTransform('stretch', 0.5, 0.5, 16 / 9, 1);
    expect(t.scale).toEqual({ x: 1, y: 1 });
    expect(t.offset).toEqual({ x: 0, y: 0 });
  });

  test('degenerate aspect falls back to identity', () => {
    expect(computeTexTransform('fit', 0.5, 0.5, 0, 1).scale).toEqual({ x: 1, y: 1 });
    expect(computeTexTransform('fill', 0.5, 0.5, NaN, 1).scale).toEqual({ x: 1, y: 1 });
  });
});

describe('computeTexTransform — fit (contain), centered', () => {
  test('square image in square box is identity', () => {
    const t = computeTexTransform('fit', 0.5, 0.5, 1, 1);
    expect(t.scale.x).toBeCloseTo(1);
    expect(t.scale.y).toBeCloseTo(1);
    expect(t.offset.x).toBeCloseTo(0);
    expect(t.offset.y).toBeCloseTo(0);
  });

  test('wide image (2:1) in square box → letterbox top/bottom (scaleY>1)', () => {
    const t = computeTexTransform('fit', 0.5, 0.5, 2, 1);
    expect(t.scale.x).toBeCloseTo(1);
    expect(t.scale.y).toBeCloseTo(2); // imgAspect/boxAspect
    // centered: uv.y=0.5 maps to texUV.y=0.5
    expect(0.5 * t.scale.y + t.offset.y).toBeCloseTo(0.5);
    // band edges map to 0 and 1
    const bandHalf = 1 / (2 * t.scale.y); // 0.25
    expect((0.5 - bandHalf) * t.scale.y + t.offset.y).toBeCloseTo(0);
    expect((0.5 + bandHalf) * t.scale.y + t.offset.y).toBeCloseTo(1);
  });

  test('tall image (1:2) in square box → pillarbox left/right (scaleX>1)', () => {
    const t = computeTexTransform('fit', 0.5, 0.5, 0.5, 1);
    expect(t.scale.x).toBeCloseTo(2);
    expect(t.scale.y).toBeCloseTo(1);
  });
});

describe('computeTexTransform — fill (cover), centered', () => {
  test('wide image (2:1) in square box → crop left/right (scaleX<1)', () => {
    const t = computeTexTransform('fill', 0.5, 0.5, 2, 1);
    expect(t.scale.x).toBeCloseTo(0.5); // boxAspect/imgAspect
    expect(t.scale.y).toBeCloseTo(1);
    // centered crop: uv.x=0.5 → texUV.x=0.5; full box stays in [0,1]
    expect(0 * t.scale.x + t.offset.x).toBeCloseTo(0.25);
    expect(1 * t.scale.x + t.offset.x).toBeCloseTo(0.75);
  });

  test('tall image (1:2) in square box → crop top/bottom (scaleY<1)', () => {
    const t = computeTexTransform('fill', 0.5, 0.5, 0.5, 1);
    expect(t.scale.x).toBeCloseTo(1);
    expect(t.scale.y).toBeCloseTo(0.5);
  });
});

describe('computeTexTransform — alignment', () => {
  test('fit wide image, top-align maps uv.y=0 to texUV.y=0', () => {
    const t = computeTexTransform('fit', 0.5, 0, 2, 1); // alignY=0 (top)
    expect(0 * t.scale.y + t.offset.y).toBeCloseTo(0);
  });

  test('fit wide image, bottom-align maps uv.y=1 to texUV.y=1', () => {
    const t = computeTexTransform('fit', 0.5, 1, 2, 1); // alignY=1 (bottom)
    expect(1 * t.scale.y + t.offset.y).toBeCloseTo(1);
  });

  test('fill wide image, left-align shows the image left edge at box left', () => {
    const t = computeTexTransform('fill', 0, 0.5, 2, 1); // alignX=0 (left)
    expect(0 * t.scale.x + t.offset.x).toBeCloseTo(0);
  });
});

describe('ALIGN_9 map', () => {
  test('covers all nine anchors with 0/0.5/1 coords', () => {
    expect(Object.keys(ALIGN_9)).toHaveLength(9);
    expect(ALIGN_9['top-left']).toEqual({ x: 0, y: 0 });
    expect(ALIGN_9['center']).toEqual({ x: 0.5, y: 0.5 });
    expect(ALIGN_9['bottom-right']).toEqual({ x: 1, y: 1 });
    for (const v of Object.values(ALIGN_9)) {
      expect([0, 0.5, 1]).toContain(v.x);
      expect([0, 0.5, 1]).toContain(v.y);
    }
  });
});

// Sanity: every fit mode keeps the box fully inside [0,1] for fill/stretch.
describe('computeTexTransform — bounds invariants', () => {
  const cases: Array<[FitMode, number]> = [
    ['stretch', 2], ['stretch', 0.5], ['fill', 2], ['fill', 0.5],
  ];
  test.each(cases)('fit=%s img=%f keeps centered box samples within [0,1]', (fit, imgA) => {
    const t = computeTexTransform(fit, 0.5, 0.5, imgA, 1);
    for (const uv of [0, 0.5, 1]) {
      expect(uv * t.scale.x + t.offset.x).toBeGreaterThanOrEqual(-1e-9);
      expect(uv * t.scale.x + t.offset.x).toBeLessThanOrEqual(1 + 1e-9);
      expect(uv * t.scale.y + t.offset.y).toBeGreaterThanOrEqual(-1e-9);
      expect(uv * t.scale.y + t.offset.y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
