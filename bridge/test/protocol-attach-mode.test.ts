// WS protocol — new attach-mode messages. Validates the zod schemas defined
// in bridge/src/protocol.ts (Step 2 of the plan).
//
// Sources:
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §3
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md Step 2

import { describe, expect, test } from 'vitest';
import {
  ClientToServerMsgSchema,
  ServerToClientMsgSchema,
} from '../src/protocol.ts';

function asClient(msg: unknown): { ok: boolean } {
  return { ok: ClientToServerMsgSchema.safeParse(msg).success };
}
function asServer(msg: unknown): { ok: boolean } {
  return { ok: ServerToClientMsgSchema.safeParse(msg).success };
}

describe('client → server · target.list', () => {
  test('empty payload validates', () => {
    expect(asClient({ type: 'target.list' }).ok).toBe(true);
  });
});

describe('client → server · target.attach', () => {
  test('valid sandbox attach', () => {
    expect(
      asClient({ type: 'target.attach', port: 50049, mode: 'sandbox' }).ok,
    ).toBe(true);
  });
  test('valid attached-mode attach with assetsDir', () => {
    expect(
      asClient({
        type: 'target.attach',
        port: 50048,
        mode: 'attached',
        assetsDir: '/Users/dev/Project/Assets',
      }).ok,
    ).toBe(true);
  });
  test('rejects mode="other"', () => {
    expect(
      asClient({ type: 'target.attach', port: 50049, mode: 'other' }).ok,
    ).toBe(false);
  });
  test('rejects negative port', () => {
    expect(
      asClient({ type: 'target.attach', port: -1, mode: 'sandbox' }).ok,
    ).toBe(false);
  });
  test('rejects non-integer port', () => {
    expect(
      asClient({ type: 'target.attach', port: 50049.5, mode: 'sandbox' }).ok,
    ).toBe(false);
  });
  test('rejects missing port', () => {
    expect(asClient({ type: 'target.attach', mode: 'sandbox' }).ok).toBe(false);
  });
});

describe('client → server · target.detach + set-assets-dir', () => {
  test('detach with empty payload validates', () => {
    expect(asClient({ type: 'target.detach' }).ok).toBe(true);
  });
  test('set-assets-dir requires a non-empty absolute path', () => {
    expect(
      asClient({ type: 'target.set-assets-dir', assetsDir: '/Users/dev/Project/Assets' }).ok,
    ).toBe(true);
  });
  test('set-assets-dir rejects empty string', () => {
    expect(
      asClient({ type: 'target.set-assets-dir', assetsDir: '' }).ok,
    ).toBe(false);
  });
});

describe('client → server · view.* shapes', () => {
  test('view.list empty validates', () => {
    expect(asClient({ type: 'view.list' }).ok).toBe(true);
  });
  test('view.load requires id', () => {
    expect(asClient({ type: 'view.load', id: 'view-uuid-1' }).ok).toBe(true);
    expect(asClient({ type: 'view.load' }).ok).toBe(false);
  });
  test('view.save with valid name passes', () => {
    expect(
      asClient({
        type: 'view.save',
        name: 'PoiCard',
        tree: [],
      }).ok,
    ).toBe(true);
  });
  test('view.save with optional id passes', () => {
    expect(
      asClient({
        type: 'view.save',
        id: 'existing-id',
        name: 'PoiCard',
        tree: [],
      }).ok,
    ).toBe(true);
  });
  test('view.save rejects name starting with digit', () => {
    expect(
      asClient({ type: 'view.save', name: '1Card', tree: [] }).ok,
    ).toBe(false);
  });
  test('view.save rejects name with whitespace', () => {
    expect(
      asClient({ type: 'view.save', name: 'Poi Card', tree: [] }).ok,
    ).toBe(false);
  });
  test('view.save rejects name with punctuation', () => {
    expect(
      asClient({ type: 'view.save', name: 'Poi-Card!', tree: [] }).ok,
    ).toBe(false);
  });
  test('view.delete requires id', () => {
    expect(asClient({ type: 'view.delete', id: 'view-uuid-1' }).ok).toBe(true);
    expect(asClient({ type: 'view.delete' }).ok).toBe(false);
  });
});

describe('client → server · discriminated union', () => {
  test('rejects unknown type strings', () => {
    expect(asClient({ type: 'completely.unknown' }).ok).toBe(false);
  });
  test('legacy design.apply still validates', () => {
    expect(asClient({ type: 'design.apply', tree: [] }).ok).toBe(true);
  });
});

describe('server → client · target.list.result', () => {
  test('empty target list validates', () => {
    expect(asServer({ type: 'target.list.result', targets: [] }).ok).toBe(true);
  });
  test('multiple targets validate, sandbox flagged', () => {
    expect(
      asServer({
        type: 'target.list.result',
        targets: [
          { port: 50049, hasMarker: true, projectName: 'sandbox' },
          { port: 50048, hasMarker: false, projectName: 'queueboo' },
          { port: 50050, hasMarker: false, projectName: null },
        ],
      }).ok,
    ).toBe(true);
  });
  test('rejects negative ports', () => {
    expect(
      asServer({
        type: 'target.list.result',
        targets: [{ port: -1, hasMarker: false }],
      }).ok,
    ).toBe(false);
  });
});

describe('server → client · attached', () => {
  test('attached with empty views + null assetsDir validates', () => {
    expect(
      asServer({
        type: 'attached',
        target: {
          port: 50049,
          kind: 'sandbox',
          projectName: 'sandbox',
          assetsDir: null,
        },
        views: [],
        needsAssetsDir: false,
      }).ok,
    ).toBe(true);
  });
  test('attached with populated views validates', () => {
    expect(
      asServer({
        type: 'attached',
        target: {
          port: 50048,
          kind: 'attached',
          projectName: 'queueboo',
          assetsDir: '/Users/dev/lens/queueboo/Assets',
        },
        views: [
          { id: 'v1', name: 'PoiCard', codeName: 'PoiCard', updatedAt: 1000 },
          { id: 'v2', name: 'PoiMarker', codeName: 'PoiMarker', updatedAt: 2000 },
        ],
        needsAssetsDir: false,
      }).ok,
    ).toBe(true);
  });
  test('rejects target.kind = "other"', () => {
    expect(
      asServer({
        type: 'attached',
        target: { port: 50049, kind: 'other', projectName: null, assetsDir: null },
        views: [],
        needsAssetsDir: false,
      }).ok,
    ).toBe(false);
  });
});

describe('server → client · view.saved / view.loaded / view.list.result', () => {
  test('view.saved with non-null generated', () => {
    expect(
      asServer({
        type: 'view.saved',
        id: 'v1',
        generated: {
          prefab: 'Assets/LensDesigner/PoiCard.prefab',
          controller: 'Assets/LensDesigner/PoiCard.ts',
          atVersion: 1,
        },
        warnings: [],
      }).ok,
    ).toBe(true);
  });
  test('view.saved with null generated (save without generate)', () => {
    expect(
      asServer({ type: 'view.saved', id: 'v1', generated: null, warnings: [] }).ok,
    ).toBe(true);
  });
  test('view.loaded includes tree', () => {
    expect(
      asServer({ type: 'view.loaded', id: 'v1', tree: [] }).ok,
    ).toBe(true);
  });
  test('view.list.result validates', () => {
    expect(asServer({ type: 'view.list.result', views: [] }).ok).toBe(true);
  });
});

describe('server → client · legacy + discriminated union', () => {
  test('legacy hello still validates', () => {
    expect(
      asServer({
        type: 'hello',
        server: { name: 'lens-designer-bridge', version: '0.1.0' },
        sandbox: { url: 'http://localhost:50049/mcp', port: 50049 },
      }).ok,
    ).toBe(true);
  });
  test('legacy sandbox.down still validates', () => {
    expect(
      asServer({ type: 'sandbox.down', reason: 'marker not found' }).ok,
    ).toBe(true);
  });
  test('rejects unknown type strings', () => {
    expect(asServer({ type: 'completely.unknown' }).ok).toBe(false);
  });
});

// Pending — fill in once the WS dispatcher + JSON encode/decode coverage
// gets ports of these into integration tests.

describe('encoding round-trip', () => {
  test.todo('every message JSON-encode → JSON-decode → schema-parse yields the original value');
});

describe('WS server dispatch', () => {
  test.todo('WS server routes each new client→server type to the right handler');
  test.todo('WS server logs-and-ignores unknown types');
});
