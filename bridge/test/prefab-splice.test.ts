// Prefab YAML splice — preserve a .prefab asset's identity (top-level
// ObjectPrefab/<UUID>) across a re-save so placed instances stay linked.
// MCP cannot update a prefab in place (verified in S2); we work around by
// re-capturing to a temp path and splicing the new body into the old file.
//
// Sources:
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §TD-3
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md Step 9
//   - docs/testing/2026-05-26-attach-mode-spikes-runbook.md (S2 findings)

import { describe, expect, test } from 'vitest';
import { splicePrefabBody } from '../src/prefab.ts';
import type { McpClient } from '../src/mcp.ts';

/**
 * In-memory text-file MCP fake. Captures ReadWriteTextFile reads + writes
 * to a Map so tests can assert on the on-disk-equivalent state.
 */
function makeFsClient(initial: Record<string, string> = {}): {
  client: McpClient;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  const client = {
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (name !== 'ReadWriteTextFile') {
        throw new Error(`unexpected MCP tool ${name}`);
      }
      const path = args['filePath'] as string;
      if (args['action'] === 'read') {
        if (!files.has(path)) throw new Error(`ReadWriteTextFile: ${path} not found`);
        return { content: files.get(path)! };
      }
      if (args['action'] === 'write') {
        files.set(path, args['content'] as string);
        return {};
      }
      throw new Error(`ReadWriteTextFile: unknown action ${args['action']}`);
    },
    // The McpClient interface in this codebase exposes more than callTool,
    // but our use is narrow — cast through unknown rather than stub the
    // whole surface.
  } as unknown as McpClient;
  return { client, files };
}

const OLD_UUID = '7389c2b6-87b0-4331-a825-2b5ccf3cd301';
const NEW_UUID = '09f392dd-1325-4b14-9d12-9ad1efdf3472';

const OLD_PREFAB = `- !<ObjectPrefab/${OLD_UUID}>
  PackagePath: ""
  objects:
    - !<own> c7a9588f-4659-44de-85b2-c1d659687e5f
  LazyLoading: false
  RetainAssets: true
- !<SceneObject/94046ca9-67ff-46dd-8181-572f1f5e2503>
  PrefabRemaps:
    Name: "SpikeBox"
`;

const NEW_PREFAB = `- !<ObjectPrefab/${NEW_UUID}>
  PackagePath: ""
  objects:
    - !<own> 59952229-fb8e-477c-a4fe-c7059cd6c309
  LazyLoading: false
  RetainAssets: true
- !<SceneObject/434af8c3-6e8b-4711-ae95-e1a94c6b4a74>
  PrefabRemaps:
    Name: "SpikeBox"
  AddedChildren:
    - !<own> deadbeef-deadbeef-deadbeef
- !<SceneObject/deadbeef-deadbeef-deadbeef>
  Name: "SpikeChild_v2"
`;

describe('splicePrefabBody — happy path', () => {
  test('preserves the top-level ObjectPrefab/<UUID> line', async () => {
    const { client, files } = makeFsClient({
      'LensDesigner/SpikeBox.prefab': OLD_PREFAB,
      'LensDesigner/__regen/temp/SpikeBox.prefab': NEW_PREFAB,
    });
    await splicePrefabBody(
      client,
      'LensDesigner/SpikeBox.prefab',
      'LensDesigner/__regen/temp/SpikeBox.prefab',
    );
    const after = files.get('LensDesigner/SpikeBox.prefab')!;
    expect(after.startsWith(`- !<ObjectPrefab/${OLD_UUID}>`)).toBe(true);
    expect(after).not.toContain(NEW_UUID);
  });

  test('replaces the body with the new capture', async () => {
    const { client, files } = makeFsClient({
      'LensDesigner/SpikeBox.prefab': OLD_PREFAB,
      'LensDesigner/__regen/temp/SpikeBox.prefab': NEW_PREFAB,
    });
    await splicePrefabBody(
      client,
      'LensDesigner/SpikeBox.prefab',
      'LensDesigner/__regen/temp/SpikeBox.prefab',
    );
    const after = files.get('LensDesigner/SpikeBox.prefab')!;
    // Body content from the new prefab is present.
    expect(after).toContain('SpikeChild_v2');
    expect(after).toContain('AddedChildren');
    // Old body specifics are gone.
    expect(after).not.toContain('94046ca9-67ff-46dd-8181-572f1f5e2503');
  });

  test('the temp prefab file is left untouched (caller cleans up)', async () => {
    const { client, files } = makeFsClient({
      'LensDesigner/SpikeBox.prefab': OLD_PREFAB,
      'LensDesigner/__regen/temp/SpikeBox.prefab': NEW_PREFAB,
    });
    await splicePrefabBody(
      client,
      'LensDesigner/SpikeBox.prefab',
      'LensDesigner/__regen/temp/SpikeBox.prefab',
    );
    expect(files.get('LensDesigner/__regen/temp/SpikeBox.prefab')).toBe(NEW_PREFAB);
  });
});

describe('splicePrefabBody — validation', () => {
  test('throws when existing path is missing the ObjectPrefab header', async () => {
    const { client } = makeFsClient({
      'LensDesigner/SpikeBox.prefab': 'this is not a prefab\n',
      'LensDesigner/__regen/temp/SpikeBox.prefab': NEW_PREFAB,
    });
    await expect(
      splicePrefabBody(
        client,
        'LensDesigner/SpikeBox.prefab',
        'LensDesigner/__regen/temp/SpikeBox.prefab',
      ),
    ).rejects.toThrow(/not a recognizable .prefab file/);
  });

  test('throws when new path is missing the ObjectPrefab header', async () => {
    const { client } = makeFsClient({
      'LensDesigner/SpikeBox.prefab': OLD_PREFAB,
      'LensDesigner/__regen/temp/SpikeBox.prefab': 'no header here\n',
    });
    await expect(
      splicePrefabBody(
        client,
        'LensDesigner/SpikeBox.prefab',
        'LensDesigner/__regen/temp/SpikeBox.prefab',
      ),
    ).rejects.toThrow(/not a recognizable .prefab file/);
  });

  test('throws when the existing prefab path does not exist', async () => {
    const { client } = makeFsClient({
      'LensDesigner/__regen/temp/SpikeBox.prefab': NEW_PREFAB,
    });
    await expect(
      splicePrefabBody(
        client,
        'LensDesigner/missing.prefab',
        'LensDesigner/__regen/temp/SpikeBox.prefab',
      ),
    ).rejects.toThrow(/not found/);
  });
});

// Pending — these need integration-level coverage against a live LS.
describe('splicePrefabBody — live LS', () => {
  test.todo('post-splice the asset id remains the same (LS asset-DB)');
  test.todo('placed instance reflects updated child layout while keeping root position');
  test.todo('parse-failure surfaces a view.saved warning + retains the user tree in localStorage');
});
