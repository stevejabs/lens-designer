// Smoke — the web app loads and the bridge connects.

import { test, expect } from '@playwright/test';

test.describe('lens-designer smoke', () => {
  test('app loads with the expected header', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Lens Designer')).toBeVisible();
  });

  test.skip('connection chip shows Connected within 3s of load', async () => {
    // Implementation TODO during /build phase E3.
    // Requires the bridge daemon running on the default ports.
  });
});
