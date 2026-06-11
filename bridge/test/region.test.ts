// Phase-0-preserved: parseRegion + region-coord parsing.
// These tests assert behavior that already ships on
// `lens-designer/spike-phase-0` and must not regress after A1.

import { describe, test } from 'vitest';

describe('parseRegion("x,y,w,h")', () => {
  test.todo('returns the expected WindowRegion for valid integer input');
  test.todo('rejects malformed input (3 parts, 5 parts, non-numeric)');
  test.todo('rejects negative width or height');
  test.todo('accepts zero x/y (window-relative top-left)');
});
