// apply-pipeline.ts — owns the design.apply lifecycle.
//
// Responsibilities:
//   1. Debounce design.apply messages (100 ms idle, latest tree wins) so
//      rapid Inspector edits coalesce into one apply.
//   2. Run the mutation applier against the sandbox MCP client.
//   3. Emit design.applied on success, design.error on failure.
//
// Preview capture is NOT part of the apply pipeline anymore — the
// LivePreview loop (live-preview.ts) captures continuously, decoupled
// from applies, so the preview always reflects whatever LS is currently
// rendering (including async material/shader uploads that finish after
// applyDesignTree returns).
//
// The pipeline is stateless across the bridge → it doesn't persist the
// tree to disk. Clients re-send their tree on reconnect (their copy
// lives in localStorage).

import {
  applyDesignTree,
  ApplyNodeError,
  emptyIncrementalState,
  type IncrementalApplyState,
} from './applier.ts';
import { ApplyScope, getActiveScope } from './scope.ts';
import type { McpClient } from './mcp.ts';
import type {
  DesignNode,
  ServerToClientMsg,
} from './protocol.ts';

/** Debounce window. 100 ms matches the design spec's "ms-fresh" feel. */
export const APPLY_DEBOUNCE_MS = 100;

export interface ApplyPipelineDeps {
  /**
   * Returns the current sandbox MCP client and the port it's bound to,
   * or null if the sandbox is not currently reachable. Called fresh on
   * every flush so we always use the up-to-date client.
   */
  getTarget: () => { client: McpClient; port: number } | null;
  /** Send a message to the client that originated this apply. */
  send: (msg: ServerToClientMsg) => void;
}

export interface PendingApply {
  tree: DesignNode[];
  /** Monotonic id so a late flush of a stale tree doesn't fire. */
  generation: number;
}

/**
 * Per-client apply pipeline. Each connected WS client gets its own
 * instance — they don't share a debounce window (otherwise two clients
 * editing concurrently would clobber each other).
 */
export class ApplyPipeline {
  private pending: PendingApply | null = null;
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  /** In-flight flush guard; we never have two applies in-flight to the same client. */
  private flushing = false;
  /**
   * Wall-clock of the most recent submit(). Used after a runJob ends to
   * decide whether to reflush immediately (user stopped editing) or wait
   * out a fresh debounce window (user is still dragging / typing).
   */
  private lastSubmitAt = 0;

  /**
   * JSON hash of the last successfully-applied tree + the scope root it
   * was applied against. Used to skip a redundant teardown-rebuild when
   * the web resends the same tree (happens right after `view.load`, where
   * the bridge applies AND the web auto-syncs the loaded tree back). The
   * scope-root pairing invalidates the cache if the target changes (LS
   * restart, project switch, attach to a different instance).
   */
  private lastAppliedHash: string | null = null;
  private lastAppliedScopeRoot: string | null = null;

  /**
   * Diff-apply state: top-level subtree fingerprints + their SO UUIDs from
   * the last successful apply. Survives across applies so the second+ apply
   * for a given view skips any top-level subtree that didn't change. Reset
   * when scope changes (different LS instance, project switch, restart).
   */
  private incremental: IncrementalApplyState = emptyIncrementalState();

  /**
   * Reference to the ApplyScope instance the most-recent successful
   * apply ran against. Used as a re-seed sentinel — when the connection
   * bounces (LS reconnects, attach refresh, etc.), `activateScopeForTarget`
   * builds a fresh ApplyScope with its own `permittedSOs` set. The cached
   * UUIDs in `incremental.topLevel` belong to the previous scope's set
   * and aren't in the new one, so a diff-apply delete would trip the
   * scope guard. Reference equality on the scope object itself is the
   * cheapest reliable signal; root UUID alone isn't enough (same
   * ActiveComponent across a reconnect → same root).
   */
  private lastScopeRef: ApplyScope | null = null;

  constructor(private readonly deps: ApplyPipelineDeps) {}

  /** Enqueue a tree; flush after APPLY_DEBOUNCE_MS of idle. */
  submit(tree: DesignNode[]): void {
    this.generation += 1;
    this.pending = { tree, generation: this.generation };
    this.lastSubmitAt = Date.now();
    if (this.timer) clearTimeout(this.timer);
    // Skip the timer while a flush is in flight — it can't do useful
    // work until flushing flips. The runJob `finally` block arms a fresh
    // debounce window when it sees pending+lastSubmitAt, which keeps
    // mid-drag submits from triggering a second apply the instant the
    // first one finishes.
    if (this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, APPLY_DEBOUNCE_MS);
  }

  /**
   * Drop the diff-apply state so the next submit rebuilds from scratch.
   * Called after `design.clear` wipes the edit surface — the cached SO
   * UUIDs are now invalid, and any incremental skip would try to address
   * deleted scene objects.
   */
  resetIncremental(): void {
    this.incremental = emptyIncrementalState();
    this.lastAppliedHash = null;
    this.lastAppliedScopeRoot = null;
    this.lastScopeRef = null;
  }

  /** Cancel any pending flush. Used on disconnect. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private async flush(): Promise<void> {
    // If a previous flush is still running, do NOT re-arm — runJob's
    // finally-block re-flushes immediately on completion if `pending`
    // advanced. Re-arming with another APPLY_DEBOUNCE_MS would just
    // delay the next apply by a full debounce window for no reason.
    if (this.flushing) return;

    const job = this.pending;
    if (!job) return;
    this.pending = null;

    this.flushing = true;
    try {
      await this.runJob(job);
    } finally {
      this.flushing = false;
      // If a fresher tree arrived during runJob, honor a fresh debounce
      // window measured from the LAST submit. If the user is still
      // dragging / typing, more submits will keep pushing lastSubmitAt
      // forward, deferring the next flush until they pause. If they've
      // already stopped, the window's near-zero and the next flush fires
      // right away. Either way: no mid-drag-double-apply.
      if (this.pending) {
        const elapsed = Date.now() - this.lastSubmitAt;
        const wait = Math.max(0, APPLY_DEBOUNCE_MS - elapsed);
        if (this.timer) clearTimeout(this.timer);
        if (wait === 0) {
          // queueMicrotask so this finally returns first; avoids
          // recursion-depth surprises if applies run synchronously fast.
          queueMicrotask(() => void this.flush());
        } else {
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
          }, wait);
        }
      }
    }
  }

  private async runJob(job: PendingApply): Promise<void> {
    const sandbox = this.deps.getTarget();
    if (!sandbox) {
      this.deps.send({
        type: 'design.error',
        error: {
          nodeId: null,
          propertyPath: null,
          lsError:
            'sandbox not reachable — open your sandbox project in Lens Studio (Create sandbox downloads it)',
        },
      });
      return;
    }

    // Re-seed guard. If the ApplyScope instance changed (LS reconnect,
    // attach refresh), our cached UUIDs belong to a dead permittedSOs
    // set — the diff path would try to delete them and the scope guard
    // would throw "outside the permitted scope". Drop everything
    // incremental and force a full rebuild this turn.
    const currentScopeRef = getActiveScope();
    if (this.lastScopeRef !== null && currentScopeRef !== this.lastScopeRef) {
      this.incremental = emptyIncrementalState();
      this.lastAppliedHash = null;
      this.lastAppliedScopeRoot = null;
    }
    this.lastScopeRef = currentScopeRef;

    // Hash-dedup. If this tree is byte-identical to the last successfully-
    // applied tree against the same scope root, skip the whole teardown-
    // rebuild cycle. Catches the duplicate apply that fires when `view.load`
    // dispatches both a bridge-side pipeline.submit AND a web-side
    // design.apply (via the design-store mutation that useAutoSync watches).
    // For 10+ node views this halves the load-view wait.
    const scopeRoot = currentScopeRef?.root ?? null;
    const treeHash = JSON.stringify(job.tree);
    if (
      this.lastAppliedHash !== null &&
      this.lastAppliedHash === treeHash &&
      this.lastAppliedScopeRoot === scopeRoot
    ) {
      // Still emit design.applied so the client's lastSent dedup stays in
      // sync, and skip the preview capture (the previous one is already
      // accurate). nodeIds are empty — nothing actually applied this turn.
      this.deps.send({
        type: 'design.applied',
        appliedAt: Date.now(),
        nodeIds: [],
      });
      return;
    }

    // 1. Apply to LS. If the scope root changed since our cached diff-apply
    // state was captured, drop it — its SO UUIDs belong to a different LS
    // instance / project and would point at nothing. applyDesignTree itself
    // re-checks this; resetting here keeps the in-memory state honest.
    if (
      this.incremental.scopeRoot !== null &&
      this.incremental.scopeRoot !== scopeRoot
    ) {
      this.incremental = emptyIncrementalState();
    }

    const t0 = Date.now();
    try {
      const result = await applyDesignTree(
        sandbox.client,
        job.tree,
        {},
        this.incremental,
      );
      const applyMs = Date.now() - t0;
      this.lastAppliedHash = treeHash;
      this.lastAppliedScopeRoot = scopeRoot;
      // Per-apply timing — useful when an apply feels slow, spammy
      // under live editing. Gate behind BRIDGE_DEBUG=1.
      if (process.env['BRIDGE_DEBUG']) {
        process.stderr.write(
          `bridge: apply ${result.nodeIds.length} nodes in ${applyMs} ms\n`,
        );
      }
      this.deps.send({
        type: 'design.applied',
        appliedAt: result.appliedAt,
        nodeIds: result.nodeIds,
      });
    } catch (err) {
      if (err instanceof ApplyNodeError) {
        this.deps.send({
          type: 'design.error',
          error: {
            nodeId: err.nodeId,
            propertyPath: err.propertyPath,
            lsError: err.lsError,
          },
        });
      } else {
        this.deps.send({
          type: 'design.error',
          error: {
            nodeId: null,
            propertyPath: null,
            lsError: (err as Error).message,
          },
        });
      }
      return;
    }

    // Preview capture is the LivePreview loop's job — it broadcasts
    // `preview.ready` on its own cadence, independent of applies.
  }
}

// Exported for tests
export const _internals = {
  APPLY_DEBOUNCE_MS,
};
