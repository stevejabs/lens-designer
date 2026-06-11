// Debounce coalescing — 10 design.apply messages within 50ms → 1 preview.

import { describe, test } from 'vitest';

describe('debounce burst integration', () => {
  test.todo('10 apply messages over 50ms produce exactly 1 preview.ready');
  test.todo('the captured preview reflects the LAST apply, not the first');
  test.todo('subsequent applies after the burst settles produce their own preview events');
});
