// useAutoSaveView — persist the active view's tree to the bridge
// registry on every change (debounced). Removes the "Save" button as a
// data-safety mechanism; the explicit Save dialog now only exists to
// create new views or rename existing ones.
//
// Why a separate hook from `useAutoSync`: design.apply pushes to LS for
// live preview (transient; debounced fast for UI responsiveness).
// view.save writes to the bridge's on-disk registry (durable; debounced
// slower so we don't thrash the FS during a continuous drag).
//
// Race-safety: subscriptions to zustand fire synchronously inside
// store mutations, BEFORE React processes state updates from
// `view.loaded`. If the hook captured `activeViewId` in a closure at
// effect-mount time, switching views would briefly observe a state
// where the store's `tree` was the new view's content but the closure
// still held the old `activeViewId` — and we'd save the new tree
// under the old id, silently corrupting the previous view.
// Mitigation: every read of `activeViewId` happens at fire-time from
// `useDesignStore.getState()`, not from a closed-over prop. The hook
// takes no `activeViewId` argument for the same reason.

import { useEffect, useRef } from 'react';
import type { ClientToServerMsg } from '@lens-designer/bridge/client';
import { useDesignStore } from './design-model';
import type { ViewSummary } from '@lens-designer/bridge/client';

/** Debounce window. Long enough that a continuous drag coalesces into
 *  one save; short enough that idle work is durable within a second. */
const SAVE_DEBOUNCE_MS = 800;

export interface UseAutoSaveViewOptions {
  connected: boolean;
  /** Current views list — name resolution for the save protocol. */
  views: ViewSummary[];
  send: (msg: ClientToServerMsg) => boolean;
}

export function useAutoSaveView({ connected, views, send }: UseAutoSaveViewOptions): void {
  // Stash refs so the subscription/flush closures see the freshest
  // values without re-subscribing on every change.
  const connectedRef = useRef(connected);
  const viewsRef = useRef(views);
  const sendRef = useRef(send);
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { viewsRef.current = views; }, [views]);
  useEffect(() => { sendRef.current = send; }, [send]);

  // Subscribe once, ever — never re-mount across activeViewId / tree
  // changes (that's what caused the cross-view corruption).
  useEffect(() => {
    const timer: { id: NodeJS.Timeout | null } = { id: null };
    // Track the id we last shipped a save for. Plus the JSON we shipped
    // — keyed by id so a no-op resave (same content under same id)
    // gets skipped, but switching to a view with identical content
    // doesn't.
    const lastSentByView = new Map<string, string>();

    function flush(): void {
      timer.id = null;
      if (!connectedRef.current) return;
      const state = useDesignStore.getState();
      const id = state.activeViewId;
      if (id === null) return;
      const name = viewsRef.current.find((v) => v.id === id)?.name;
      if (!name) return; // view was deleted between schedule + flush
      const json = JSON.stringify(state.tree);
      if (lastSentByView.get(id) === json) return;
      lastSentByView.set(id, json);
      sendRef.current({
        type: 'view.save',
        id,
        name,
        tree: state.tree,
        // Autosave is for durability, not for refreshing the export
        // artifacts — skipping codegen here keeps the 800ms cadence
        // off the applier's critical path and prevents racing against
        // the live-preview apply.
        skipGenerate: true,
        // Auto-publish toggle: push each change into the prefab in place
        // (stable UUID) so wired consumers update live.
        republish: state.autoPublish,
      });
    }

    function schedule(): void {
      if (timer.id) clearTimeout(timer.id);
      timer.id = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }

    let prevTree = useDesignStore.getState().tree;
    const unsub = useDesignStore.subscribe((state) => {
      if (state.tree === prevTree) return;
      prevTree = state.tree;
      schedule();
    });

    return () => {
      unsub();
      if (timer.id) clearTimeout(timer.id);
    };
  }, []);
}
