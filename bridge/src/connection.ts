// Connection manager — the generalized abstraction that replaces the
// SandboxWatcher's marker-only gate (TD-7, TD-6).
//
// Today (Step 1 of the attach-mode plan): behavior is preserved exactly —
// the manager auto-attaches the single sandbox-marker-bearing LS instance
// (same as the old watcher). The internal API is generalized so the
// attach-mode picker (Step 2) + scoped-apply guard (Step 4) + edit-bay
// (Step 3) + non-sandbox attach can layer on without further churn.
//
// Lifecycle states (per AttachSession.status):
//   idle        — not connected; no LS instance found yet
//   scanning    — actively probing the SCAN_RANGE
//   attached    — connected to a target; bridge mutations route here
//   detached    — explicitly torn down (user picked another target /
//                 bridge shutdown)
//
// The manager broadcasts state changes through `on(listener)` and exposes
// `getTarget()` to the apply pipeline + HTTP server. `getTarget()` returns
// null when not attached.

import {
  McpClient,
  resolveConfig,
  resolveBearer,
  assertSandbox,
  scanInstances,
  getSceneObjectByName,
  getSceneObjectById,
  createBootstrapSceneObject,
  attachScriptComponent,
  ensureRuntimeModuleAssets,
  setProperty,
  SANDBOX_ASSETS_DIR,
  type McpConfig,
  type InstanceSummary,
  NotSandboxError,
} from './mcp.ts';
import { LD_RUNTIME_GATE_FILENAME } from './runtime/runtime-module.ts';
import { ApplyScope, setActiveScope } from './scope.ts';
import { resetApplierCaches } from './applier.ts';
import { ensureLensDesignerPackInstalled } from './pack.ts';
import { pidListeningOnPort } from './capture.ts';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Find the on-disk project directory for the LS instance listening
 * on the given MCP port. Returns null if we can't resolve it (no LS
 * on that port, lsof unavailable, no .esproj in the process's open
 * files). Used to point the scope's `assetsDir` at the *actual*
 * project the user opened — not the legacy SANDBOX_ASSETS_DIR default.
 */
async function resolveProjectAssetsDirForPort(port: number): Promise<string | null> {
  const pid = pidListeningOnPort(port);
  if (pid === null) return null;
  try {
    // lsof -p <pid> -Fn → newline-delimited "n<path>" entries.
    const { stdout } = await execFileAsync('lsof', ['-p', String(pid), '-Fn']);
    // Pick the first .esproj-rooted lock file — LS holds one per open project.
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('n')) continue;
      const path = line.slice(1);
      const m = path.match(/^(.+\.esproj)\.[0-9]+\.lock$/);
      if (m) return `${dirname(m[1]!)}/Assets`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A connected target — the active LS project the bridge is talking to.
 * Holds the live MCP client + everything downstream needs.
 *
 * Future fields (Step 3): `editSurfaceSOName` (= 'ActiveComponent' for
 * sandbox, '__LensDesignerEditBay__' for attached) and `editSurfaceUUID`
 * (resolved on attach). For Step 1 the applier still finds ActiveComponent
 * by name on its own, so we don't need to plumb the edit surface yet.
 */
export interface Target {
  client: McpClient;
  config: McpConfig;
  /** The MCP port (extracted from config.url for convenience). */
  port: number;
  /** Whether this target carries the sandbox marker SO. */
  kind: 'sandbox' | 'attached';
  /**
   * Absolute filesystem path of the project's `Assets/` dir. Required for
   * binary ingest (image / font writes) and the export-bundle readback.
   * Sandbox mode uses `SANDBOX_ASSETS_DIR`; attached mode is user-supplied
   * via `target.set-assets-dir` (Step 2 protocol).
   */
  assetsDir: string;
  /** User-supplied display name for this attached target (from the attach
   *  dialog). Overrides the basename-derived projectName in the chip/picker.
   *  Null/undefined → fall back to the Assets-dir basename. */
  label?: string;
  /**
   * Edit surface — the SceneObject the applier rebuilds on every
   * `design.apply`. `ActiveComponent` in sandbox mode,
   * `__LensDesignerEditBay__` in attached mode (Step 3+). Resolved via
   * `getSceneObjectByName` on attach; UUID stored here so subsequent
   * operations don't re-lookup.
   */
  editSurface: { soName: string; soUUID: string };
  /**
   * App bay — the paired `__LensDesignerAppBay__` root for the project's
   * RUNTIME content (the consumer parents their app under it). The designer
   * swaps the two bays: design posture shows the edit bay and hides the app
   * bay; runtime posture is the inverse. Null in sandbox mode (the legacy
   * in-tree surface has no app side).
   */
  appBay: { soUUID: string } | null;
}

export interface AttachSession {
  status: 'idle' | 'scanning' | 'attached' | 'detached';
  target: Target | null;
  /** Human-readable reason populated when status is idle/detached. */
  reason: string | null;
}

export type SessionListener = (session: AttachSession) => void;

const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * Manages the bridge's connection to a Lens Studio instance.
 *
 * Phase-1 behavior preserves the old SandboxWatcher contract: auto-attach
 * the single sandbox-marked instance, re-attach when it returns, broadcast
 * down/up. Attach-mode capabilities (explicit pick, non-sandbox attach,
 * edit-bay creation) land in Steps 2–4.
 */
export class ConnectionManager {
  private session: AttachSession = {
    status: 'idle',
    target: null,
    reason: 'startup pending',
  };
  private listeners = new Set<SessionListener>();
  private pollTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  /**
   * Count of consecutive `assertSandbox`-poll failures since the last
   * success. We only flip an `attached` session to `idle` after several
   * failures in a row — LS's MCP can be busy enough during a heavy apply
   * that a single poll's `assertSandbox` times out or 503s. One blip
   * shouldn't broadcast `sandbox.down` to the web (which would then trigger
   * a reconnect-and-resync, doubling the apply).
   */
  private consecutiveFailures = 0;
  private static readonly MAX_TRANSIENT_FAILURES = 3;

  /**
   * True once the user has EXPLICITLY picked a target via `attach()` (the
   * picker). While explicit, the auto-attach poll must NOT re-resolve to the
   * auto-discovered sandbox and switch the session out from under the user —
   * that was the "select port 50048, it flips back to sandbox" bug. Cleared on
   * `detach()`, which restores the legacy auto-attach-the-sandbox behavior.
   */
  private explicit = false;

  constructor(private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {}

  /** Subscribe to session-state changes. Returns an unsubscribe fn. */
  on(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Snapshot of the current session. Subscribe for live updates. */
  current(): AttachSession {
    return this.session;
  }

  /** Active target (for `apply-pipeline` / `http-server`), or null. */
  getTarget(): Target | null {
    return this.session.status === 'attached' ? this.session.target : null;
  }

  /**
   * Run one auto-attach attempt now, then start polling.
   *
   * Auto-attach = the legacy sandbox-watcher behavior: resolve config →
   * find the sandbox-marked instance → connect + assertSandbox. Attach-mode
   * explicit pick (`attach(port, …)`) is added in Step 2.
   */
  async start(): Promise<AttachSession> {
    await this.autoAttachCheck();
    if (!this.disposed) {
      this.pollTimer = setInterval(() => {
        void this.autoAttachCheck();
      }, this.pollIntervalMs);
    }
    return this.session;
  }

  /** Immediate re-check (e.g., on a new WS connection). */
  async recheck(): Promise<AttachSession> {
    await this.autoAttachCheck();
    return this.session;
  }

  /**
   * List every responsive LS instance. Used by the attach-mode picker
   * (Step 2). Does NOT change the active session.
   */
  async listInstances(): Promise<InstanceSummary[]> {
    // Resolve ONLY the bearer — NOT resolveConfig(), which throws when no
    // sandbox-marked instance is running (it scans for the marker). The picker
    // must list unmarked instances too (attaching to a user project when no
    // sandbox is open), so depending on resolveConfig here created a catch-22:
    // no marked sandbox → empty picker → can't attach the unmarked project.
    const bearer = await resolveBearer().catch(() => null);
    if (!bearer) return [];
    return scanInstances(bearer);
  }

  /**
   * Explicit attach — driven by the WS `target.attach` message. Replaces
   * the legacy auto-attach in the bridge's session.
   *
   * Sandbox mode keeps the existing marker check. Attached mode:
   *   1. assertSandbox is SKIPPED (the safety boundary is now scoped apply)
   *   2. installs the LensDesigner pack (idempotent)
   *   3. find-or-create `__LensDesignerEditBay__` at scene root
   *   4. seed the active scope from the edit-bay subtree
   *
   * Requires a valid LS instance reachable at the given port.
   */
  async attach(opts: {
    port: number;
    mode: 'sandbox' | 'attached';
    assetsDir?: string;
    /** User-supplied display name (attached mode). */
    label?: string;
  }): Promise<AttachSession> {
    // Clean detach of any existing session first.
    setActiveScope(null);

    try {
      // Bearer only — NOT resolveConfig(), which scans for the sandbox marker
      // and throws when none is running. An explicit attach targets a specific
      // port (opts.port), so the marker scan is irrelevant here and was causing
      // "no sandbox marker found" when attaching an unmarked project.
      const bearer = await resolveBearer();
      const url = `http://localhost:${opts.port}/mcp`;
      const config: McpConfig = { url, bearer, source: 'env-port' };
      const client = new McpClient(config);
      await client.initialize();

      if (opts.mode === 'sandbox') {
        await assertSandbox(client);
        const target = await buildSandboxTarget(client, config, opts.port);
        await activateScopeForTarget(client, target);
        resetApplierCaches();
        this.session = { status: 'attached', target, reason: null };
        this.explicit = true; // user picked this — poll must not switch it
        this.emit(this.session);
        return this.session;
      }

      // attached mode
      if (!opts.assetsDir) {
        throw new Error('target.attach: attached mode requires assetsDir');
      }
      if (!existsSync(opts.assetsDir)) {
        throw new Error(`target.attach: assetsDir ${opts.assetsDir} does not exist`);
      }
      // Install the base pack (idempotent — skipped if already present).
      await ensureLensDesignerPackInstalled(client);

      const target = await buildAttachedTarget(client, config, opts.port, opts.assetsDir, opts.label);
      await activateScopeForTarget(client, target);

      // Ship the consumer runtime (LensDesigner.ts + LDRuntimeGate.ts) into
      // Assets/LensDesigner/ — needs the scope active for the assets-root
      // resolution. Compare-then-write, so a re-attach is a no-op.
      try {
        const wrote = await ensureRuntimeModuleAssets();
        if (wrote > 0) {
          process.stdout.write(`bridge: wrote ${wrote} runtime asset(s) to Assets/LensDesigner/\n`);
        }
      } catch (err) {
        process.stderr.write(`bridge: runtime assets write failed: ${(err as Error).message}\n`);
      }

      // Design posture: edit bay visible, app bay hidden. The inverse happens
      // on detach (and on device via LDRuntimeGate).
      await setBayPosture(target, 'design');

      // Attach the on-device posture enforcer to both bays. Background — on a
      // first attach LS needs a few seconds to import the freshly-written
      // gate asset, and the attach result shouldn't wait on that.
      void ensureRuntimeGates(client, target).catch((err) => {
        process.stderr.write(`bridge: runtime gate attach skipped: ${(err as Error).message}\n`);
      });

      resetApplierCaches();
      this.session = { status: 'attached', target, reason: null };
      this.explicit = true; // user picked this — poll must not switch it
      this.emit(this.session);
      return this.session;
    } catch (err) {
      // Mid-attach failure leaves the bridge with no scope and no usable
      // target. Roll the session to idle so subsequent applies fail with a
      // clear "not attached" message instead of asserting against a stale
      // target whose scope no longer exists.
      setActiveScope(null);
      this.session = {
        status: 'idle',
        target: null,
        reason: `attach failed: ${(err as Error).message}`,
      };
      this.emit(this.session);
      throw err;
    }
  }

  /** Explicit detach = release to the app. Flips the bays to runtime posture
   *  (edit bay hidden, app bay shown) so the project is immediately runnable,
   *  THEN clears the scope; the bridge becomes idle and the auto-attach poll
   *  resumes (so it falls back to the sandbox if one is running). */
  async detach(): Promise<AttachSession> {
    const target = this.getTarget();
    if (target) {
      try {
        await setBayPosture(target, 'runtime');
      } catch (err) {
        // LS gone / scope refused — non-fatal. LDRuntimeGate still enforces
        // runtime posture on device; in-editor the user can re-attach.
        process.stderr.write(`bridge: detach posture swap failed: ${(err as Error).message}\n`);
      }
    }
    setActiveScope(null);
    this.explicit = false;
    this.session = { status: 'detached', target: null, reason: 'detached by request' };
    this.emit(this.session);
    return this.session;
  }

  /**
   * Update the active target's assets directory (Step 2's
   * `target.set-assets-dir`). Used in attached mode when the user
   * supplies / corrects the project path. Refreshes the scope so the
   * asset-write boundary moves with it.
   */
  async setAssetsDir(assetsDir: string): Promise<AttachSession> {
    const t = this.getTarget();
    if (!t) throw new Error('target.set-assets-dir: not currently attached');
    if (!existsSync(assetsDir)) {
      throw new Error(`target.set-assets-dir: ${assetsDir} does not exist`);
    }
    t.assetsDir = assetsDir;
    await activateScopeForTarget(t.client, t);
    this.emit(this.session);
    return this.session;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.listeners.clear();
    setActiveScope(null);
  }

  /**
   * Legacy auto-attach path: connect to the sandbox-marked instance and
   * keep it alive. Equivalent to the old SandboxWatcher.check().
   *
   * Reuses the existing client across polls when the URL is unchanged —
   * each `initialize` call shows up as a "Client connected" line in LS's
   * log, so re-init-on-every-poll spams the log every 5s and adds round-
   * trips. `assertSandbox` alone is enough to confirm liveness.
   */
  private async autoAttachCheck(): Promise<void> {
    // Liveness-only. The legacy behavior here auto-attached the in-tree
    // sandbox by scanning for the __LENS_DESIGNER_SANDBOX__ marker — but the
    // in-tree sandbox (the only project with the ActiveComponent surface
    // sandbox mode requires) no longer exists, while projects CREATED from
    // the sandbox template still carry the marker. The scan therefore kept
    // "finding" real projects, attempting sandbox attach, and failing with
    // "no scene object named ActiveComponent" (2026-06-11). Sessions are now
    // explicit-attach only; this poll just keeps an idle session labeled.
    if (this.session.status === 'attached') return;
    if (this.session.status === 'detached') return; // stay quiet post-detach
    const reason = 'no project attached — use Connect… to pick a Lens Studio instance';
    if (this.session.status !== 'idle' || this.session.reason !== reason) {
      this.session = { status: 'idle', target: null, reason };
      this.emit(this.session);
    }
  }

  private emit(s: AttachSession): void {
    for (const fn of this.listeners) {
      try {
        fn(s);
      } catch (err) {
        process.stderr.write(
          `[connection] listener threw: ${(err as Error).message}\n`,
        );
      }
    }
  }
}

function portFromUrl(url: string): number {
  try {
    return Number.parseInt(new URL(url).port || '80', 10);
  } catch {
    return 0;
  }
}

/**
 * Build a `Target` for the sandbox-marked LS instance. Resolves the edit
 * surface (`ActiveComponent`) UUID.
 */
async function buildSandboxTarget(
  client: McpClient,
  config: McpConfig,
  port: number,
): Promise<Target> {
  const so = await getSceneObjectByName(client, 'ActiveComponent');
  // Resolve the actual on-disk project Assets/ via lsof on the LS
  // process. Falls back to SANDBOX_ASSETS_DIR (the legacy hardcoded
  // in-tree sandbox path) only if the lookup fails — that path is
  // wrong for any new download-and-open sandbox flow.
  const resolved = await resolveProjectAssetsDirForPort(port);
  const assetsDir = resolved ?? SANDBOX_ASSETS_DIR;
  process.stdout.write(
    `bridge: sandbox assetsDir = ${assetsDir} (resolved=${resolved !== null})\n`,
  );
  return {
    client,
    config,
    port,
    kind: 'sandbox',
    assetsDir,
    editSurface: { soName: 'ActiveComponent', soUUID: so.id },
    appBay: null,
  };
}

/** Name of the bridge-owned edit bay in attached-mode targets. */
export const EDIT_BAY_SO_NAME = '__LensDesignerEditBay__';

/** Name of the paired app-content root (the consumer's runtime content lives
 *  under it). Sibling of the edit bay; the designer swaps their visibility. */
export const APP_BAY_SO_NAME = '__LensDesignerAppBay__';

/**
 * Name of the marker SceneObject the bridge writes as a child of every bay
 * it creates. On re-attach, finding the bay BUT no marker means a foreign
 * SO happens to share our reserved name — refuse rather than adopt
 * (architecture §7 edge case).
 */
export const EDIT_BAY_MARKER_NAME = '__LensDesignerOwned__';

/**
 * Find-or-create a bridge-owned bay root by name, verifying ownership via the
 * `__LensDesignerOwned__` child marker so we never adopt a foreign SO that
 * happens to share our reserved name. Used for both the edit bay and the app
 * bay. Pre-scope: uses `createBootstrapSceneObject` (the lone scope-guard
 * bypass — see mcp.ts) because the scope can't activate until the bays exist.
 */
async function findOrCreateOwnedBay(client: McpClient, bayName: string): Promise<string> {
  let bayUUID: string | null = null;
  try {
    const existing = await getSceneObjectByName(client, bayName);
    bayUUID = existing.id;
  } catch {
    bayUUID = null; // not found — create below
  }

  if (bayUUID) {
    // Adoption check: confirm a bridge-written child marker exists. If the
    // bay is there but the marker isn't, the user has a foreign SO that
    // happens to share our reserved name — refuse rather than touch it.
    const owned = await isBridgeOwnedBay(client, bayUUID);
    if (!owned) {
      throw new Error(
        `target.attach: SceneObject "${bayName}" already exists in this project ` +
          `but is missing the "${EDIT_BAY_MARKER_NAME}" marker the bridge writes when it owns ` +
          `the bay. Refusing to adopt a foreign SO. Rename or remove the existing object in ` +
          `Lens Studio, then retry.`,
      );
    }
    return bayUUID;
  }

  const created = await createBootstrapSceneObject(client, bayName);
  bayUUID = created.objectUUID;
  // Drop the ownership marker as a child of the new bay. This bay-create
  // happens before any scope is active, so the marker SO has to be
  // created through the bootstrap helper too. Subsequent attaches will
  // see this marker and recognize the bay as ours. The marker is created
  // at root then re-parented (the bootstrap helper deliberately mirrors
  // LS's default at-root create), so find it by id, not name — a second
  // bay's marker would otherwise resolve the FIRST bay's already-parented
  // marker by name and steal it.
  const marker = await createBootstrapSceneObject(client, EDIT_BAY_MARKER_NAME);
  await reparentBootstrapMarker(client, marker.objectUUID, bayUUID);
  return bayUUID;
}

/**
 * Build a `Target` for a non-sandbox project: find-or-create BOTH bays —
 * `__LensDesignerEditBay__` (the design workspace the applier rebuilds) and
 * `__LensDesignerAppBay__` (the consumer's runtime content root).
 */
async function buildAttachedTarget(
  client: McpClient,
  config: McpConfig,
  port: number,
  assetsDir: string,
  label?: string,
): Promise<Target> {
  const editBayUUID = await findOrCreateOwnedBay(client, EDIT_BAY_SO_NAME);
  const appBayUUID = await findOrCreateOwnedBay(client, APP_BAY_SO_NAME);

  return {
    client,
    config,
    port,
    kind: 'attached',
    assetsDir,
    ...(label && label.trim().length > 0 ? { label: label.trim() } : {}),
    editSurface: { soName: EDIT_BAY_SO_NAME, soUUID: editBayUUID },
    appBay: { soUUID: appBayUUID },
  };
}

// ---- Bay posture ----

export type BayPosture = 'design' | 'runtime';

/**
 * Swap which bay is visible. `design` = edit bay on, app bay off (the
 * designer's mode); `runtime` = the inverse (what a running lens wants —
 * also enforced on device by the generated LDRuntimeGate component, which
 * is a no-op in the editor so the bridge stays the editor-side authority).
 * No-op for sandbox targets (no app bay).
 */
export async function setBayPosture(target: Target, posture: BayPosture): Promise<void> {
  if (!target.appBay) return;
  const design = posture === 'design';
  await Promise.all([
    setProperty(target.client, {
      objectUUID: target.editSurface.soUUID,
      propertyPath: 'enabled',
      valueType: 'boolean',
      value: design,
    }),
    setProperty(target.client, {
      objectUUID: target.appBay.soUUID,
      propertyPath: 'enabled',
      valueType: 'boolean',
      value: !design,
    }),
  ]);
}

/**
 * Make sure both bay roots carry the generated `LDRuntimeGate` component (the
 * on-device posture enforcer). The gate asset is written to
 * `Assets/LensDesigner/LDRuntimeGate.ts` just before this runs; on first
 * attach LS may still be importing it, so retry briefly. Best-effort — a
 * failure logs and the next attach retries; never blocks the attach result.
 */
async function ensureRuntimeGates(client: McpClient, target: Target): Promise<void> {
  if (!target.appBay) return;
  const gateName = LD_RUNTIME_GATE_FILENAME.replace(/\.ts$/, '');
  const bays = [target.editSurface.soUUID, target.appBay.soUUID];
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    // Tolerate per-attempt failures: this runs in the background after attach,
    // and a concurrent re-attach (renderer auto-attach, picker click) swaps the
    // scope out mid-poll. The next iteration sees the new scope and succeeds —
    // the bay UUIDs are stable across re-attaches to the same project.
    try {
      let allAttached = true;
      for (const soUUID of bays) {
        const so = await getSceneObjectById(client, soUUID);
        const present = (so.object.components ?? []).some((c) => c.name === gateName);
        if (present) continue;
        const cid = await attachScriptComponent(client, soUUID, gateName);
        if (!cid) allAttached = false; // asset not imported yet
      }
      if (allAttached) return;
    } catch (err) {
      lastErr = err as Error;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `could not attach ${gateName} to the bays within 10s` +
      (lastErr ? ` (last error: ${lastErr.message})` : ' (asset not imported yet?)'),
  );
}

/** Check whether a SceneObject has a `__LensDesignerOwned__` child marker. */
async function isBridgeOwnedBay(client: McpClient, bayUUID: string): Promise<boolean> {
  const res = await getSceneObjectById(client, bayUUID);
  const children = (res.object as { children?: Array<{ id: string; name?: string }> })?.children;
  if (!Array.isArray(children)) return false;
  return children.some((c) => c.name === EDIT_BAY_MARKER_NAME);
}

/**
 * Re-parent the freshly-created marker under the bay. This calls the LS MCP
 * `SetLensStudioParent` tool directly (without the scope guard) — the marker
 * was just created via `createBootstrapSceneObject`, and we're moving it
 * under the bay that was also just bootstrap-created. Both are pre-scope
 * structural setup. After this completes, `activateScopeForTarget` runs and
 * seeds the scope including the marker as a permitted descendant.
 */
async function reparentBootstrapMarker(
  client: McpClient,
  markerUUID: string,
  bayUUID: string,
): Promise<void> {
  await client.callTool('SetLensStudioParent', {
    objectUUID: markerUUID,
    parentUUID: bayUUID,
  });
}

/**
 * Walk the edit-surface subtree to enumerate every descendant SO UUID,
 * then publish a fresh `ApplyScope` seeded with {root, ...descendants}.
 *
 * Seeding from the live subtree means the applier's first teardown-rebuild
 * can delete pre-existing children (they're in scope). New SOs created
 * during the apply are added to the scope's permitted set by the mcp.ts
 * mutating helpers.
 */
async function activateScopeForTarget(
  client: McpClient,
  target: Target,
): Promise<void> {
  const descendants = new Set<string>();
  const res = await getSceneObjectById(client, target.editSurface.soUUID);
  const walk = (children: Array<{ id: string; children?: unknown[] }>): void => {
    for (const c of children) {
      descendants.add(c.id);
      const nested = (c as { children?: Array<{ id: string; children?: unknown[] }> }).children;
      if (Array.isArray(nested)) walk(nested);
    }
  };
  const rootChildren = (res.object as { children?: Array<{ id: string; children?: unknown[] }> })?.children;
  if (Array.isArray(rootChildren)) walk(rootChildren);
  // The app bay (and its marker) is bridge-owned too — permit it so the
  // posture writes (enabled on/off) and the runtime-gate attach pass the
  // guard. Its USER CONTENT stays out of scope: the applier never touches
  // app-bay descendants, only the root's enabled flag.
  if (target.appBay) descendants.add(target.appBay.soUUID);
  const scope = new ApplyScope(
    { editSurfaceRoot: target.editSurface.soUUID, assetsRoot: target.assetsDir },
    descendants,
  );
  setActiveScope(scope);
}
