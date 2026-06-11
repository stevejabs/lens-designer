// capture-pipeline.test.ts
//
// Contract stubs for the new bridge/src/capture.ts wrapper introduced
// at Phase-1 Step 5. The bridge's apply-pipeline calls into this
// wrapper instead of the old screencap.ts / window.ts. The wrapper's
// only job is to call MockCaptureAddon (in tests) or the real
// @lens-designer/capture-addon (in production), translate typed errors
// to the WS protocol's shape, and write capture PNGs to the HTTP
// server's tmp directory.
//
// Filled in during Phase-1 Step 5. The `test.todo()` stubs here lock
// the contract before code is written.
//
// Locked by docs/testing/2026-05-27-lens-designer-standalone-app-test-plan.md.

import { describe, test } from 'vitest';

// MockCaptureAddon is imported by every test once Step 5 lands.
// import { createMockCaptureAddon, FAKE_LS_WINDOW, FAKE_PREVIEW_REGION } from './MockCaptureAddon.ts';

describe('bridge: capture wrapper (Step 5 contract)', () => {
  test.todo('capture(region) calls addon.captureSource with the bridge\'s active SourceId and the region');
  test.todo('capture writes the returned PNG via tmp + atomic rename, then emits preview.ready with the served URL');
  test.todo('capture(region) with no active source first calls addon.pickLensStudioSource()');
  test.todo('capture is a no-op when getPlatformCapabilities().requiresInteractivePick is true and the user hasn\'t picked yet');
});

describe('bridge: capture error translation (Step 5 contract)', () => {
  test.todo('CaptureError { kind: "permission-denied" } surfaces as design.error with errorKind: "permission-denied"');
  test.todo('CaptureError { kind: "window-not-found" } triggers a one-shot re-discovery via enumerateLensStudioWindows; if found, capture retries once');
  test.todo('CaptureError { kind: "capture-failed" } surfaces as design.error with errorKind: "capture-failed" and the detail string in the WS payload');
  test.todo('CaptureError { kind: "platform-unsupported" } is fatal — the bridge emits a sandbox.down with reason "platform-unsupported" and stops scheduling captures');
  test.todo('CaptureError { kind: "capability-unsupported" } when calling pickLensStudioSource is surfaced as a typed protocol error (not a thrown exception)');
});

describe('bridge: capture pipeline interaction with apply (Step 5 contract)', () => {
  test.todo('a successful apply followed by capture emits exactly one preview.ready with capturedAt set');
  test.todo('back-to-back applies coalesce: only the newest apply\'s preview is emitted (existing debounce behavior preserved)');
  test.todo('a permission error on capture does NOT block the apply pipeline — subsequent applies still run');
  test.todo('addon.releaseSource is called when the bridge tears down a target (attach mode detach, sandbox down)');
});

describe('bridge: portToPid wrapper (Step 6 contract)', () => {
  test.todo('pidListeningOnPort(port) delegates to addon.portToPid and returns its value verbatim');
  test.todo('pidListeningOnPort(port) returns null when the addon returns null');
  test.todo('findLensStudioWindowForPort resolves the port to a pid, then matches a window by pid');
});
