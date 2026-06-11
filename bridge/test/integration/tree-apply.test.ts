// Three-node tree apply — happy path for the design.apply pipeline.

import { describe, test } from 'vitest';

describe('design.apply with a 3-node tree', () => {
  test.todo('produces 3 sibling SOs under ActiveComponent');
  test.todo('z-stack matches the layer order (front layer at z = 0)');
  test.todo('every property in the design tree round-trips through readback');
  test.todo('Rectangle gets the RoundedRect material assigned');
  test.todo('Text gets the correct text content + font + size + alignment');
  test.todo('reply emits design.applied with the right nodeIds');
});

describe('design.apply teardown-and-rebuild', () => {
  test.todo('second apply with a different tree fully replaces the first');
  test.todo('no stale SOs remain from the previous tree');
});
