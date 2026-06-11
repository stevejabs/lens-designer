// Empty states — fresh app, no design yet.

import { test } from '@playwright/test';

test.describe('empty states on first run', () => {
  test.skip('canvas shows "Drag a primitive from the palette to start designing."', async () => {});
  test.skip('inspector shows "Select a node on the canvas or in the layers panel to edit its properties."', async () => {});
  test.skip('layers shows "No layers yet. Add a primitive from the palette."', async () => {});
  test.skip('preview shows "Waiting for first mutation…"', async () => {});
  test.skip('Export button is disabled', async () => {});
});
