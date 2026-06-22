// Phase 1 — BridgeClient React hook.
// Mirrors the bridge package's BridgeClient state machine. The canonical
// logic lives in @lens-designer/bridge; this test layer covers the React
// integration (useBridge hook, state transitions visible to components).

import { describe, test } from 'vitest';

describe('useBridge() hook', () => {
  test.todo('returns connectionState: "idle" on first render');
  test.todo('transitions to "connecting" → "connected" after WS opens');
  test.todo('returns sandbox metadata after the hello message arrives');
  test.todo('transitions to "reconnecting" on connection drop with backoff status');
  test.todo('cleans up listeners and timers on unmount');
  test.todo('send(message) buffers if not connected, drops on disconnect()');
});

describe('connection chip render', () => {
  test.todo('"Connected · port {N}" when connected');
  test.todo('"Connecting…" when connecting');
  test.todo('"Reconnecting in Ns" when reconnecting (counts down)');
  test.todo('"Sandbox down" when sandbox.down received');
  test.todo('"Bridge offline" when WS connect fails repeatedly');
  test.todo('status communicated by BOTH color and text (never color alone)');
});
