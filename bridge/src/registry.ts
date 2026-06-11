// View registry — read/write Assets/LensDesigner/views.json via MCP
// ReadWriteTextFile. The project-resident source of truth for view trees
// in attach mode (TD-5).
//
// The registry IS the document store. Adding / updating / deleting views
// here is the bridge's reaction to the corresponding `view.save`/`view.delete`
// WS messages. Generate (Step 8) lives separately and is triggered by save.
//
// Sources:
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §TD-5, §2.1
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md Step 6

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type McpClient,
  readProjectTextFile,
  writeProjectTextFile,
} from './mcp.ts';
import { DesignNodeSchema, type DesignNode } from './protocol.ts';

// Registry on-disk format version.
//   v1 — { registryVersion, views: [{…, generated:{prefab,controller,atVersion}}] }
//   v2 — adds a `project` header (the project's self-description: name + last-known
//        assets path) and a per-view `scene` link (the realized instance's root
//        SceneObject UUID + a stable marker) so attach can pull this one file and
//        reconcile every view against the live scene IN PLACE — no export, no
//        rewiring. v1 files load forward-compatibly (project/scene default in).
//   v3 — shared components: trees may carry Instance nodes (a reference to
//        another view by id + per-instance overrides), and GeneratedRef gains
//        `publishedAt` (drives the stale-dependents badge). v1/v2 files load
//        forward-compatibly.
export const REGISTRY_VERSION = 3;

/** Project-relative path of the registry file. */
export const REGISTRY_PATH = 'LensDesigner/views.json';

/**
 * The project's self-description, written into the manifest so a fresh attach
 * can read this one file and know what it's looking at. `assetsDir` is a
 * machine-local *hint* (the last absolute Assets path we wrote from) — the
 * manifest itself is read project-relative over MCP, so this is for the
 * designer's recent-projects/re-attach convenience, not a hard dependency.
 */
export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  assetsDir: z.string().default(''),
  lensDesignerVersion: z.string().default(''),
  updatedAt: z.number().finite(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

/**
 * Link from a view to its realized instance in the project scene. Lets attach
 * find the exact object to edit IN PLACE (reconcile) instead of rebuilding —
 * which is what preserves the user's wiring across designer restarts. `rootUUID`
 * is the instance's root SceneObject; `markerId` is a stable id we stamp on the
 * instance as a fallback when the UUID drifts (project moved, object re-created
 * by hand). Null until the view has been realized into the scene.
 */
export const SceneLinkSchema = z.object({
  rootUUID: z.string().min(1),
  markerId: z.string().min(1),
});
export type SceneLink = z.infer<typeof SceneLinkSchema>;

/** Pointer to a view's generated artifacts (set by `view.save → generate`).
 *  Under the no-export model the controller `.ts` is the only artifact — it's
 *  written in place and the live scene instance is the template. `prefab` is
 *  legacy/optional (older v1 manifests carry it; new saves omit it). */
export const GeneratedRefSchema = z.object({
  prefab: z.string().min(1).optional(),
  controller: z.string().min(1),
  /** Bumps each save; the UI uses this to detect "dirty" vs the saved snapshot. */
  atVersion: z.number().int().positive(),
  /** When the prefab was last (re)published. Shared components: a definition
   *  edited after this means dependents' prefabs are stale. */
  publishedAt: z.number().finite().optional(),
});
export type GeneratedRef = z.infer<typeof GeneratedRefSchema>;

/** A single saved view. */
export const ViewRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'view name must start with a letter and contain only letters, digits, dashes, or underscores'),
  tree: z.array(DesignNodeSchema),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  generated: GeneratedRefSchema.nullable(),
  /** Live-scene link for in-place reconcile. Null until realized. */
  scene: SceneLinkSchema.nullable().default(null),
});
export type ViewRecord = z.infer<typeof ViewRecordSchema>;

/** The registry as a whole — the project manifest. */
export const ViewRegistrySchema = z.object({
  // Accept older versions on read; we always normalize + write the current one.
  registryVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  project: ProjectMetaSchema.optional(),
  views: z.array(ViewRecordSchema),
});
export type ViewRegistry = z.infer<typeof ViewRegistrySchema>;

/** Distinct error for the WS handler to surface as a structured response. */
export class RegistryParseError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'RegistryParseError';
  }
}

/** Empty initial registry. */
export function emptyRegistry(): ViewRegistry {
  return { registryVersion: REGISTRY_VERSION, views: [] };
}

/** Find a view by id. */
export function findViewById(reg: ViewRegistry, id: string): ViewRecord | undefined {
  return reg.views.find((v) => v.id === id);
}

/** Find a view by name. Case-insensitive (collision detection mirrors the UI). */
export function findViewByName(reg: ViewRegistry, name: string): ViewRecord | undefined {
  const lower = name.toLowerCase();
  return reg.views.find((v) => v.name.toLowerCase() === lower);
}

/**
 * Order the views as the UI consumes them: most-recently-edited first
 * (matches the spec's Views-panel row order).
 */
export function listViews(reg: ViewRegistry): ViewRecord[] {
  return [...reg.views].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Load `views.json` from the connected project.
 *
 * Returns an empty registry when the file is absent (first-time use). Throws
 * `RegistryParseError` on malformed JSON or schema mismatch — never silently
 * overwrites a corrupt registry.
 */
export async function loadRegistry(client: McpClient): Promise<ViewRegistry> {
  let raw: string;
  try {
    raw = await readProjectTextFile(client, REGISTRY_PATH);
  } catch (err) {
    // ReadWriteTextFile's not-found error message varies by LS version.
    // LS 5.15.4 currently surfaces "Cannot open file (Does not exist, , 0000)";
    // other shapes include "not found", "no such file", ENOENT. Match the
    // common substrings; permission / IO failures still propagate.
    const msg = (err as Error).message ?? '';
    if (/not found|no such file|enoent|cannot find|cannot open|does not exist/i.test(msg)) {
      return emptyRegistry();
    }
    throw err;
  }
  if (raw.trim() === '') return emptyRegistry();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryParseError(
      `views.json is not valid JSON: ${(err as Error).message}`,
      err,
    );
  }

  const result = ViewRegistrySchema.safeParse(parsed);
  if (!result.success) {
    throw new RegistryParseError(
      `views.json does not match the registry schema: ${result.error.message}`,
      result.error,
    );
  }
  // Normalize forward: a v1 file is upgraded in memory (scene defaults to null
  // via the schema, project stays undefined until attach sets it) and persisted
  // as the current version on the next save.
  return { ...result.data, registryVersion: REGISTRY_VERSION };
}

/** Save the registry to views.json. */
export async function saveRegistry(client: McpClient, reg: ViewRegistry): Promise<void> {
  // Validate before writing — catches drift between in-memory mutations and
  // the on-disk schema. Cheap insurance against ever persisting bad state.
  ViewRegistrySchema.parse(reg);
  const json = JSON.stringify(reg, null, 2);
  await writeProjectTextFile(client, REGISTRY_PATH, json);
}

export interface UpsertInput {
  /** Existing view id — when present, updates that record. */
  id?: string;
  name: string;
  tree: DesignNode[];
  /** Optional generated-asset pointer. `undefined` preserves the existing one. */
  generated?: GeneratedRef | null;
  /** Override the now() timestamp (test injection). */
  now?: number;
}

export interface UpsertResult {
  reg: ViewRegistry;
  record: ViewRecord;
  /**
   * Set when the new name is already used by a DIFFERENT view (the WS
   * handler surfaces this as the "PoiCard already exists — Update existing
   * · Save as new" branch in the Save dialog).
   */
  nameCollision?: { existingId: string };
}

/**
 * Insert (if `id` is missing or unknown) or update a view by id.
 *
 * Updates bump `updatedAt`. Inserts allocate a fresh id + set
 * `createdAt = updatedAt`. Either way, the resulting view sits at the
 * front of the list (`listViews` orders by `updatedAt` desc anyway).
 */
export function upsertView(reg: ViewRegistry, input: UpsertInput): UpsertResult {
  const now = input.now ?? Date.now();

  const existing = input.id ? findViewById(reg, input.id) : undefined;
  const nameOwner = findViewByName(reg, input.name);
  const nameCollision =
    nameOwner && nameOwner.id !== existing?.id ? { existingId: nameOwner.id } : undefined;

  if (existing) {
    const updated: ViewRecord = {
      ...existing,
      name: input.name,
      tree: input.tree,
      updatedAt: now,
      generated: input.generated !== undefined ? input.generated : existing.generated,
    };
    const next: ViewRegistry = {
      ...reg,
      views: reg.views.map((v) => (v.id === existing.id ? updated : v)),
    };
    return { reg: next, record: updated, ...(nameCollision ? { nameCollision } : {}) };
  }

  const created: ViewRecord = {
    id: input.id ?? randomUUID(),
    name: input.name,
    tree: input.tree,
    createdAt: now,
    updatedAt: now,
    generated: input.generated ?? null,
    scene: null,
  };
  return {
    reg: { ...reg, views: [created, ...reg.views] },
    record: created,
    ...(nameCollision ? { nameCollision } : {}),
  };
}

/** Remove a view by id. Returns the removed record (or null if not found). */
export function deleteView(
  reg: ViewRegistry,
  id: string,
): { reg: ViewRegistry; removed: ViewRecord | null } {
  const existing = findViewById(reg, id);
  if (!existing) return { reg, removed: null };
  return {
    reg: { ...reg, views: reg.views.filter((v) => v.id !== id) },
    removed: existing,
  };
}

/**
 * Stamp / refresh the project header. Called on attach (with the user-supplied
 * project name + the resolved assets path) so the manifest is self-describing:
 * the next attach reads this file and knows the project without being told.
 * Merges over any existing header — preserves fields the caller omits.
 */
export function setProjectMeta(
  reg: ViewRegistry,
  patch: Partial<Omit<ProjectMeta, 'updatedAt'>>,
  now: number = Date.now(),
): ViewRegistry {
  const prev = reg.project;
  const next: ProjectMeta = {
    name: patch.name ?? prev?.name ?? 'Untitled',
    assetsDir: patch.assetsDir ?? prev?.assetsDir ?? '',
    lensDesignerVersion: patch.lensDesignerVersion ?? prev?.lensDesignerVersion ?? '',
    updatedAt: now,
  };
  return { ...reg, project: next };
}

/**
 * Record (or clear) a view's link to its realized scene instance. Set when a
 * view is first instantiated into the scene; read on attach to reconcile that
 * exact object in place rather than rebuilding it.
 */
export function setSceneLink(
  reg: ViewRegistry,
  viewId: string,
  link: SceneLink | null,
): ViewRegistry {
  return {
    ...reg,
    views: reg.views.map((v) => (v.id === viewId ? { ...v, scene: link } : v)),
  };
}
