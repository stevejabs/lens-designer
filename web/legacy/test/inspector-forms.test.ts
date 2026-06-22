// Phase 1 — Inspector property form controls.
// Plan step F2. Design spec §"Interaction patterns → Inspector editing"
// + §"Color popover".

import { describe, test } from 'vitest';

describe('Inspector — number input', () => {
  test.todo('renders the property value with the right unit suffix (cm, deg, %)');
  test.todo('uses --font-mono for digits');
  test.todo('Tab away commits the value to the store');
  test.todo('Enter commits the value to the store');
  test.todo('Esc reverts without committing');
  test.todo('typing a non-numeric value shows error border + does not commit');
  test.todo('respects min/max from the manifest');
});

describe('Inspector — text input (single + multi-line)', () => {
  test.todo('multi-line textarea grows from 3 rows to 8 rows');
  test.todo('committing a long string updates the store');
});

describe('Inspector — color (swatch + hex + alpha)', () => {
  test.todo('swatch shows the current fill color');
  test.todo('hex input accepts a 6-char uppercase hex and commits');
  test.todo('hex input with only 5 chars shows error border');
  test.todo('alpha input clamps to 0–100');
  test.todo('clicking the swatch opens the color popover anchored to the row');
  test.todo('popover Esc closes; click-outside closes');
});

describe('Inspector — enum dropdown (e.g. font, alignment)', () => {
  test.todo('renders the manifest options');
  test.todo('selecting an option commits to the store');
});

describe('Inspector — opacity slider', () => {
  test.todo('slider is paired with a mono numeric input (0–100)');
  test.todo('dragging the slider updates the store live');
  test.todo('typing into the numeric input moves the slider');
});

describe('Inspector — alignment toggle (h+v)', () => {
  test.todo('three-icon toggle for horizontal alignment commits to the store');
  test.todo('three-icon toggle for vertical alignment commits to the store');
  test.todo('active state shows --bg-3 background + --accent-400 icon color');
});
