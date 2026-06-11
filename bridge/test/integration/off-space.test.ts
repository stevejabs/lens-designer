// Off-Space LS — characterize the addon's behavior when the target
// window lives on a different macOS Space. CGWindowListCreateImage
// (used internally by the addon for v1.0) often succeeds against
// off-Space windows; this test exists to record observed behavior on
// the host where /qa runs.
// MANUAL setup: move the sandbox LS to a different macOS Space before
// running.

import { describe, test } from 'vitest';

describe('off-Space capture integration', () => {
  test.todo('captureSource against an off-Space window either succeeds or throws CaptureError { kind: "capture-failed" | "window-not-found" }');
  test.todo('the daemon surfaces capture failures as design.error to all clients (not silent)');
  test.todo('the error message tells the operator to bring LS back to the active Space when capture fails');
});
