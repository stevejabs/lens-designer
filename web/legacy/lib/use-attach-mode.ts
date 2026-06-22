'use client';

// Attach-mode state hook. Owns:
//   - attach state derived from hello / attached / sandbox.down messages,
//   - view list from view.list.result,
//   - active view id (the one currently materialized in the edit surface;
//     persisted in the design store so restart restores the same view),
//   - target picker visibility + the latest scan result,
//   - view CRUD wrappers that match the autosave-as-canonical model:
//     `createNewView` mints an empty view + switches into it,
//     `renameView` updates name + tree under the existing id,
//     `loadView` switches with stash safety net,
//     `deleteView` removes from registry.
//
// Components read from this hook and dispatch through `send()`. There is
// no public `saveView` — autosave (use-auto-save-view.ts) is the only
// persistence path during editing, so an explicit save would either be
// redundant or risk overwriting a different view's data.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientToServerMsg,
  ServerToClientMsg,
  TargetSummary,
  ViewSummary,
  AttachedMsg,
} from '@lens-designer/bridge/client';
import { useDesignStore } from './design-model';
import { useDefinitions } from './definitions';
import { recordRecentProject } from './recent-projects';

export type AttachKind = 'sandbox' | 'attached';

export interface ActiveAttachment {
  kind: AttachKind;
  port: number;
  projectName: string | null;
  assetsDir: string | null;
}

export type AttachState =
  | { kind: 'idle' }
  | { kind: 'attached'; attachment: ActiveAttachment };

interface PickerState {
  open: boolean;
  scanning: boolean;
  instances: TargetSummary[];
}

export interface UseAttachMode {
  attach: AttachState;
  views: ViewSummary[];
  activeViewId: string | null;
  picker: PickerState;
  /** Designer mode (backlog 2). False = the bridge paused the reconcile loop
   *  and the scene sits in runtime posture (edit bay hidden, app bay shown) —
   *  the user is running their app in LS. Editing still works locally and
   *  keeps autosaving to the registry; the scene converges on resume. */
  designing: boolean;
  /** Toggle designer mode on the bridge (designer.set-mode). */
  setDesignerMode: (designing: boolean) => void;
  /** Open the picker + kick off a fresh scan. */
  openPicker: () => void;
  closePicker: () => void;
  rescan: () => void;
  /** Send target.attach to the bridge. */
  attachTo: (port: number, kind: AttachKind, assetsDir?: string, label?: string) => void;
  /** Send target.detach. */
  detach: () => void;
  /** Request the registry. */
  refreshViews: () => void;
  /** Load a view by id (calls view.load). */
  loadView: (id: string) => void;
  /**
   * Create a new empty view + switch to it. NOT a snapshot of the
   * current tree — the new view starts empty, the user fills it in.
   * The previous view's local tree is stashed as a safety net (autosave
   * has already persisted it to the bridge).
   */
  createNewView: (name: string) => void;
  /** Rename an existing view in place. Tree is unchanged. */
  renameView: (id: string, newName: string) => void;
  /** Delete a registry entry by id. */
  deleteView: (id: string) => void;
  /** Re-publish a view's `.prefab` from its current bay instance (splice in
   *  place — placed instances survive). */
  republishView: (id: string) => void;
}

// Must match `VIEW_NAME_RE` on the bridge — dashes allowed; the
// controller's TS class identifier is PascalCased at codegen time.
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function isValidViewName(name: string): boolean {
  return NAME_RE.test(name);
}

export function useAttachMode(
  send: (msg: ClientToServerMsg) => boolean,
  onMessage: (fn: (msg: ServerToClientMsg) => void) => () => void,
): UseAttachMode {
  const [attach, setAttach] = useState<AttachState>({ kind: 'idle' });
  const [views, setViews] = useState<ViewSummary[]>([]);
  const [picker, setPicker] = useState<PickerState>({ open: false, scanning: false, instances: [] });
  const [designing, setDesigning] = useState(true);
  const tree = useDesignStore((s) => s.tree);
  const loadTreeIntoStore = useDesignStore((s) => s.loadTree);
  const stashView = useDesignStore((s) => s.stashView);
  const clearStash = useDesignStore((s) => s.clearStash);
  // activeViewId moved to the design store so it persists across
  // restart — restart drops the user back into the same view.
  const activeViewId = useDesignStore((s) => s.activeViewId);
  const setActiveViewId = useDesignStore((s) => s.setActiveViewId);
  // Tracks ids of views the local session knows it created. view.saved
  // for an id NOT in this set means "the bridge just minted a new view
  // for us" — trigger the switch flow. (Without this we'd swallow
  // createNewView's view.saved as a no-op rename.)
  const knownIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to bridge messages. One effect; updates the right slice of state.
  useEffect(() => {
    return onMessage((msg) => {
      switch (msg.type) {
        case 'hello':
          // Legacy: auto-attached sandbox. Surface as attached.
          useDesignStore.getState().bindProject('sandbox');
          setAttach({
            kind: 'attached',
            attachment: {
              kind: 'sandbox',
              port: msg.sandbox.port,
              projectName: 'sandbox',
              assetsDir: null,
            },
          });
          send({ type: 'view.list' });
          break;
        case 'attached':
          handleAttached(msg, setAttach, setViews);
          // A fresh attach always lands in design posture.
          setDesigning(true);
          // Seed known-ids alongside views so view.saved arriving from
          // an autosave on an already-existing view is correctly
          // classified as "rename / autosave", not "brand new".
          knownIdsRef.current = new Set(msg.views.map((v) => v.id));
          // Shared components: a fresh project's definitions replace the
          // previous one's, then fetch every view's tree for the canvas.
          useDefinitions.getState().clear();
          for (const v of msg.views) send({ type: 'view.get', id: v.id });
          break;
        case 'view.tree':
          // Definition tree for the shared-component cache (canvas render +
          // Inspector slot enumeration). Never applied to the scene.
          useDefinitions.getState().setDef(msg.id, { codeName: msg.codeName, tree: msg.tree });
          break;
        case 'designer.mode': {
          setDesigning(msg.designing);
          if (msg.designing) {
            // Resuming design: the bridge dropped every apply while off, so
            // re-ship the current tree to converge the re-shown edit bay.
            send({ type: 'design.apply', tree: useDesignStore.getState().tree });
          }
          break;
        }
        case 'view.renamed': {
          // TRUE rename landed: controller + prefab carried to the new name,
          // the returned tree's view node carries the new view.name. Adopt it
          // (otherwise the next autosave would revert the retag) and drop any
          // stale stash for this view.
          if (useDesignStore.getState().activeViewId === msg.id) {
            loadTreeIntoStore(msg.tree);
          }
          clearStash(msg.id);
          send({ type: 'view.list' });
          send({ type: 'view.get', id: msg.id });
          break;
        }
        case 'sandbox.down':
          setAttach({ kind: 'idle' });
          setViews([]);
          // Don't clear activeViewId / tree on a transient disconnect.
          // Local state survives so the user can keep designing offline
          // and autosave catches up on reconnect.
          break;
        case 'target.list.result':
          setPicker((p) => ({ ...p, scanning: false, instances: msg.targets }));
          break;
        case 'view.list.result': {
          setViews(msg.views);
          // Seed known-ids so view.saved for any existing view is
          // correctly classified as a rename / autosave, not as
          // "freshly minted" → no spurious switch.
          knownIdsRef.current = new Set(msg.views.map((v) => v.id));
          // Reconcile persisted activeViewId against the freshly-listed
          // views. If the view was deleted (another machine, another
          // session, fresh sandbox), drop the stale id so the empty
          // state shows. The local tree stays put — autosave will push
          // it to whichever view the user opens or creates next.
          const aid = useDesignStore.getState().activeViewId;
          if (aid !== null && !msg.views.some((v) => v.id === aid)) {
            setActiveViewId(null);
          }
          break;
        }
        case 'view.loaded': {
          // Prefer the user's local WIP stash over the server snapshot
          // — the stash represents work made after the last autosave
          // landed (e.g. a disconnect window). Normal case: no stash,
          // bridge tree is canonical.
          const stash = useDesignStore.getState().viewStashes[msg.id];
          loadTreeIntoStore(stash ?? msg.tree);
          setActiveViewId(msg.id);
          break;
        }
        case 'view.saved': {
          // Classify: is this a brand-new view we just created, or
          // an autosave/rename of an existing one?
          const isBrandNew = !knownIdsRef.current.has(msg.id);
          knownIdsRef.current.add(msg.id);
          if (isBrandNew) {
            // Just-created view → switch into it. The new view is
            // empty by construction (createNewView sent tree=[]). The
            // outgoing view's local tree is already persisted via the
            // most-recent autosave; stash as a belt-and-suspenders
            // safety net in case autosave hadn't flushed yet.
            const prevId = useDesignStore.getState().activeViewId;
            const prevTree = useDesignStore.getState().tree;
            if (prevId !== null && prevId !== msg.id) {
              stashView(prevId, prevTree);
            }
            setActiveViewId(msg.id);
            loadTreeIntoStore([]);
            clearStash(msg.id);
          }
          // Autosave / rename of an existing view: bridge-side effect
          // only, no local state change needed.
          send({ type: 'view.list' });
          // Keep the shared-component definition cache near-live: instances
          // of this view in other views render from it.
          send({ type: 'view.get', id: msg.id });
          break;
        }
        default:
          break;
        case 'view.republished':
          // The .prefab was (re)written on disk (splice-in-place preserves its
          // UUID, so placed instances survive). Refetch the list so the
          // stale-dependent badge clears — publishedAt just moved past the
          // definitions' updatedAt.
          send({ type: 'view.list' });
          break;
      }
    });
  }, [onMessage, send, loadTreeIntoStore, setActiveViewId, stashView, clearStash]);

  // ----- actions -----

  const openPicker = useCallback(() => {
    setPicker({ open: true, scanning: true, instances: [] });
    send({ type: 'target.list' });
  }, [send]);

  const closePicker = useCallback(() => {
    setPicker((p) => ({ ...p, open: false }));
  }, []);

  const rescan = useCallback(() => {
    setPicker((p) => ({ ...p, scanning: true, instances: [] }));
    send({ type: 'target.list' });
  }, [send]);

  const attachTo = useCallback(
    (port: number, kind: AttachKind, assetsDir?: string, label?: string) => {
      const msg: ClientToServerMsg = {
        type: 'target.attach',
        port,
        mode: kind,
        ...(assetsDir !== undefined ? { assetsDir } : {}),
        ...(label !== undefined && label.trim().length > 0 ? { label: label.trim() } : {}),
      };
      send(msg);
      setPicker({ open: false, scanning: false, instances: [] });
    },
    [send],
  );

  const detach = useCallback(() => {
    send({ type: 'target.detach' });
    setActiveViewId(null);
  }, [send, setActiveViewId]);

  const refreshViews = useCallback(() => {
    send({ type: 'view.list' });
  }, [send]);

  const loadView = useCallback(
    (id: string) => {
      // Stash the current view's WIP before switching away so the user
      // doesn't lose work made since the last Save. Stash even if the
      // tree matches the saved snapshot — clearing only happens on
      // explicit save, so a no-op stash is harmless.
      if (activeViewId !== null && activeViewId !== id) {
        stashView(activeViewId, tree);
      }
      send({ type: 'view.load', id });
    },
    [send, activeViewId, tree, stashView],
  );

  const createNewView = useCallback(
    (name: string) => {
      // Empty tree — the new view starts blank. The previous view's
      // tree stays in the local store; view.saved's switch handler
      // stashes it and loads the empty tree once the bridge confirms.
      send({
        type: 'view.save',
        name,
        tree: [],
      });
    },
    [send],
  );

  const renameView = useCallback(
    (id: string, newName: string) => {
      // TRUE rename: the bridge moves the code identity with the label —
      // controller .ts + .prefab renamed in place (stable UUIDs), class
      // renamed, tree's view node retagged. Pass the local tree ONLY when
      // renaming the ACTIVE view (so unsaved WIP isn't lost) — for any other
      // view the local tree is a DIFFERENT view's content, and sending it
      // would overwrite the renamed view's tree with it (the bridge falls
      // back to its stored tree on []).
      send({
        type: 'view.rename',
        id,
        newName,
        tree: id === activeViewId ? tree : [],
      });
    },
    [send, tree, activeViewId],
  );

  const setDesignerMode = useCallback(
    (next: boolean) => {
      send({ type: 'designer.set-mode', designing: next });
    },
    [send],
  );

  const deleteView = useCallback(
    (id: string) => {
      send({ type: 'view.delete', id });
      useDefinitions.getState().removeDef(id);
      clearStash(id);
      knownIdsRef.current.delete(id);
      if (activeViewId === id) {
        setActiveViewId(null);
        loadTreeIntoStore([]);
      }
    },
    [send, activeViewId, clearStash, setActiveViewId, loadTreeIntoStore],
  );

  const republishView = useCallback(
    (id: string) => {
      send({ type: 'view.republish', id });
    },
    [send],
  );

  return {
    attach,
    views,
    activeViewId,
    picker,
    designing,
    setDesignerMode,
    openPicker,
    closePicker,
    rescan,
    attachTo,
    detach,
    refreshViews,
    loadView,
    createNewView,
    renameView,
    deleteView,
    republishView,
  };
}

function handleAttached(
  msg: AttachedMsg,
  setAttach: (s: AttachState) => void,
  setViews: (v: ViewSummary[]) => void,
): void {
  // Bind the store to this project FIRST — if it differs from the last-bound
  // project, this clears the previous project's canvas state so it neither
  // renders here nor bleeds into this project's manifest via autosave. A
  // same-project reconnect is a no-op (local WIP survives).
  const projectKey = msg.target.kind === 'sandbox' ? 'sandbox' : (msg.target.assetsDir ?? null);
  useDesignStore.getState().bindProject(projectKey);
  setAttach({
    kind: 'attached',
    attachment: {
      kind: msg.target.kind,
      port: msg.target.port,
      projectName: msg.target.projectName,
      assetsDir: msg.target.assetsDir,
    },
  });
  setViews(msg.views);
  // Remember real projects for one-click re-attach (skip the legacy sandbox,
  // which has no user-chosen Assets path to re-Browse).
  if (msg.target.kind === 'attached' && msg.target.assetsDir) {
    recordRecentProject({
      name: msg.target.projectName ?? msg.target.assetsDir,
      assetsDir: msg.target.assetsDir,
      lastPort: msg.target.port,
    });
  }
}
