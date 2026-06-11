'use client';

import { useEffect, useRef } from 'react';
import { useDesignStore } from './design-model';
import type { ClientToServerMsg, DesignNode } from '@lens-designer/bridge/client';

/** Client-side debounce. Bridge has its own 100 ms debounce on top. */
const CLIENT_DEBOUNCE_MS = 50;

interface UseAutoSyncOptions {
  connected: boolean;
  send: (msg: ClientToServerMsg) => boolean;
}

/**
 * Subscribes to the design store and ships `design.apply` to the bridge
 * whenever the tree settles. While disconnected, mutations queue
 * implicitly via the tree itself — on reconnect we ship the latest.
 *
 * NOTE: only the tree is synced. Selection + preview region are local.
 *
 * ## Transaction gating (drag / resize)
 *
 * Continuous gestures wrap their mutations in `beginTransaction()` /
 * `endTransaction()` (Canvas does this for drag-move and corner-resize).
 * We treat that as a "do not ship yet" signal: every store update while
 * `_txn !== null` is captured (so the canvas + inspector reflect it
 * locally) but NOT shipped to the bridge. The instant the transaction
 * closes (mouse-up), the latest tree fires as one `design.apply`. That
 * gives Lens Studio exactly one delete+rebuild per gesture instead of
 * an interstitial mid-drag apply followed by a final apply on release.
 */
export function useAutoSync({ connected, send }: UseAutoSyncOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the last tree we shipped so we don't re-ship after a
  // re-render that didn't actually change anything.
  const lastSentRef = useRef<string | null>(null);
  // The latest tree captured while a transaction was open — fired on
  // transaction close so a long drag ships exactly one apply on release.
  const heldDuringTxnRef = useRef<DesignNode[] | null>(null);

  useEffect(() => {
    const unsub = useDesignStore.subscribe((state, prev) => {
      // Capture transaction close transitions BEFORE the tree-change
      // short-circuit, so a drag that ends without further mutations
      // (or whose final endTransaction call happens in the same set as
      // the final tree update) still flushes the held tree.
      const txnJustClosed = prev._txn !== null && state._txn === null;
      if (state.tree !== prev.tree && state._txn !== null) {
        // Mid-transaction mutation — stash, don't ship.
        heldDuringTxnRef.current = state.tree;
        return;
      }
      if (txnJustClosed) {
        const held = heldDuringTxnRef.current ?? state.tree;
        heldDuringTxnRef.current = null;
        schedule(held);
        return;
      }
      if (state.tree === prev.tree) return; // shallow inequality already enough
      schedule(state.tree);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On (re)connect, ship the persisted preview region (if any) FIRST
  // so the first capture lands with the user's saved crop, then ship
  // the current tree so the sandbox catches up.
  //
  // Reset lastSentRef first: a reconnect usually means the bridge
  // restarted, which clears its in-memory preview cache AND its scene.
  // Without the reset, the equality guard in `fire()` would skip the
  // re-apply when the tree is unchanged — leaving the sandbox empty and
  // the preview pane stuck on a now-dead URL until the user edits a node.
  useEffect(() => {
    if (!connected) return;
    lastSentRef.current = null;
    // Drop any tree held across a transaction that was open when the
    // bridge went down. If the drag is still in progress it'll re-stash
    // itself on the next store update; if the user released during the
    // disconnect, the design store already wrote the final tree.
    heldDuringTxnRef.current = null;
    const { previewRegion, tree } = useDesignStore.getState();
    if (previewRegion) {
      send({ type: 'preview.configure-region', region: previewRegion });
    }
    schedule(tree, { immediate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  function schedule(tree: DesignNode[], opts: { immediate?: boolean } = {}): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    const fire = () => {
      timerRef.current = null;
      // Cheap structural equality via JSON; trees are small.
      const next = JSON.stringify(tree);
      if (next === lastSentRef.current) return;
      const ok = send({ type: 'design.apply', tree });
      if (ok) lastSentRef.current = next;
    };
    if (opts.immediate) {
      fire();
    } else {
      timerRef.current = setTimeout(fire, CLIENT_DEBOUNCE_MS);
    }
  }
}
