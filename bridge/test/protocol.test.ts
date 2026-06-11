// Phase 1 — WS protocol message shapes. A6 in the implementation plan.
// Every message type defined in bridge/src/protocol.ts has a zod schema;
// these tests assert each schema round-trips and rejects malformed input.

import { describe, test } from 'vitest';

describe('Server → client messages', () => {
  describe('hello', () => {
    test.todo('valid payload round-trips');
    test.todo('missing serverInfo fails validation');
  });
  describe('sandbox.down', () => {
    test.todo('valid payload with reason string round-trips');
    test.todo('missing reason fails validation');
  });
  describe('design.applied', () => {
    test.todo('valid payload round-trips');
    test.todo('appliedAt must be a finite number');
  });
  describe('design.error', () => {
    test.todo('valid payload includes node id, property path, lsError');
    test.todo('rejects payload with no error context');
  });
  describe('preview.ready', () => {
    test.todo('valid payload with HTTP url round-trips');
    test.todo('url must match /preview/<uuid>.png pattern');
  });
  describe('design.exported', () => {
    test.todo('valid payload includes absolute path');
  });
});

describe('Client → server messages', () => {
  describe('design.apply', () => {
    test.todo('valid payload with a 1-node tree round-trips');
    test.todo('rejects a tree with a node referencing an unknown manifest type');
    test.todo('rejects a tree with duplicate node IDs');
  });
  describe('design.export', () => {
    test.todo('valid payload with bundleName round-trips');
    test.todo('bundleName must be filesystem-safe (alnum, dashes, underscores)');
  });
  describe('preview.configure-region', () => {
    test.todo('valid payload with WindowRegion round-trips');
  });
});
