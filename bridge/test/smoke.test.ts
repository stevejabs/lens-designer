// Smoke tests — verify the test harness compiles and runs end-to-end
// before any real bridge code exists. If these fail, vitest itself is
// broken or zod isn't installed; fix the harness before touching tests.

import { describe, expect, test } from 'vitest';
import { z } from 'zod';

describe('vitest harness', () => {
  test('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });

  test('async resolves', async () => {
    await expect(Promise.resolve('ok')).resolves.toBe('ok');
  });
});

describe('zod is available', () => {
  test('a trivial schema round-trips', () => {
    const Point = z.object({ x: z.number(), y: z.number() });
    const sample = { x: 1.5, y: -2.0 };
    expect(Point.parse(sample)).toEqual(sample);
  });

  test('a malformed payload throws', () => {
    const Point = z.object({ x: z.number(), y: z.number() });
    expect(() => Point.parse({ x: 'not-a-number', y: 0 })).toThrow();
  });
});
