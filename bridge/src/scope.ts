// Scoped-apply guard (TD-1, TD-8). The safety contract that replaces the
// sandbox-marker hard-gate.
//
// Every MCP scene mutation must target the edit-surface root or one of its
// descendants. Every asset write must resolve under <assetsDir>/LensDesigner/.
// Both invariants are enforced at a single choke point — the helper functions
// in `mcp.ts`. There is no bypass path.
//
// The guard tracks the permitted SO set as a Set<UUID>:
//   - Seeded on attach with {editSurfaceRoot, ...all current descendants}
//     (so the applier's teardown-rebuild can delete pre-existing children).
//   - `markCreated(uuid)` adds a SO whenever the bridge successfully creates
//     one with a permitted parent.
//   - `markDeleted(uuid)` removes a SO whenever the bridge deletes one.
//
// When no scope is active (e.g., the bridge is not attached to anything),
// mutations are not guarded. The choke-point helpers MUST NOT be callable
// without first going through ConnectionManager (which sets the scope on
// attach and clears it on detach).

import { resolve, sep } from 'node:path';

export class ScopedApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopedApplyError';
  }
}

export interface ApplyScopeContext {
  /** Edit-surface root SO UUID. Scene mutations rooted here are permitted. */
  editSurfaceRoot: string;
  /**
   * Absolute filesystem path of the project's `Assets/` directory. Asset
   * writes are constrained to `<assetsRoot>/LensDesigner/`.
   */
  assetsRoot: string;
}

/**
 * One active apply scope. Owned by ConnectionManager; passed by reference
 * into mcp.ts via `setActiveScope`. Cleared on detach.
 */
export class ApplyScope {
  private readonly editSurfaceRoot: string;
  private readonly assetsLensDesignerDir: string;
  private readonly permittedSOs: Set<string>;

  constructor(ctx: ApplyScopeContext, initialDescendants: Iterable<string> = []) {
    this.editSurfaceRoot = ctx.editSurfaceRoot;
    this.assetsLensDesignerDir = resolve(ctx.assetsRoot, 'LensDesigner');
    this.permittedSOs = new Set([ctx.editSurfaceRoot, ...initialDescendants]);
  }

  /** UUID of the edit-surface root. Useful for the applier as parent of created SOs. */
  get root(): string {
    return this.editSurfaceRoot;
  }

  /** Absolute path of the project's `Assets/LensDesigner/` directory. */
  get lensDesignerDir(): string {
    return this.assetsLensDesignerDir;
  }

  /** All currently-permitted UUIDs (root SO + tracked descendants + assets we own). */
  get descendants(): ReadonlySet<string> {
    return this.permittedSOs;
  }

  /** True iff a mutation targeting `soUUID` is permitted. */
  permits(soUUID: string): boolean {
    return this.permittedSOs.has(soUUID);
  }

  /**
   * Refuse a mutation whose target UUID is outside the permitted set.
   *
   * The permitted set tracks both scene-object UUIDs (created via
   * `createSceneObject`) AND asset UUIDs (`createAssetFromPreset`,
   * `createPrefabFromSceneObject`, `duplicateAsset`) — they're all
   * unique in LS's UUID namespace, so one set is enough. `op` names
   * the operation (e.g. 'setProperty', 'deleteAsset') so surfacing
   * errors is debuggable.
   */
  assertPermittedUUID(uuid: string | null | undefined, op: string): void {
    if (!uuid) {
      throw new ScopedApplyError(`${op}: refused — target UUID is null/undefined`);
    }
    if (!this.permittedSOs.has(uuid)) {
      throw new ScopedApplyError(
        `${op}: refused — UUID ${uuid} is outside the permitted scope ` +
          `(root=${this.editSurfaceRoot})`,
      );
    }
  }

  /** @deprecated alias for `assertPermittedUUID`. Kept temporarily for tests
   *  that still reference the old name; new callers should use the new name. */
  assertSceneTarget(uuid: string | null | undefined, op: string): void {
    return this.assertPermittedUUID(uuid, op);
  }

  /**
   * Refuse a disk-write whose absolute path is outside Assets/LensDesigner/.
   * Path-traversal safe: uses `path.resolve` to normalize before checking.
   */
  assertAssetPath(absPath: string, op: string): void {
    const resolved = resolve(absPath);
    const root = this.assetsLensDesignerDir;
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new ScopedApplyError(
        `${op}: refused — ${resolved} is outside ${root}`,
      );
    }
  }

  /**
   * Refuse an MCP asset path (project-relative, e.g. "LensDesigner/foo.mat")
   * that is outside the LensDesigner namespace. Used for MCP asset ops that
   * never touch the filesystem from the bridge side (deleteAsset,
   * createAssetFromPreset, duplicateAsset, createPrefabFromSceneObject).
   */
  assertProjectRelativeAssetPath(relPath: string, op: string): void {
    if (relPath === 'LensDesigner' || relPath.startsWith('LensDesigner/')) return;
    throw new ScopedApplyError(
      `${op}: refused — project-relative asset path ${JSON.stringify(relPath)} ` +
        `is outside LensDesigner/`,
    );
  }

  /** Record a newly-created SO as permitted. */
  markCreated(uuid: string): void {
    this.permittedSOs.add(uuid);
  }

  /** Drop a deleted SO from the permitted set. */
  markDeleted(uuid: string): void {
    this.permittedSOs.delete(uuid);
  }
}

// ---- Module-level singleton ----
//
// Set by ConnectionManager on attach (one per active target). Read by every
// mutating helper in mcp.ts. When null, helpers are unguarded — this is the
// pre-attach state (e.g., the bridge has just started and is still scanning).
// mcp.ts mutating helpers should never be called pre-attach; if they are,
// that's a bridge bug, not a scope bypass.

let active: ApplyScope | null = null;

export function setActiveScope(s: ApplyScope | null): void {
  active = s;
}

export function getActiveScope(): ApplyScope | null {
  return active;
}

/**
 * Fail-closed variant of `getActiveScope()`. Throws if no scope is active —
 * use this from every mutating helper in `mcp.ts` so a pre-attach mutation
 * is a structural impossibility, not just a documented convention (TD-8).
 *
 * The one legitimate exception is `ConnectionManager`'s edit-bay bootstrap
 * (which has to create an SO before the scope can be activated). That path
 * uses `createBootstrapSceneObject` in `mcp.ts`, the only helper that
 * bypasses this check.
 */
export function requireActiveScope(op: string): ApplyScope {
  if (!active) {
    throw new ScopedApplyError(
      `${op}: refused — no active scope (bridge is not attached to a Lens Studio target)`,
    );
  }
  return active;
}
