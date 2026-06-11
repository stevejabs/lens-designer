// Vitest global setup for the bridge test suite. Runs once per worker
// before any test file. Keep this lean — heavy fixtures belong in
// individual test files where they can be scoped tighter.

import { beforeAll } from 'vitest';

beforeAll(() => {
  // Reserved for global setup. Currently no global state; the bridge
  // is designed so each test creates its own daemon/client where needed.
});
