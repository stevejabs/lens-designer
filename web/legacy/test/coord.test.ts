// Phase 1 — cm ↔ SVG-px coordinate conversion.
// At 100% zoom: 1 cm = 10 px. Pan/zoom only affects the visual transform,
// NOT the underlying design data (cm values stay the same).
// Plan step F1.

import { describe, test } from 'vitest';

describe('cmToPx(cm, zoom)', () => {
  test.todo('at zoom=1, 1 cm = 10 px');
  test.todo('at zoom=2, 1 cm = 20 px');
  test.todo('at zoom=0.5, 1 cm = 5 px');
  test.todo('handles negative cm (returns negative px)');
  test.todo('handles 0 cm (returns 0)');
});

describe('pxToCm(px, zoom)', () => {
  test.todo('at zoom=1, 10 px = 1 cm');
  test.todo('at zoom=2, 20 px = 1 cm');
  test.todo('round-trip cm → px → cm is identity at any zoom');
  test.todo('clamps zoom to the documented range (25% – 400%)');
});
