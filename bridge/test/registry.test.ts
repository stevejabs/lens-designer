// View registry — read/write Assets/LensDesigner/views.json via MCP
// ReadWriteTextFile. The project-resident source of truth for view trees.
//
// Tests cover the pure-logic surface: schema, upsert/delete, collision
// detection, listing order. Live MCP round-trip (write → re-read across
// an LS focus change) is exercised in integration/attach-mode.test.ts.
//
// Sources:
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §TD-5, §2.1
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md Step 6

import { describe, expect, test } from 'vitest';
import {
  REGISTRY_VERSION,
  ViewRegistrySchema,
  emptyRegistry,
  findViewById,
  findViewByName,
  listViews,
  upsertView,
  deleteView,
  setProjectMeta,
  setSceneLink,
  type ViewRegistry,
  type ViewRecord,
} from '../src/registry.ts';
import type { DesignNode } from '../src/protocol.ts';

const node = (id: string, type = 'Rectangle'): DesignNode => ({
  id,
  type,
  name: id,
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
  properties: {},
  children: [],
});

function rec(name: string, t = 1000, id = `id-${name}`): ViewRecord {
  return {
    id,
    name,
    tree: [node(`${name}-root`)],
    createdAt: t,
    updatedAt: t,
    generated: null,
    scene: null,
  };
}

describe('registry — empty + schema', () => {
  test('emptyRegistry has the right shape', () => {
    const r = emptyRegistry();
    expect(r.registryVersion).toBe(REGISTRY_VERSION);
    expect(r.views).toEqual([]);
  });

  test('parses a well-formed registry', () => {
    const r = ViewRegistrySchema.safeParse({
      registryVersion: REGISTRY_VERSION,
      views: [rec('PoiCard')],
    });
    expect(r.success).toBe(true);
  });

  test('rejects a registry with an unknown registryVersion', () => {
    const r = ViewRegistrySchema.safeParse({
      registryVersion: 99,
      views: [],
    });
    expect(r.success).toBe(false);
  });

  test('rejects a ViewRecord with an invalid name', () => {
    const r = ViewRegistrySchema.safeParse({
      registryVersion: REGISTRY_VERSION,
      views: [{ ...rec('valid'), name: '1Bad' }],
    });
    expect(r.success).toBe(false);
  });

  test('rejects a registry missing the registryVersion field', () => {
    const r = ViewRegistrySchema.safeParse({ views: [] });
    expect(r.success).toBe(false);
  });
});

describe('registry — find / list ordering', () => {
  const reg: ViewRegistry = {
    registryVersion: REGISTRY_VERSION,
    views: [rec('Older', 1000, 'older'), rec('Newer', 3000, 'newer'), rec('Middle', 2000, 'middle')],
  };

  test('findViewById', () => {
    expect(findViewById(reg, 'middle')?.name).toBe('Middle');
    expect(findViewById(reg, 'nonexistent')).toBeUndefined();
  });

  test('findViewByName is case-insensitive', () => {
    expect(findViewByName(reg, 'newer')?.id).toBe('newer');
    expect(findViewByName(reg, 'NEWER')?.id).toBe('newer');
    expect(findViewByName(reg, 'nope')).toBeUndefined();
  });

  test('listViews orders by updatedAt desc', () => {
    expect(listViews(reg).map((v) => v.name)).toEqual(['Newer', 'Middle', 'Older']);
  });
});

describe('registry — upsertView (insert)', () => {
  test('insert with no id allocates a fresh id and sets createdAt = updatedAt', () => {
    const reg = emptyRegistry();
    const { reg: next, record } = upsertView(reg, {
      name: 'PoiCard',
      tree: [node('root')],
      now: 5000,
    });
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBe(5000);
    expect(record.updatedAt).toBe(5000);
    expect(next.views).toHaveLength(1);
    expect(next.views[0]!.name).toBe('PoiCard');
  });

  test('insert with explicit id uses that id', () => {
    const { record } = upsertView(emptyRegistry(), {
      id: 'my-explicit-id',
      name: 'PoiCard',
      tree: [],
    });
    expect(record.id).toBe('my-explicit-id');
  });

  test('insert defaults generated to null', () => {
    const { record } = upsertView(emptyRegistry(), { name: 'X', tree: [] });
    expect(record.generated).toBeNull();
  });
});

describe('registry — upsertView (update)', () => {
  test('update by id replaces tree + bumps updatedAt; preserves createdAt', () => {
    const reg: ViewRegistry = {
      registryVersion: REGISTRY_VERSION,
      views: [rec('PoiCard', 1000, 'v1')],
    };
    const { record } = upsertView(reg, {
      id: 'v1',
      name: 'PoiCard',
      tree: [node('new-root')],
      now: 2000,
    });
    expect(record.id).toBe('v1');
    expect(record.createdAt).toBe(1000);
    expect(record.updatedAt).toBe(2000);
    expect(record.tree[0]!.id).toBe('new-root');
  });

  test('update preserves existing generated when input.generated is undefined', () => {
    const existing = rec('X', 1000, 'v1');
    existing.generated = {
      prefab: 'Assets/LensDesigner/X.prefab',
      controller: 'Assets/LensDesigner/X.ts',
      atVersion: 3,
    };
    const reg: ViewRegistry = { registryVersion: REGISTRY_VERSION, views: [existing] };
    const { record } = upsertView(reg, { id: 'v1', name: 'X', tree: [] });
    expect(record.generated?.atVersion).toBe(3);
  });

  test('update clears generated when input.generated is null', () => {
    const existing = rec('X', 1000, 'v1');
    existing.generated = { prefab: 'p', controller: 'c', atVersion: 1 };
    const reg: ViewRegistry = { registryVersion: REGISTRY_VERSION, views: [existing] };
    const { record } = upsertView(reg, { id: 'v1', name: 'X', tree: [], generated: null });
    expect(record.generated).toBeNull();
  });
});

describe('registry — name-collision detection', () => {
  test('no collision when name is unique', () => {
    const { nameCollision } = upsertView(emptyRegistry(), { name: 'PoiCard', tree: [] });
    expect(nameCollision).toBeUndefined();
  });

  test('collision when inserting a name that already exists under a DIFFERENT id', () => {
    const reg: ViewRegistry = {
      registryVersion: REGISTRY_VERSION,
      views: [rec('PoiCard', 1000, 'existing-id')],
    };
    const { nameCollision } = upsertView(reg, { name: 'PoiCard', tree: [] });
    expect(nameCollision?.existingId).toBe('existing-id');
  });

  test('NO collision when updating the SAME id with the same name', () => {
    const reg: ViewRegistry = {
      registryVersion: REGISTRY_VERSION,
      views: [rec('PoiCard', 1000, 'existing-id')],
    };
    const { nameCollision } = upsertView(reg, {
      id: 'existing-id',
      name: 'PoiCard',
      tree: [],
    });
    expect(nameCollision).toBeUndefined();
  });

  test('collision is case-insensitive (matches the UI)', () => {
    const reg: ViewRegistry = {
      registryVersion: REGISTRY_VERSION,
      views: [rec('PoiCard', 1000, 'existing-id')],
    };
    const { nameCollision } = upsertView(reg, { name: 'POICARD', tree: [] });
    expect(nameCollision?.existingId).toBe('existing-id');
  });
});

describe('registry — deleteView', () => {
  test('deletes by id; other views intact', () => {
    const reg: ViewRegistry = {
      registryVersion: REGISTRY_VERSION,
      views: [rec('A', 1, 'a'), rec('B', 2, 'b'), rec('C', 3, 'c')],
    };
    const { reg: next, removed } = deleteView(reg, 'b');
    expect(removed?.name).toBe('B');
    expect(next.views.map((v) => v.id)).toEqual(['a', 'c']);
  });

  test('delete of a missing id returns the original registry + null', () => {
    const reg: ViewRegistry = {
      registryVersion: REGISTRY_VERSION,
      views: [rec('A', 1, 'a')],
    };
    const { reg: next, removed } = deleteView(reg, 'no-such-id');
    expect(removed).toBeNull();
    expect(next).toBe(reg); // identity preserved on no-op
  });
});

// Pending — require an MCP mock or live LS.
describe('registry — MCP round-trip (live or mock-needed)', () => {
  test.todo('loadRegistry returns emptyRegistry when views.json is absent');
  test.todo('loadRegistry parses a real on-disk views.json');
  test.todo('loadRegistry throws RegistryParseError on malformed JSON');
  test.todo('loadRegistry throws RegistryParseError on schema mismatch');
  test.todo('saveRegistry round-trips: save → load yields identical bytes');
  test.todo('saveRegistry validates before writing (rejects bad in-memory state)');
  test.todo('save re-reads views.json immediately before write (concurrent-writer safety)');
});

describe('registry v2 — project manifest + scene links', () => {
  test('setProjectMeta stamps the project header', () => {
    const r = setProjectMeta(emptyRegistry(), { name: 'BooksSample', assetsDir: '/p/Assets' }, 42);
    expect(r.project).toEqual({
      name: 'BooksSample',
      assetsDir: '/p/Assets',
      lensDesignerVersion: '',
      updatedAt: 42,
    });
  });

  test('setProjectMeta merges over an existing header (omitted fields preserved)', () => {
    const a = setProjectMeta(emptyRegistry(), { name: 'X', assetsDir: '/a' }, 1);
    const b = setProjectMeta(a, { assetsDir: '/b' }, 2);
    expect(b.project).toEqual({ name: 'X', assetsDir: '/b', lensDesignerVersion: '', updatedAt: 2 });
  });

  test('setSceneLink records + clears a view→instance link', () => {
    const seed = upsertView(emptyRegistry(), { name: 'Card', tree: [node('root')], now: 1 });
    const linked = setSceneLink(seed.reg, seed.record.id, { rootUUID: 'so-1', markerId: 'm-1' });
    expect(findViewById(linked, seed.record.id)?.scene).toEqual({ rootUUID: 'so-1', markerId: 'm-1' });
    const cleared = setSceneLink(linked, seed.record.id, null);
    expect(findViewById(cleared, seed.record.id)?.scene).toBeNull();
  });

  test('new views start with scene = null', () => {
    const { record } = upsertView(emptyRegistry(), { name: 'Fresh', tree: [node('root')], now: 1 });
    expect(record.scene).toBeNull();
  });

  test('upsert update preserves an existing scene link', () => {
    const seed = upsertView(emptyRegistry(), { name: 'Card', tree: [node('root')], now: 1 });
    const linked = setSceneLink(seed.reg, seed.record.id, { rootUUID: 'so-1', markerId: 'm-1' });
    const updated = upsertView(linked, { id: seed.record.id, name: 'Card', tree: [node('root2')], now: 2 });
    expect(updated.record.scene).toEqual({ rootUUID: 'so-1', markerId: 'm-1' });
  });

  test('a v1 manifest parses forward (scene defaults null, project undefined)', () => {
    const v1 = {
      registryVersion: 1,
      views: [
        {
          id: 'v1',
          name: 'Legacy',
          tree: [node('root')],
          createdAt: 1,
          updatedAt: 1,
          generated: { prefab: 'p.prefab', controller: 'c.ts', atVersion: 1 },
        },
      ],
    };
    const parsed = ViewRegistrySchema.parse(v1);
    expect(parsed.views[0]!.scene).toBeNull();
    expect(parsed.project).toBeUndefined();
  });

  test('a fully-populated v2 manifest round-trips through the schema', () => {
    const seed = upsertView(emptyRegistry(), { name: 'Card', tree: [node('root')], now: 1 });
    const withProject = setProjectMeta(seed.reg, { name: 'Proj', assetsDir: '/Assets' }, 5);
    const linked = setSceneLink(withProject, seed.record.id, { rootUUID: 'so', markerId: 'mk' });
    expect(() => ViewRegistrySchema.parse(linked)).not.toThrow();
    expect(linked.project?.name).toBe('Proj');
    expect(linked.views[0]!.scene?.rootUUID).toBe('so');
  });
});
