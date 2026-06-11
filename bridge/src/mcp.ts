// mcp.ts — minimal MCP client for the Lens Studio HTTP server.
//
// LS exposes its MCP at http://localhost:<port>/mcp with a Bearer token.
// Port varies per LS instance (Settings → API). Multiple LS instances can
// run side-by-side on different ports — we don't bake any single port into
// the bridge. The bearer is shared across instances (keychain-backed).
//
// Discovery order:
//   1. LS_MCP_URL env  — full URL override
//   2. LS_MCP_PORT env — combined with http://localhost:<port>/mcp
//   3. Marker scan     — parallel-probe ports 50000-50100 for the sandbox
//                        marker SO (SANDBOX_MARKER_NAME). The marker is
//                        unique to the lens-designer sandbox, so the scan
//                        finds the right instance even when multiple LS
//                        instances are running.
// Bearer continues to auto-discover from ~/.claude.json (any lens-studio
// entry — they all share the same keychain token). LS_MCP_BEARER env
// override.
//
// The transport is "streamable HTTP" but LS replies with a plain JSON body
// (not SSE) for tools/call, so we just POST JSON-RPC and parse the response.
// No session ID required for this server.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { LD_STATE_CONTROLLER_FILENAME, LD_STATE_CONTROLLER_SRC } from './runtime/state-controller.ts';
import {
  LD_RUNTIME_MODULE_FILENAME,
  LD_RUNTIME_MODULE_SRC,
  LD_RUNTIME_GATE_FILENAME,
  LD_RUNTIME_GATE_SRC,
} from './runtime/runtime-module.ts';
import { getActiveScope, requireActiveScope } from './scope.ts';

/**
 * Absolute path to the sandbox project's Assets directory. Needed for
 * binary writes (images) that MCP's text-only ReadWriteTextFile can't do.
 * The sandbox is NOT vendored in this repo — the desktop app's Create
 * Sandbox flow downloads it from github.com/stevejabs/spectacles-sandbox
 * into ~/Documents/spectacles-sandbox (see desktop/src/sandbox-ipc.ts);
 * this default matches that location. Override via env if relocated.
 */
export const SANDBOX_ASSETS_DIR =
  process.env['LENS_DESIGNER_SANDBOX_DIR'] ??
  `${process.env['HOME'] ?? ''}/Documents/spectacles-sandbox/sandbox/Assets`;

/**
 * Resolve a sandbox-relative asset path (e.g. "LensDesigner/images/x.png")
 * to an absolute path under the Assets dir. Guards against path traversal:
 * only paths that stay inside Assets/ are allowed. Used by the HTTP server
 * to serve ingested images and fonts back to the web canvas.
 *
 * Root resolution: prefer the currently-active ApplyScope's assets root —
 * that's the actual on-disk path of the project LS is attached to (resolved
 * via lsof on the LS process). Fall back to SANDBOX_ASSETS_DIR only when
 * there's no active scope, which is the pre-attach window. Without this,
 * uploads ingested into the user's real sandbox at e.g.
 * `/Users/.../Documents/sandbox/Assets/` get served against the legacy
 * in-tree path and 404.
 */
export function sandboxAssetPath(relPath: string): string {
  const scope = getActiveScope();
  // ApplyScope exposes `<assetsRoot>/LensDesigner`; recover assetsRoot by
  // dropping the trailing segment.
  const assetsRoot = scope ? dirname(scope.lensDesignerDir) : SANDBOX_ASSETS_DIR;
  const abs = resolve(assetsRoot, relPath);
  const root = resolve(assetsRoot);
  if (abs !== root && !abs.startsWith(root + '/')) {
    throw new Error(`path escapes sandbox Assets: ${relPath}`);
  }
  return abs;
}

/**
 * Write the runtime state controller into the sandbox so LS imports it as a
 * TypeScriptAsset the applier can attach by name. Idempotent: only writes when
 * the on-disk content differs, so we don't churn the file (and re-trigger LS
 * compiles) on every daemon start. Returns true if it (re)wrote.
 */
export async function ensureStateControllerAsset(): Promise<boolean> {
  const abs = sandboxAssetPath(`LensDesigner/${LD_STATE_CONTROLLER_FILENAME}`);
  return writeGeneratedAssetIfChanged(abs, LD_STATE_CONTROLLER_SRC);
}

/**
 * Ship the consumer runtime into the attached project: `LensDesigner.ts`
 * (bay helpers + whenReady) and `LDRuntimeGate.ts` (the on-device posture
 * enforcer). Idempotent like ensureStateControllerAsset — writes only when
 * content differs so attach doesn't churn LS's compile. Returns the number
 * of files (re)written.
 */
export async function ensureRuntimeModuleAssets(): Promise<number> {
  const files: Array<[string, string]> = [
    [LD_RUNTIME_MODULE_FILENAME, LD_RUNTIME_MODULE_SRC],
    [LD_RUNTIME_GATE_FILENAME, LD_RUNTIME_GATE_SRC],
  ];
  let wrote = 0;
  for (const [filename, src] of files) {
    const abs = sandboxAssetPath(`LensDesigner/${filename}`);
    if (await writeGeneratedAssetIfChanged(abs, src)) wrote++;
  }
  return wrote;
}

/** Compare-then-write a generated asset. True if it (re)wrote. */
async function writeGeneratedAssetIfChanged(abs: string, src: string): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await readFile(abs, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === src) return false;
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, src, 'utf8');
  return true;
}

export interface McpConfig {
  url: string;
  bearer: string;
  source: 'env-url' | 'env-port' | 'marker-scan';
}

interface ClaudeConfigShape {
  projects?: Record<string, {
    mcpServers?: Record<string, {
      type?: string;
      url?: string;
      headers?: Record<string, string>;
    }>;
  }>;
  mcpServers?: Record<string, {
    type?: string;
    url?: string;
    headers?: Record<string, string>;
  }>;
}

/** Port range the marker scan covers. */
const SCAN_RANGE = { start: 50000, end: 50100 };
/** Per-port timeout during scan. Most ports return ECONNREFUSED in <5ms; this guards against a hung non-MCP HTTP server. */
const SCAN_TIMEOUT_MS = 800;

/** Read the shared bearer from ~/.claude.json (LS keychain → Claude Code config). */
export async function resolveBearer(): Promise<string> {
  const envBearer = process.env.LS_MCP_BEARER;
  if (envBearer) return envBearer;

  const configPath = resolve(homedir(), '.claude.json');
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    throw new Error(
      `could not read ${configPath} for bearer auto-discovery: ${(err as Error).message}. ` +
        `Set LS_MCP_BEARER to override.`,
    );
  }
  const parsed = JSON.parse(raw) as ClaudeConfigShape;

  const candidates: Array<NonNullable<ClaudeConfigShape['mcpServers']>[string]> = [];
  if (parsed.mcpServers?.['lens-studio']) candidates.push(parsed.mcpServers['lens-studio']);
  for (const proj of Object.values(parsed.projects ?? {})) {
    const entry = proj.mcpServers?.['lens-studio'];
    if (entry) candidates.push(entry);
  }
  for (const entry of candidates) {
    const auth = entry.headers?.['Authorization'] ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (m) return m[1]!;
  }
  throw new Error(
    `no lens-studio Bearer token found in ${configPath}. ` +
      `Set LS_MCP_BEARER to override.`,
  );
}

/**
 * Probe a port for the sandbox marker SO. Returns:
 *   - { hasMarker: true } if MCP responds and the marker exists
 *   - { hasMarker: false } if MCP responds but no marker
 *   - null if not reachable / not MCP / auth fails
 */
async function probePort(
  port: number,
  bearer: string,
): Promise<{ port: number; hasMarker: boolean } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'GetLensStudioSceneObjectByName',
          arguments: { name: SANDBOX_MARKER_NAME },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { content?: Array<{ text?: string }> };
      error?: unknown;
    };
    if (json.error || !json.result?.content?.[0]?.text) return null;
    const payload = JSON.parse(json.result.content[0]!.text!) as { objects?: unknown[] };
    return {
      port,
      hasMarker: Array.isArray(payload.objects) && payload.objects.length > 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Summary of one discovered Lens Studio MCP instance — exposed to the
 * connection layer + the target picker. `hasMarker` flags the sandbox.
 */
export interface InstanceSummary {
  port: number;
  hasMarker: boolean;
}

/**
 * Parallel scan for every MCP-responsive LS instance in `SCAN_RANGE`.
 * Returns each instance's port + whether it carries the sandbox marker.
 *
 * Dedupes the LS HTTP+SSE port pair (N, N+1 from one LS process) down to
 * the lower port. Non-responsive / non-MCP / auth-failing ports are
 * omitted. Lowest-port-first ordering.
 *
 * Used by `scanForSandbox` (back-compat sandbox-mode auto-attach) and by
 * the attach-mode target picker (which can show every instance).
 */
export async function scanInstances(bearer: string): Promise<InstanceSummary[]> {
  const ports: number[] = [];
  for (let p = SCAN_RANGE.start; p <= SCAN_RANGE.end; p++) ports.push(p);
  const results = await Promise.all(ports.map((p) => probePort(p, bearer)));
  const found = results
    .filter((r): r is { port: number; hasMarker: boolean } => r !== null)
    .sort((a, b) => a.port - b.port);
  // LS binds an HTTP+SSE pair (N, N+1) from a single process; both probe-
  // identically (same scene → same hasMarker). Drop the higher port of any
  // such pair so the picker shows one row per instance.
  const out: InstanceSummary[] = [];
  for (const r of found) {
    const prev = out[out.length - 1];
    if (prev && r.port === prev.port + 1 && r.hasMarker === prev.hasMarker) continue;
    out.push(r);
  }
  return out;
}

/** Parallel scan for the sandbox marker. Returns the first matching port (lowest), or null. */
async function scanForSandbox(bearer: string): Promise<number | null> {
  const instances = await scanInstances(bearer);
  const marked = instances.filter((i) => i.hasMarker);
  if (marked.length === 0) return null;
  if (marked.length > 1) {
    // After the port-pair dedup above, any remaining duplicates are real
    // distinct LS instances both carrying the marker. Warn — picker should
    // be used to disambiguate in attach mode.
    process.stderr.write(
      `warning: multiple sandbox markers found on ports ${marked
        .map((m) => m.port)
        .join(', ')}; using ${marked[0]!.port}\n`,
    );
  }
  return marked[0]!.port;
}

/** Resolve the LS MCP url + bearer. See discovery order at the top of the file. */
export async function resolveConfig(): Promise<McpConfig> {
  const bearer = await resolveBearer();

  const envUrl = process.env.LS_MCP_URL;
  if (envUrl) return { url: envUrl, bearer, source: 'env-url' };

  const envPort = process.env.LS_MCP_PORT;
  if (envPort) {
    const n = Number.parseInt(envPort, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 65535) {
      throw new Error(`LS_MCP_PORT must be a valid TCP port, got ${envPort}`);
    }
    return { url: `http://localhost:${n}/mcp`, bearer, source: 'env-port' };
  }

  const port = await scanForSandbox(bearer);
  if (port === null) {
    throw new Error(
      [
        `no LS instance with the sandbox marker found in ports ${SCAN_RANGE.start}-${SCAN_RANGE.end}.`,
        ``,
        `Possible causes:`,
        `  - Sandbox project is not open in Lens Studio`,
        `  - LS MCP server hasn't started yet (wait a few seconds after LS launch)`,
        `  - LS MCP port is outside ${SCAN_RANGE.start}-${SCAN_RANGE.end} (set LS_MCP_PORT to override)`,
        `  - Sandbox project is open but missing the "${SANDBOX_MARKER_NAME}" root SO`,
      ].join('\n'),
    );
  }
  return { url: `http://localhost:${port}/mcp`, bearer, source: 'marker-scan' };
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface CallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** JSON-RPC client over HTTP for the LS MCP server. */
export class McpClient {
  private readonly url: string;
  private readonly bearer: string;
  private nextId = 1;
  private initialized = false;

  constructor(config: McpConfig) {
    this.url = config.url;
    this.bearer = config.bearer;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const body = { jsonrpc: '2.0', id, method, params };
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.bearer}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`MCP ${method} HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw new Error(`MCP ${method} error ${json.error.code}: ${json.error.message}`);
    }
    if (json.result === undefined) {
      throw new Error(`MCP ${method} returned neither result nor error`);
    }
    return json.result;
  }

  async initialize(): Promise<{ serverName: string; serverVersion: string; protocolVersion: string }> {
    const result = await this.rpc<{
      serverInfo: { name: string; version: string };
      protocolVersion: string;
    }>('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'lens-designer-bridge', version: '0.0.0' },
    });
    this.initialized = true;
    return {
      serverName: result.serverInfo.name,
      serverVersion: result.serverInfo.version,
      protocolVersion: result.protocolVersion,
    };
  }

  /** Call a tool and parse the JSON payload from content[0].text. */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.initialized) await this.initialize();
    const result = await this.rpc<CallToolResult>('tools/call', { name, arguments: args });
    if (result.isError) {
      const msg = result.content[0]?.text ?? '<no error text>';
      throw new Error(`tool ${name} failed: ${msg}`);
    }
    const text = result.content[0]?.text;
    if (text === undefined) {
      throw new Error(`tool ${name} returned no text content`);
    }
    return JSON.parse(text) as T;
  }
}

// ---- Sandbox safety gate ----
//
// The bridge must NEVER mutate the user's main lens project. Architecture
// invariant: authoring runs against a dedicated sandbox LS project the
// bridge owns. We identify the sandbox by a uniquely-named root scene
// object that only the sandbox carries.
//
// If LS is open with anything else (e.g. the live queueboo project), the
// marker lookup fails and every mutate path aborts before touching state.
// MCP doesn't expose a "current project name" tool in this LS build, so
// the in-scene marker is the only identification mechanism we have.

/** Name of the marker scene object required at sandbox root. */
export const SANDBOX_MARKER_NAME = '__LENS_DESIGNER_SANDBOX__';

export class NotSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSandboxError';
  }
}

/**
 * Confirm the connected LS instance is the lens-designer sandbox. Throws
 * NotSandboxError if not — caller should surface the message and exit.
 */
export async function assertSandbox(client: McpClient): Promise<void> {
  let res: { objects?: LSSceneObject[] } | undefined;
  try {
    res = await client.callTool<{ objects?: LSSceneObject[] }>(
      'GetLensStudioSceneObjectByName',
      { name: SANDBOX_MARKER_NAME },
    );
  } catch (err) {
    // The MCP server throws when no SO matches. Treat as "not the sandbox".
    const msg = (err as Error).message;
    if (/no scene object|not found|0 scene object/i.test(msg)) {
      res = { objects: [] };
    } else {
      throw err;
    }
  }
  if (!res?.objects || res.objects.length === 0) {
    throw new NotSandboxError(
      [
        `Refusing to mutate: connected LS instance is NOT the lens-designer sandbox.`,
        `(Looked for a scene object named "${SANDBOX_MARKER_NAME}" and didn't find one.)`,
        ``,
        `The bridge must never touch your main lens project. To proceed:`,
        `  1. Open your sandbox project in Lens Studio (Create sandbox in the app`,
        `     downloads it from github.com/stevejabs/spectacles-sandbox),`,
        `  2. Confirm it has a root scene object named "${SANDBOX_MARKER_NAME}",`,
        `  3. Re-run this command.`,
        ``,
        `If multiple LS instances are open, the bridge will scan for the sandbox`,
        `automatically. To pin to a specific LS, set LS_MCP_PORT=<port>.`,
      ].join('\n'),
    );
  }
}

// ---- Typed helpers for the tools the bridge uses ----

export interface LSComponent {
  id: string;
  name: string;
  enabled: boolean;
  properties: Record<string, unknown>;
}

export interface LSSceneObject {
  id: string;
  name: string;
  enabled?: boolean;
  components: LSComponent[];
  children: LSSceneObject[];
}

export async function getSceneObjectByName(
  client: McpClient,
  name: string,
): Promise<LSSceneObject> {
  const res = await client.callTool<{ objects: LSSceneObject[] }>(
    'GetLensStudioSceneObjectByName',
    { name },
  );
  if (!res.objects || res.objects.length === 0) {
    throw new Error(`no scene object named "${name}" found in LS`);
  }
  return res.objects[0]!;
}

export type ValueType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'mat3'
  | 'transform'
  | 'reference'
  | 'rect'
  | 'layer_set_mask';

export interface SetPropertyArgs {
  objectUUID: string;
  propertyPath: string;
  value: unknown;
  valueType: ValueType;
  enumType?: string;
}

export async function setProperty(
  client: McpClient,
  args: SetPropertyArgs,
): Promise<{ message: string }> {
  requireActiveScope('setProperty').assertPermittedUUID(args.objectUUID, 'setProperty');
  return client.callTool<{ message: string }>('SetLensStudioProperty', { ...args });
}

// ---- Scene-graph mutators (used by the Phase D mutation applier) ----

export interface CreateSceneObjectResult {
  objectUUID: string;
  name: string;
  parentUUID: string | null;
  message: string;
}

/** Create a new SceneObject. Returns the new SO's UUID.
 *
 *  Fail-closed: refuses if no scope is active. The one legitimate
 *  pre-attach create (the edit-bay bootstrap) goes through
 *  `createBootstrapSceneObject` below, which is the only mutator that
 *  bypasses the guard. */
export async function createSceneObject(
  client: McpClient,
  name: string,
  parentUUID?: string,
): Promise<CreateSceneObjectResult> {
  const scope = requireActiveScope('createSceneObject');
  // Root-level creates are refused — every SO must hang off the edit surface.
  scope.assertPermittedUUID(parentUUID, 'createSceneObject');
  const args: Record<string, unknown> = { name };
  if (parentUUID !== undefined) args['parentUUID'] = parentUUID;
  const result = await client.callTool<CreateSceneObjectResult>('CreateLensStudioSceneObject', args);
  scope.markCreated(result.objectUUID);
  return result;
}

/**
 * Bootstrap escape hatch: create a SceneObject WITHOUT consulting the scope
 * guard. The ONLY legitimate caller is `connection.ts:buildAttachedTarget`,
 * which creates the `__LensDesignerEditBay__` SO at scene root before any
 * scope is active.
 *
 * If you find yourself reaching for this from anywhere else, stop and think
 * again — that's the moment a guarded mutator's invariant breaks. The whole
 * point of TD-8 is that this is the only audited bypass.
 */
export async function createBootstrapSceneObject(
  client: McpClient,
  name: string,
): Promise<CreateSceneObjectResult> {
  return client.callTool<CreateSceneObjectResult>('CreateLensStudioSceneObject', { name });
}

export interface CreateComponentResult {
  objectUUID: string;
  newComponent: {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    properties: Record<string, unknown>;
  };
  message: string;
}

/** Add a new component of `componentType` to the SO. Returns the new component's UUID via `newComponent.id`. */
export async function createComponent(
  client: McpClient,
  objectUUID: string,
  componentType: string,
): Promise<CreateComponentResult> {
  const scope = requireActiveScope('createComponent');
  scope.assertPermittedUUID(objectUUID, 'createComponent');
  const result = await client.callTool<CreateComponentResult>('CreateLensStudioComponent', {
    objectUUID,
    componentType,
  });
  // Components attach to SOs but get their own LS ids that later setProperty
  // calls target (e.g. setting scriptAsset on a ScriptComponent). Mark them
  // in scope so those subsequent writes pass the guard.
  scope.markCreated(result.newComponent.id);
  return result;
}

// ---- SIK script-component attach (interaction layer) ----
// SIK components (Interactable, PinchButton, *Feedback, …) ship as TypeScript
// assets in the project. We attach one by creating a ScriptComponent and
// pointing its `scriptAsset` reference at the SIK asset. See the
// reference_attach_sik_components_via_mcp memory.

/** Cache of asset ids by `type:name`. SIK package assets are stable per LS
 *  session, but a generated view controller can be deleted + recreated with a
 *  NEW uuid (user deletes the .ts, codegen rewrites it) — so the cache MUST be
 *  invalidated for that name when the controller is regenerated, or
 *  attachScriptComponent re-uses the dead uuid → a dangling ScriptComponent. */
const scriptAssetIdCache = new Map<string, string>();

/** Drop every cached asset-id for a name (any type) so the next lookup
 *  re-queries LS. Called by codegen when a controller is regenerated. */
export function clearScriptAssetIdCache(name: string): void {
  for (const key of [...scriptAssetIdCache.keys()]) {
    if (key === name || key.endsWith(`:${name}`)) scriptAssetIdCache.delete(key);
  }
}

/**
 * Resolve a project asset's UUID by its exact name (e.g. "Interactable").
 * `assetType` narrows by LS asset type — REQUIRED whenever the name is
 * ambiguous: a published view has BOTH `<Name>.prefab` (ObjectPrefab) and
 * `<Name>.ts` (TypeScriptAsset) under the same asset NAME, and
 * GetLensStudioAssetsByName returns them in NON-DETERMINISTIC order (verified
 * live 2026-06-10 — BookCoverView returned prefab-first, BookSpineView
 * ts-first). Picking the prefab for a scriptAsset assignment produced the
 * dangling-Script/Uid-00000000 corruption.
 */
export async function getAssetIdByName(
  client: McpClient,
  name: string,
  assetType?: string,
): Promise<string | null> {
  const cacheKey = assetType ? `${assetType}:${name}` : name;
  const cached = scriptAssetIdCache.get(cacheKey);
  if (cached) return cached;
  const res = await client.callTool<{ assets: Array<{ id: string; name: string; type?: string }> }>(
    'GetLensStudioAssetsByName',
    { name },
  );
  const exact = res.assets.find(
    (a) => a.name === name && (!assetType || a.type === assetType),
  );
  if (exact) scriptAssetIdCache.set(cacheKey, exact.id);
  return exact?.id ?? null;
}

/**
 * Attach an SIK component (by asset name) to a SceneObject. Creates a
 * ScriptComponent and assigns the SIK TypeScript asset to it. Returns the
 * new component's UUID, or null if the SIK asset isn't in the project.
 */
export async function attachScriptComponent(
  client: McpClient,
  objectUUID: string,
  scriptAssetName: string,
): Promise<string | null> {
  // Type-constrained: a published view's .prefab shares the asset NAME with
  // its controller .ts — binding the prefab here is exactly the dangling-
  // ScriptComponent bug.
  const assetId = await getAssetIdByName(client, scriptAssetName, 'TypeScriptAsset');
  if (!assetId) return null;
  const comp = await createComponent(client, objectUUID, 'ScriptComponent');
  const componentId = comp.newComponent.id;
  await setProperty(client, {
    objectUUID: componentId,
    propertyPath: 'scriptAsset',
    valueType: 'reference',
    value: assetId,
  });
  return componentId;
}

/**
 * Capture a SceneObject subtree as a prefab asset. `destinationPath` is an
 * Assets-relative folder (no extension); LS writes `<destinationPath>/<name>.prefab`.
 * Returns the new prefab asset's UUID.
 */
export async function createPrefabFromSceneObject(
  client: McpClient,
  objectUUID: string,
  destinationPath: string,
  prefabName: string,
): Promise<{ prefabAssetUUID: string; prefabPath: string }> {
  const scope = requireActiveScope('createPrefabFromSceneObject');
  scope.assertPermittedUUID(objectUUID, 'createPrefabFromSceneObject');
  scope.assertProjectRelativeAssetPath(destinationPath, 'createPrefabFromSceneObject');
  const result = await client.callTool<{ prefabAssetUUID: string; prefabPath: string }>(
    'CreatePrefabFromSceneObject',
    { objectUUID, destinationPath, prefabName },
  );
  scope.markCreated(result.prefabAssetUUID);
  return result;
}

/**
 * Absolute path to the currently-attached project's `Assets/LensDesigner/`
 * directory. Resolved at call time (not import time) so it follows the
 * active ApplyScope rather than freezing on the legacy in-tree sandbox.
 */
export function sandboxLensDesignerDir(): string {
  return sandboxAssetPath('LensDesigner');
}

/** Delete a SceneObject by UUID. */
export async function deleteSceneObject(
  client: McpClient,
  objectUUID: string,
): Promise<{ message: string }> {
  const scope = requireActiveScope('deleteSceneObject');
  scope.assertPermittedUUID(objectUUID, 'deleteSceneObject');
  const result = await client.callTool<{ message: string }>('DeleteLensStudioSceneObject', {
    objectUUID,
  });
  scope.markDeleted(objectUUID);
  return result;
}

/** Fetch a SceneObject by UUID. */
export async function getSceneObjectById(
  client: McpClient,
  objectUUID: string,
): Promise<{ object: LSSceneObject }> {
  return client.callTool<{ object: LSSceneObject }>('GetLensStudioSceneObjectById', {
    objectUUID,
  });
}

export interface CreateAssetFromPresetResult {
  assetType: string;
  assetUUID: string;
  name: string;
  path: string;
  message: string;
}

/**
 * Instantiate a built-in LS preset as a fresh asset (Material, Mesh,
 * Texture, ...). Returns the new asset's UUID. The preset name is one
 * from `GetPresetRegistryTool` — for solid-fill Image components we
 * use `ImageMaterialPreset`.
 *
 * Each call creates a NEW asset, so a per-node call gives every
 * Rectangle its own material instance (color writes don't bleed).
 */
export async function createAssetFromPreset(
  client: McpClient,
  preset: string,
  name: string,
  folderPath?: string,
): Promise<CreateAssetFromPresetResult> {
  const scope = requireActiveScope('createAssetFromPreset');
  if (folderPath !== undefined) {
    scope.assertProjectRelativeAssetPath(folderPath, 'createAssetFromPreset');
  }
  const args: Record<string, unknown> = { preset, name };
  if (folderPath !== undefined) args['folderPath'] = folderPath;
  const result = await client.callTool<CreateAssetFromPresetResult>('CreateAssetFromPresetTool', args);
  scope.markCreated(result.assetUUID);
  return result;
}

/** Delete an asset by UUID. Used to clean up per-node materials on teardown. */
export async function deleteAsset(
  client: McpClient,
  assetUUID: string,
): Promise<{ message: string }> {
  const scope = requireActiveScope('deleteAsset');
  scope.assertPermittedUUID(assetUUID, 'deleteAsset');
  const result = await client.callTool<{ message: string }>('DeleteLensStudioAsset', { assetUUID });
  scope.markDeleted(assetUUID);
  return result;
}

/**
 * Rename an asset in place (UUID stable — references to it survive). Used by
 * true view rename to carry the controller `.ts` + `.prefab` to the new code
 * identity without breaking the bay's ScriptComponent or wired prefab refs.
 * Caller must pass an asset that lives under `LensDesigner/` — verified here
 * via `assetPath` (the project-relative path the caller resolved the UUID
 * from), which substitutes for the created-this-session scope check the way
 * the adopted-material path does. Schema verified against LS 5.15.4 MCP
 * (`RenameAsset {assetUUID, newName}`) 2026-06-08.
 */
export async function renameAsset(
  client: McpClient,
  assetUUID: string,
  newName: string,
  assetPath: string,
): Promise<{ message: string }> {
  const scope = requireActiveScope('renameAsset');
  scope.assertProjectRelativeAssetPath(assetPath, 'renameAsset');
  scope.markCreated(assetUUID); // adopted designer-owned asset (path-verified)
  return client.callTool<{ message: string }>('RenameAsset', { assetUUID, newName });
}

/**
 * Delete a designer-owned asset by its project-relative path (must live under
 * `LensDesigner/`). Resolves the UUID, permits it (path-verified ownership,
 * same rationale as renameAsset), and deletes via DeleteLensStudioAsset.
 * Returns false when the asset doesn't exist. Used by the rename orphan sweep
 * (backlog 9): a stale old-name controller would keep compiling — and erroring
 * — forever.
 */
export async function deleteOwnedAssetByPath(
  client: McpClient,
  relPath: string,
): Promise<boolean> {
  const scope = requireActiveScope('deleteOwnedAssetByPath');
  scope.assertProjectRelativeAssetPath(relPath, 'deleteOwnedAssetByPath');
  let id: string;
  try {
    ({ id } = await getAssetByPath(client, relPath));
  } catch {
    return false; // already gone
  }
  scope.markCreated(id);
  await client.callTool<{ message: string }>('DeleteLensStudioAsset', { assetUUID: id });
  scope.markDeleted(id);
  return true;
}

/**
 * Delete a component by UUID. Used by the dangling-ScriptComponent heal:
 * a generated controller deleted out from under its bay instance leaves a
 * ScriptComponent pointing at a dead asset, which breaks apply/publish.
 * `hostSoUUID` must be a designer-owned SO (the scope check) — we never
 * delete components off foreign objects.
 */
export async function deleteComponent(
  client: McpClient,
  componentUUID: string,
  hostSoUUID: string,
): Promise<{ message: string }> {
  const scope = requireActiveScope('deleteComponent');
  scope.assertPermittedUUID(hostSoUUID, 'deleteComponent');
  scope.markCreated(componentUUID);
  return client.callTool<{ message: string }>('DeleteLensStudioComponent', { componentUUID });
}

export interface ListedAsset {
  id: string;
  name?: string;
  type?: string;
  path?: string;
}

/** Resolve an asset by its in-project path. Returns the UUID. */
export async function getAssetByPath(client: McpClient, path: string): Promise<{ id: string; name: string }> {
  const res = await client.callTool<{ asset: { id: string; name: string } }>(
    'GetLensStudioAssetByPath',
    { path },
  );
  return { id: res.asset.id, name: res.asset.name };
}

export interface TextureInfo {
  id: string;
  width: number;
  height: number;
}

/**
 * Resolve a FileTexture by path → UUID + pixel dimensions. LS exposes the
 * imported size under properties.fileInfo.{width,height}; we need it to
 * compute the image's aspect ratio for fit/fill math.
 */
export async function getTextureInfo(client: McpClient, path: string): Promise<TextureInfo> {
  const res = await client.callTool<{
    asset: { id: string; properties?: { fileInfo?: { width?: number; height?: number } } };
  }>('GetLensStudioAssetByPath', { path });
  const fi = res.asset.properties?.fileInfo;
  return {
    id: res.asset.id,
    width: typeof fi?.width === 'number' ? fi.width : 0,
    height: typeof fi?.height === 'number' ? fi.height : 0,
  };
}

/**
 * Ingest raw image bytes into the sandbox as a FileTexture. Content-hashed
 * filename → identical images dedupe to one asset and the ref is stable.
 * Writes the file (binary; ReadWriteTextFile can't), waits for LS to import
 * it, and returns the texture path + UUID + dimensions.
 *
 * `ext` is the lowercased extension without a dot ('png' | 'jpg' | ...).
 */
export async function ingestImageBytes(
  client: McpClient,
  bytes: Buffer,
  ext: string,
): Promise<{ path: string; info: TextureInfo }> {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'png';
  const filename = `images/img_${hash}.${safeExt}`;
  const relPath = `LensDesigner/${filename}`;
  const scope = requireActiveScope('ingestImageBytes');
  const absPath = resolve(scope.lensDesignerDir, filename);
  scope.assertAssetPath(absPath, 'ingestImageBytes');

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, bytes);

  // Poll for LS to import the texture (file watcher debounce + decode).
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const info = await getTextureInfo(client, relPath);
      if (info.width > 0 && info.height > 0) return { path: relPath, info };
    } catch {
      // not imported yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`LS did not import the image at ${relPath} within 10s`);
}

/**
 * Ingest a .ttf/.otf font: content-hash, write into the sandbox fonts dir,
 * and wait for LS's file-watcher to import it as a Font asset. Returns the
 * sandbox-relative path + the imported Font asset's UUID. Mirrors
 * ingestImageBytes — LS auto-imports dropped fonts the same way it does
 * textures (verified on-device 2026-05-24).
 */
export async function ingestFontBytes(
  client: McpClient,
  bytes: Buffer,
  ext: string,
): Promise<{ path: string; uuid: string; name: string }> {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const safeExt = /^(ttf|otf)$/.test(ext) ? ext : 'ttf';
  const filename = `fonts/font_${hash}.${safeExt}`;
  const relPath = `LensDesigner/${filename}`;
  const scope = requireActiveScope('ingestFontBytes');
  const absPath = resolve(scope.lensDesignerDir, filename);
  scope.assertAssetPath(absPath, 'ingestFontBytes');

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, bytes);

  // Poll for LS to import the font (file watcher debounce).
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const asset = await getAssetByPath(client, relPath);
      if (asset && asset.id) return { path: relPath, uuid: asset.id, name: asset.name };
    } catch {
      // not imported yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`LS did not import the font at ${relPath} within 10s`);
}

/** Duplicate an existing asset. Returns the new asset's UUID. */
export async function duplicateAsset(
  client: McpClient,
  assetUUID: string,
  newName?: string,
  folderPath?: string,
): Promise<{ assetUUID: string; name: string; path: string }> {
  const scope = requireActiveScope('duplicateAsset');
  // Source assetUUID is a READ of an existing asset (typically a template
  // installed by the base pack), so it is not required to be in scope. The
  // destination — newName + folderPath — must land under LensDesigner/.
  if (folderPath !== undefined) {
    scope.assertProjectRelativeAssetPath(folderPath, 'duplicateAsset');
  }
  const args: Record<string, unknown> = { assetUUID };
  if (newName !== undefined) args['newName'] = newName;
  if (folderPath !== undefined) args['folderPath'] = folderPath;
  const res = await client.callTool<{ assetUUID: string; name: string; path: string }>(
    'DuplicateLensStudioAsset',
    args,
  );
  scope.markCreated(res.assetUUID);
  return res;
}

// LS 5.15.4's DuplicateLensStudioAsset is broken for Material assets
// (verified for both ShaderGraph-backed and preset materials). For
// per-node materialization we instead read the source .mat YAML via
// MCP's ReadWriteTextFile, generate fresh UUIDs, and write a duplicate
// to a deterministic path. LS picks the new asset up on filesystem
// rescan and we reuse it across applies for the same node id.

/**
 * Read a project-resident text file via MCP. Path is project-relative
 * (e.g. `LensDesigner/views.json`). MCP wraps LS's filesystem so we don't
 * need the absolute Assets/ path.
 */
// Serialize ALL project-file reads/writes through one queue. LS's
// ReadWriteTextFile is not atomic across concurrent ops, so a write
// (e.g. saveRegistry rewriting views.json) interleaving with a read
// produced a torn, half-written file → "views.json is not valid JSON".
// Chaining every op guarantees a read never overlaps a write.
let _fileOpChain: Promise<unknown> = Promise.resolve();
function serializeFileOp<T>(op: () => Promise<T>): Promise<T> {
  const result = _fileOpChain.then(op, op);
  // Keep the chain alive regardless of this op's outcome.
  _fileOpChain = result.then(() => undefined, () => undefined);
  return result;
}

export async function readProjectTextFile(client: McpClient, path: string): Promise<string> {
  return serializeFileOp(async () => {
    // Read the real file directly when attached. LS's ReadWriteTextFile
    // TRUNCATES large reads — verified 2026-06-04: a 28365-byte views.json
    // came back as 28363 chars, dropping the final "\n}" → "views.json is not
    // valid JSON" on every load. (Files under ~15KB read back byte-exact, so
    // this only bit once the registry grew past the threshold.) The bridge
    // runs on the same machine as the project, so a direct fs read has the
    // full file and no torn-read window. ENOENT propagates as "absent" (what
    // callers like generateInPlace already expect). Only paths inside the
    // project's Assets dir take this path; anything else (no scope yet, or a
    // template asset that lives outside Assets) falls back to the MCP read.
    const scope = getActiveScope();
    if (scope) {
      const assetsRoot = resolve(dirname(scope.lensDesignerDir));
      const abs = resolve(assetsRoot, path);
      if (abs === assetsRoot || abs.startsWith(assetsRoot + '/')) {
        return await readFile(abs, 'utf8');
      }
    }
    const res = await client.callTool<{ content: string }>('ReadWriteTextFile', {
      action: 'read',
      filePath: path,
    });
    return res.content;
  });
}

/** Write a project-resident text file via MCP. Path is project-relative.
 *  Serialized against all other project-file I/O (see serializeFileOp). */
export async function writeProjectTextFile(
  client: McpClient,
  path: string,
  content: string,
): Promise<void> {
  return serializeFileOp(async () => {
    await client.callTool<unknown>('ReadWriteTextFile', {
      action: 'write',
      filePath: path,
      content,
    });
  });
}

/**
 * Property overrides to bake into the .mat YAML at duplicate time.
 * Writing values directly into the file (rather than via separate
 * SetLensStudioProperty calls after import) avoids a race where LS's
 * file watcher fires AFTER our property writes and re-imports the .mat,
 * silently reverting baseColor/strokeColor/etc back to the source's
 * values. Single file write → single LS import → final state.
 */
export interface MaterialOverrides {
  /** Fill color, vec4 in 0–1 range. */
  baseColor?: { x: number; y: number; z: number; w: number };
  /** Stroke color, vec4 in 0–1 range. */
  strokeColor?: { x: number; y: number; z: number; w: number };
  /** Stroke width, normalized to the shader's UV unit space (0–0.5). */
  strokeThickness?: number;
  /** Per-corner radii in CM (the RoundedRectCore SDF now measures in cm). */
  cornerTL?: number;
  cornerTR?: number;
  cornerBR?: number;
  cornerBL?: number;
  /**
   * Box size in CM (w, h). Fed to the RoundedRectCore SDF so it measures
   * distance in cm rather than normalized UV — without this, corners on a
   * non-square quad stretch into ellipses. No-op on materials that don't
   * expose a boxSize param (e.g. the Ellipse material).
   */
  boxSize?: { x: number; y: number };
  /** Number of sides for the Polygon SDF shader (3+). Float-typed param. */
  sides?: number;
  /**
   * Force the material's blend mode. The LensDesignerRoundedRect graph
   * saves with `BlendMode: Disabled`, which ignores alpha entirely. Set
   * 'PremultipliedAlphaAuto' (LS's standard transparency mode, used by
   * ~all UI materials in the project) so the shader's computed alpha
   * drives transparency. ('Normal' is NOT a valid LS blend enum — it
   * renders the error/magenta material.)
   */
  blendMode?: 'PremultipliedAlphaAuto' | 'Disabled';

  // ---- Image (LensDesignerImage: samples baseTex, feeds RoundedRectCore) ----
  /** Texture asset UUID for the image fill. Set via SetLensStudioProperty
   *  (reference), not baked into YAML — the typeIdx-9 sampler block is
   *  awkward to patch and a reference SetProperty is reliable. */
  baseTexUUID?: string;
  /** UV scale for the fit transform: texUV = uv * texScale + texOffset. */
  texScale?: { x: number; y: number };
  /** UV offset for the fit transform. */
  texOffset?: { x: number; y: number };
}

/**
 * Disk-clone an asset-library material for per-node use. The clone
 * inherits the source's shader graph (Pass + texture references stay
 * shared) but gets its own Material + PassInfo UUIDs so per-instance
 * property writes don't bleed between nodes.
 *
 * Every call writes fresh UUIDs — LS's in-memory asset state often
 * outlives the disk file (DeleteLensStudioAsset is broken for Material
 * assets in 5.15.4), so a cache check on path would return a stale UUID
 * with no backing file. The cost of always rewriting is one read +
 * two writes per apply per disk-templated material; cheap.
 *
 * Source manifest content is cached in-process to skip the read on
 * repeat applies — only the new file's UUIDs need regenerating.
 */
const sourceMaterialCache = new Map<string, { mat: string }>();

function bakeMaterialOverrides(yaml: string, overrides: MaterialOverrides): string {
  let out = yaml;
  // A property can serialize in TWO shapes depending on whether LS treats
  // it as an exposed Property (map) or a CachedProperty (list item):
  //   map :  "    name:\n      typeIdx: N\n      value: …"
  //   list:  "    - name:\n        typeIdx: N\n        value: …"
  // The image material puts subgraph-fed params (boxSize/corners/stroke)
  // under CachedProperties while others land under Properties, so the bake
  // must match both. `[ ]+` matches the (varying) indentation but never a
  // newline; `(?:- )?` allows the list dash.
  const blockHead = (name: string, typeIdx: number) =>
    `((?:^|\\n)[ ]+(?:- )?${name}:\\n[ ]+typeIdx: ${typeIdx}\\n[ ]+value: )`;

  const setVec4 = (name: string, v: { x: number; y: number; z: number; w: number }) => {
    out = out.replace(
      new RegExp(blockHead(name, 5) + `\\{x: [^}]+\\}`),
      `$1{x: ${v.x.toFixed(6)}, y: ${v.y.toFixed(6)}, z: ${v.z.toFixed(6)}, w: ${v.w.toFixed(6)}}`,
    );
  };
  const setNumber = (name: string, n: number) => {
    out = out.replace(new RegExp(blockHead(name, 1) + `[\\-0-9.]+`), `$1${n.toFixed(6)}`);
  };
  const setVec2 = (name: string, v: { x: number; y: number }) => {
    out = out.replace(
      new RegExp(blockHead(name, 3) + `\\{x: [^}]+\\}`),
      `$1{x: ${v.x.toFixed(6)}, y: ${v.y.toFixed(6)}}`,
    );
  };
  // Texture param (typeIdx 9): replace the `id:` inside its value block.
  const setTexture = (name: string, uuid: string) => {
    out = out.replace(
      new RegExp(`((?:^|\\n)[ ]+(?:- )?${name}:\\n[ ]+typeIdx: 9\\n[ ]+value:\\n[ ]+id: )[0-9a-f-]{36}`),
      `$1${uuid}`,
    );
  };

  if (overrides.baseColor) setVec4('baseColor', overrides.baseColor);
  if (overrides.strokeColor) setVec4('strokeColor', overrides.strokeColor);
  if (typeof overrides.strokeThickness === 'number') setNumber('strokeThickness', overrides.strokeThickness);
  if (typeof overrides.cornerTL === 'number') setNumber('cornerTL', overrides.cornerTL);
  if (typeof overrides.cornerTR === 'number') setNumber('cornerTR', overrides.cornerTR);
  if (typeof overrides.cornerBR === 'number') setNumber('cornerBR', overrides.cornerBR);
  if (typeof overrides.cornerBL === 'number') setNumber('cornerBL', overrides.cornerBL);
  if (typeof overrides.sides === 'number') {
    const before = out;
    setNumber('sides', overrides.sides);
    if (out === before) {
      // Same as boxSize: an unchanged value sat at the shader's param
      // default (unserialized), so inject it as a CachedProperty (typeIdx 1
      // = float) to survive the file-watcher reimport.
      const entry = `    - sides:\n        typeIdx: 1\n        value: ${overrides.sides.toFixed(6)}\n`;
      if (/\n  CachedProperties:\n {4}\[\]/.test(out)) {
        out = out.replace(/(\n  CachedProperties:\n) {4}\[\]/, `$1${entry.replace(/\n$/, '')}`);
      } else {
        out = out.replace(/(\n  CachedProperties:\n)/, `$1${entry}`);
      }
    }
  }
  if (overrides.boxSize) {
    const before = out;
    setVec2('boxSize', overrides.boxSize);
    if (out === before) {
      // boxSize isn't in the .mat — it sat at the param default (1,1),
      // which LS doesn't serialize. Inject it as a CachedProperty (the
      // section corners live in, which the reimport honors) so our value
      // sticks instead of falling back to the shader default.
      const v = overrides.boxSize;
      const entry =
        `    - boxSize:\n        typeIdx: 3\n        value: {x: ${v.x.toFixed(6)}, y: ${v.y.toFixed(6)}}\n`;
      if (/\n  CachedProperties:\n {4}\[\]/.test(out)) {
        out = out.replace(/(\n  CachedProperties:\n) {4}\[\]/, `$1${entry.replace(/\n$/, '')}`);
      } else {
        out = out.replace(/(\n  CachedProperties:\n)/, `$1${entry}`);
      }
    }
  }
  if (overrides.texScale) setVec2('texScale', overrides.texScale);
  if (overrides.texOffset) setVec2('texOffset', overrides.texOffset);
  if (overrides.baseTexUUID) setTexture('baseTexture', overrides.baseTexUUID);
  if (overrides.blendMode) {
    out = out.replace(/(\n  BlendMode: )\w+/, `$1${overrides.blendMode}`);
  }
  return out;
}

export async function duplicateMaterialAssetOnDisk(
  client: McpClient,
  sourcePath: string,
  destFolder: string,
  destName: string,
  overrides: MaterialOverrides = {},
): Promise<{ assetUUID: string; path: string }> {
  const destPath = `${destFolder}/${destName}.mat`;
  const scope = requireActiveScope('duplicateMaterialAssetOnDisk');
  // Source path is a READ (of a template the base pack installed), so it is
  // intentionally not asserted in scope. Destination must land under
  // LensDesigner/.
  scope.assertProjectRelativeAssetPath(destFolder, 'duplicateMaterialAssetOnDisk');

  let cached = sourceMaterialCache.get(sourcePath);
  if (!cached) {
    // First try the loose-files layout (old in-tree sandbox + any
    // Editable-unpacked install). On "Does not exist" — the locked-
    // install case where the .mat lives inside Assets/LensDesigner.lspkg
    // (a zip) that MCP's ReadWriteTextFile can't see — fall back to
    // reading the same asset directly out of the bundled .lspkg.
    let matBody: string;
    try {
      matBody = await readProjectTextFile(client, sourcePath);
    } catch (looseErr) {
      const { readPackedAsset } = await import('./pack.ts');
      try {
        matBody = await readPackedAsset(sourcePath);
      } catch (packedErr) {
        throw new Error(
          `could not read source material ${sourcePath}: ` +
            `MCP read failed (${(looseErr as Error).message}); ` +
            `bundled .lspkg fallback failed (${(packedErr as Error).message})`,
        );
      }
    }
    cached = { mat: matBody };
    sourceMaterialCache.set(sourcePath, cached);
  }
  const matBody = cached.mat;

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const matMatch = matBody.match(new RegExp(`!<Material\\/(${UUID_RE.source})>`));
  const passMatch = matBody.match(new RegExp(`!<PassInfo\\/(${UUID_RE.source})>`));
  if (!matMatch || !passMatch) {
    throw new Error(
      `could not parse source material UUIDs from ${sourcePath} ` +
        `(material=${!!matMatch}, passInfo=${!!passMatch})`,
    );
  }
  const oldMatUUID = matMatch[1]!;
  const oldPassUUID = passMatch[1]!;

  const newMatUUID = randomUUID();
  const newPassUUID = randomUUID();

  const withFreshIds = matBody
    .split(oldMatUUID)
    .join(newMatUUID)
    .split(oldPassUUID)
    .join(newPassUUID);

  // Bake the per-node property values into the YAML BEFORE writing.
  // Doing this in-band avoids a race: LS's file watcher fires ~600ms
  // after our write, and any SetLensStudioProperty calls we make in
  // that window get reverted when LS re-imports the .mat. Writing the
  // final values up-front means LS imports the asset once with the
  // correct state and nothing has to be patched after.
  const newMatBody = bakeMaterialOverrides(withFreshIds, overrides);

  // Write only the .mat. Skipping the .mat.meta lets LS auto-generate
  // one with a fresh AssetImportMetadata UUID. Writing both files
  // triggers the FS watcher twice and causes LS to parallel-import the
  // same .mat on two threads, which trips a "duplicate id" check on the
  // AssetImportMetadata UUID and poisons the asset registration.
  await writeProjectTextFile(client, destPath, newMatBody);

  // Confirm LS imported the new asset before returning. LS's filesystem
  // watcher debounces, so we poll up to 8s with a 200ms cadence. This
  // is one-time per node id — subsequent applies hit the cached path.
  // Poll for LS's file-watcher to pick up the .mat. The watcher's debounce
  // is typically <100 ms, so 50 ms is well-targeted — saves ~150 ms per
  // import vs. the old 200 ms cadence (compounds across N cold-path
  // materials). Total budget unchanged at 8 s (160 attempts × 50 ms).
  for (let attempt = 0; attempt < 160; attempt++) {
    try {
      const asset = await getAssetByPath(client, destPath);
      scope.markCreated(asset.id);
      return { assetUUID: asset.id, path: destPath };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`LS did not import the duplicated material at ${destPath} within 8s`);
}

// ---- Package install (Step 5) ----

export interface InstalledPackage {
  id: string;
  name: string;
  version?: { major: number; minor: number; patch: number };
}

/** List every package installed in the connected project. */
export async function listInstalledPackages(client: McpClient): Promise<InstalledPackage[]> {
  const res = await client.callTool<{ packages: InstalledPackage[]; count: number }>(
    'ListInstalledPackagesTool',
    { includeDetails: false },
  );
  return res.packages;
}

/**
 * Install a Lens Studio package (`.lspkg`) into the connected project.
 *
 * **The MCP rejects `file://` URIs** (verified in S1) — pass a plain absolute
 * filesystem path. Returns the installed package's asset UUID.
 */
export async function installPackage(
  client: McpClient,
  packageAbsPath: string,
): Promise<{ assetUUID: string; message: string }> {
  return client.callTool<{ assetUUID: string; message: string }>(
    'InstallLensStudioPackage',
    { packageUri: packageAbsPath },
  );
}

/** List assets, optionally filtered by name pattern. */
export async function listAssets(
  client: McpClient,
  opts: {
    nameFilter?: string;
    assetTypeFilter?: string;
    pathFilter?: string;
  } = {},
): Promise<ListedAsset[]> {
  const args: Record<string, unknown> = { includeUUID: true, includeName: true };
  if (opts.nameFilter !== undefined) args['nameFilter'] = opts.nameFilter;
  if (opts.assetTypeFilter !== undefined) args['assetTypeFilter'] = opts.assetTypeFilter;
  if (opts.pathFilter !== undefined) args['pathFilter'] = opts.pathFilter;
  const res = await client.callTool<{ assets?: ListedAsset[] }>('ListLensStudioAssets', args);
  return res.assets ?? [];
}
