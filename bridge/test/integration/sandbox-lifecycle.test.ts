// Sandbox lifecycle — daemon survives LS restarts.

import { describe, test } from 'vitest';

describe('sandbox lifecycle integration', () => {
  test.todo('daemon broadcasts sandbox.down when the marker scan starts returning null');
  test.todo('daemon stays alive after sandbox.down (does not exit)');
  test.todo('daemon resumes design.apply when LS reopens');
  test.todo('marker-scan picks up a sandbox on a new port without a daemon restart');
});
