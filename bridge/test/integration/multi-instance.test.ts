// Multi-instance LS — marker scan picks the sandbox, ignores others.
// Requires a second LS open with a non-sandbox project on a different port.
// Auto-skip if only one LS is detected.

import { describe, test } from 'vitest';

describe('multi-instance integration', () => {
  test.todo('marker scan finds the sandbox even when another LS is running on a different port');
  test.todo('LS_MCP_PORT override pointing at the non-sandbox LS makes mutate refuse with exit 3');
  test.todo('the safety-gate error names the actual port and PID of the non-sandbox LS');
});
