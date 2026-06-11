// Phase 1 — BridgeClient state machine + reconnect.
// This logic is shared between web/src/lib/bridge-client.ts and the bridge
// daemon's own self-connect helpers; the canonical implementation lives in
// the bridge package and the web package re-exports it.
// Plan step B3 (state machine), design spec §"Connection state" + §"States".

import { describe, test } from 'vitest';

describe('BridgeClient state transitions', () => {
  test.todo('starts in `idle`');
  test.todo('connect() moves to `connecting`');
  test.todo('open WS event moves to `connected`');
  test.todo('hello message attaches sandbox metadata to state');
  test.todo('close event moves to `reconnecting`');
  test.todo('disconnect() during reconnecting moves to `idle` (cancels backoff)');
});

describe('BridgeClient reconnect backoff', () => {
  test.todo('first reconnect attempt fires after 1s');
  test.todo('successive attempts: 2s, 4s, 8s, 16s, 30s cap');
  test.todo('the 6th and subsequent attempts all use 30s');
  test.todo('a successful connect resets the backoff counter to 0');
  test.todo('disconnect() clears any pending reconnect timer');
});

describe('BridgeClient message dispatch', () => {
  test.todo('on(type, handler) invokes the handler for matching message');
  test.todo('messages with unknown type are logged but not thrown');
  test.todo('a malformed message (fails zod) is logged but does not kill the connection');
});
