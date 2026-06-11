// Connection states — verifies the chip + overlay UX across:
// bridge offline, connecting, connected, sandbox down, design error.

import { test } from '@playwright/test';

test.describe('connection states', () => {
  test.skip('app started before bridge → "Bridge offline" chip + helpful message', async () => {});
  test.skip('bridge starts → chip transitions to Connecting → Connected', async () => {});
  test.skip('kill bridge mid-session → chip flips to "Bridge offline" after backoff', async () => {});
  test.skip('kill LS mid-session → chip flips to "Sandbox down" via marker scan', async () => {});
  test.skip('reopen LS → chip returns to Connected on next scan', async () => {});
});

test.describe('design error state', () => {
  test.skip('a rejected property surfaces the warning overlay on Preview', async () => {});
  test.skip('the overlay names the node + property + LS error message', async () => {});
  test.skip('dismissing the overlay leaves the last good preview frame visible', async () => {});
});

test.describe('persistence', () => {
  test.skip('reload preserves design tree from localStorage', async () => {});
  test.skip('reload preserves selectedId', async () => {});
  test.skip('reload preserves previewRegion settings', async () => {});
});
