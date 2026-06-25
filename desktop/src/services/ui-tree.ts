// ui-tree.ts — read the live UIKit element tree of the view loaded in the edit
// bay. UIKit views build their UI at runtime (onAwake), so the elements exist
// in the RUNNING preview, not the editor scene graph. We read them via
// QueryRuntimeSceneTool (the same runtime introspection CLAD uses), which
// returns each node's resolved runtime componentTypes (BackPlate, Switch,
// FlexLayout, RoundedRectangle, Text, …) — exactly the element tree the WYSIWYG
// editor selects + inspects.

import type { McpClient } from './mcp-client.js';

interface RuntimeSummary {
  name: string;
  uniqueId: string;
  enabled: boolean;
  childCount: number;
  componentTypes: string[];
  parentUniqueId?: string | null;
}
interface RuntimeNode extends RuntimeSummary {
  children?: RuntimeNode[];
}

export interface ElementNode {
  id: string;
  name: string;
  componentTypes: string[];
  enabled: boolean;
  children: ElementNode[];
}

export interface ElementTree {
  ok: boolean;
  reason?: string;
  host?: string;
  tree?: ElementNode;
}

interface RuntimeResult<T> {
  _metadata?: unknown;
  data?: T;
  error?: string;
}

async function query<T>(client: McpClient, gql: string): Promise<T | null> {
  try {
    const res = await client.callTool<RuntimeResult<T>>('QueryRuntimeSceneTool', { query: gql });
    if (!res || res.error) return null;
    return res.data ?? null;
  } catch {
    return null;
  }
}

function toNode(n: RuntimeNode): ElementNode {
  return {
    id: n.uniqueId,
    name: n.name,
    componentTypes: n.componentTypes ?? [],
    enabled: n.enabled,
    children: (n.children ?? []).map(toNode),
  };
}

/** Read the loaded view's runtime element tree from the live preview. */
export async function readElementTree(client: McpClient): Promise<ElementTree> {
  // 1. Find the enabled __LDView__* host (the loaded view).
  const found = await query<{ sceneObjects?: { matches?: { summary: RuntimeSummary }[] } }>(
    client,
    '{ sceneObjects(filter: {nameContains: "__LDView__"}) { matches { summary } } }',
  );
  const matches = found?.sceneObjects?.matches ?? [];
  if (matches.length === 0) {
    // No preview running, or no view loaded.
    return { ok: false, reason: 'no-runtime-view' };
  }
  const host = matches.find((m) => m.summary.enabled)?.summary ?? matches[0]?.summary;
  if (!host) return { ok: false, reason: 'no-view-loaded' };

  // 2. Drill into its subtree (server caps depth at 5).
  const drilled = await query<{ sceneObject?: { summary: RuntimeSummary; descendantsTree?: RuntimeNode[] } }>(
    client,
    `{ sceneObject(uniqueId: "${host.uniqueId}") { summary descendantsTree(maxDepth: 5) } }`,
  );
  const so = drilled?.sceneObject;
  if (!so) return { ok: false, reason: 'host-unreadable' };

  const root: ElementNode = {
    id: so.summary.uniqueId,
    name: so.summary.name,
    componentTypes: so.summary.componentTypes ?? [],
    enabled: so.summary.enabled,
    children: (so.descendantsTree ?? []).map(toNode),
  };
  return { ok: true, host: host.name, tree: root };
}

/** Read a live property value off a runtime component (best-effort). */
export async function readElementProperty(
  client: McpClient,
  uniqueId: string,
  componentType: string,
  propertyName: string,
): Promise<unknown> {
  const data = await query<{ sceneObject?: { component?: { value?: unknown } } }>(
    client,
    `{ sceneObject(uniqueId: "${uniqueId}") { component(type: "${componentType}") { property(name: "${propertyName}") { value } } } }`,
  );
  return data?.sceneObject?.component?.value ?? null;
}
