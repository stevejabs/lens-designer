// Design model — the canonical client-side design tree + reducers.
//
// State is persisted to localStorage. The bridge is a stateless
// translator: every store mutation kicks an auto-sync that ships the
// full tree to the daemon (Phase F4). Survives bridge restarts and
// browser reloads.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  MANIFESTS,
  type PrimitiveManifest,
  type DesignNode,
  type WindowRegion,
  type Interaction,
  type InteractionState,
  type StateProps,
  type StatePropKey,
  type StateOverrides,
  type LayoutSpec,
  type View,
  type Binding,
} from '@lens-designer/bridge/client';

/** The three non-default states an element can carry overrides for. */
type OverrideState = 'hover' | 'pinched' | 'disabled';

/** An uploaded font. `path` is the sandbox asset path stored in a node's
 *  `font` property; `family` is the CSS font-family the canvas registers via
 *  FontFace; `name` is the human label shown in the picker. */
export interface CustomFont {
  path: string;
  family: string;
  name: string;
}

interface DesignStore {
  tree: DesignNode[]; // index 0 = top of layers list = front
  /** Multi-select. Empty = nothing selected. Single-node editors treat
   *  length===1 as "the selection"; >1 disables per-prop editing. */
  selectedIds: string[];
  previewRegion: WindowRegion | null;
  /** The interaction state the canvas is previewing/editing (WB2). Session-only;
   *  never written into the tree. `default` = base authoring. */
  editState: InteractionState;
  /** Monotonic suffix counter per type, so "Rectangle 1, 2, 3" doesn't repeat. */
  nameCounters: Record<string, number>;
  /** Snap-to-grid: when on, drag/resize snap to `gridSize`-cm increments and
   *  the canvas shows the grid. Alignment guides (node-to-node) are always
   *  active during a drag regardless; hold Alt to bypass all snapping. */
  gridEnabled: boolean;
  /** When on, every autosave also re-publishes the active view's prefab in place
   *  (stable UUID), so design changes flow to wired consumers live. Off = manual
   *  Re-publish only. Persisted. */
  autoPublish: boolean;
  gridSize: number; // cm
  /**
   * Distance (cm) from the Spectacles camera to the ActiveComponent
   * root in LS world space. Bigger = farther = smaller in preview.
   * Sent to the bridge on change so the user can dial the LS preview
   * scale to match the designer canvas without a rebuild.
   */
  previewDistance: number; // cm
  /** Uploaded fonts, shown in the font picker alongside the built-ins. */
  customFonts: CustomFont[];

  /**
   * Fonts installed on the host OS — populated by `useFontSync` on
   * attach via `fonts.list-system`. Used by the FontInput "Add font"
   * panel. NOT persisted: re-fetched each session so a system font
   * install / uninstall is reflected without restart.
   */
  systemFonts: Array<{ family: string; file: string; ext: 'ttf' | 'otf' }>;

  /**
   * Authoritative list of font filenames currently in
   * `<project>/Assets/LensDesigner/fonts/`. Populated by `useFontSync`
   * via `fonts.list-project`. The font picker only shows customFonts
   * whose path basename is in this set — that's how ghost entries
   * (file deleted by GC, manual delete, sandbox swap) stop appearing
   * in the dropdown.
   */
  projectFontFiles: string[];

  /**
   * Per-view WIP stash. Maps view id → the most recent in-flight tree.
   * Layered defense alongside continuous autosave (`useAutoSaveView`):
   * autosave is the durable persistence (writes to bridge registry),
   * stash is the in-RAM safety net for the moments before a save lands
   * (network blip, autosave debounce window, etc.). Cleared on
   * successful view.save + on view delete.
   */
  viewStashes: Record<string, DesignNode[]>;

  /**
   * Id of the view the user was last working on. Persisted so a
   * restart drops back into the same view (with the local tree, which
   * is also persisted). useAttachMode reflects this back as the public
   * `attach.activeViewId`. Cleared if the bridge no longer has a view
   * with that id (deleted from another session, fresh sandbox, etc.).
   */
  activeViewId: string | null;

  /**
   * Which project the persisted tree / activeViewId / stashes belong to
   * (the attached project's assetsDir, or 'sandbox'). The store is persisted
   * GLOBALLY in localStorage; without this key, attaching to a different
   * project would rehydrate the previous project's view onto the canvas — and
   * autosave would then write it into the wrong project's manifest. `bindProject`
   * resets the project-scoped state when this key changes. Null until first bind.
   */
  boundProjectKey: string | null;

  /**
   * Monotonic counter bumped by `requestNewView()`. ViewsPanel watches it
   * and opens the Save dialog (name = empty, no id) on bump. Lets Canvas /
   * Palette / any other component trigger the "new view" flow without
   * prop-drilling the ViewsPanel's dialog state.
   */
  requestNewViewSignal: number;

  /** Internal copy/paste buffer (deep snapshots; session-only, not persisted). */
  clipboard: DesignNode[];
  /** Cascade counter so repeated paste doesn't stack copies exactly. */
  _pasteCount: number;

  // --- Undo/redo history (session-only; not persisted). Snapshots store
  //     references, which is safe because every reducer is immutable. ---
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  /** Pre-gesture snapshot for an open transaction, pushed lazily on the first
   *  mutation so a no-op gesture (click without drag) records nothing. */
  _txn: HistorySnapshot | null;
  _txnDirty: boolean;
  /** Coalescing: rapid same-field edits (typing, spinner) fold into one entry. */
  _coalesceKey: string | null;
  _coalesceAt: number;

  addNode: (typeName: string, atCanvas?: { x: number; y: number }) => string | null;
  /** Place an INSTANCE of a saved component view (shared components). `name`
   *  labels the node (usually the component's code name); `sizeCm` seeds the
   *  hit-test box from the definition's content bounds. */
  addInstance: (
    ofViewId: string,
    name: string,
    sizeCm: { w: number; h: number },
  ) => string | null;
  /** Set (value) or clear (undefined) one per-instance slot override. */
  setInstanceOverride: (id: string, slotKey: string, value: unknown | undefined) => void;
  /** Set (value) or clear (undefined) an instance's actionKey override. */
  setInstanceActionKey: (id: string, actionKey: string | undefined) => void;
  /** Select a node. `additive` (shift/cmd-click) toggles it in/out of the
   *  current selection; otherwise it replaces the selection. id===null clears. */
  selectNode: (id: string | null, additive?: boolean) => void;
  /** Replace the whole selection (marquee / select-all). */
  selectMany: (ids: string[]) => void;
  updateProp: (id: string, propKey: string, value: unknown) => void;
  /** Merge props onto many nodes in one update — used by group drag + resize
   *  so a multi-node gesture is a single re-render + single auto-sync. */
  patchNodes: (patches: Array<{ id: string; props: Record<string, unknown> }>) => void;
  moveLayer: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  /** Reorder a node to a specific index within its parent's child list
   *  (drag-reorder in the Layers panel). */
  reorderNode: (id: string, toIndex: number) => void;
  /** Reparent a node into `newParentId` (null = top level) at `index`. Rejects
   *  moving a node into itself or its own subtree. Drives drag-into-group. */
  moveNode: (id: string, newParentId: string | null, index: number) => void;
  removeNode: (id: string) => void;
  /** Delete every selected node. */
  removeSelected: () => void;
  /** Copy the selection to the internal clipboard. */
  copy: () => void;
  /** Copy the selection, then delete it (one undo step). */
  cut: () => void;
  /** Paste the clipboard as new top-level nodes (fresh ids, cascade offset). */
  paste: () => void;
  /** Clone the selection in place (fresh ids, offset); selects the clones. */
  duplicate: () => void;
  /** Wrap the (top-level) selected nodes in a new Group; selects the group. */
  group: () => void;
  /** Dissolve a Group, lifting its children back to the group's place. */
  ungroup: (groupId: string) => void;
  renameNode: (id: string, name: string) => void;
  /** Set (or clear, with undefined) a node's interaction metadata. */
  setInteraction: (id: string, interaction: Interaction | undefined) => void;
  /** @deprecated v1b — superseded by setStateOverride(…, 'visible', …). Kept
   *  until the Inspector migrates off it (WB3), then removed in cleanup. */
  setVisibleInStates: (id: string, states: InteractionState[] | undefined) => void;
  /** Set one per-element override prop for a non-default state. `position` is a
   *  delta from base, `scale` a multiplier; other props replace. */
  setStateOverride: (id: string, state: OverrideState, propKey: StatePropKey, value: unknown) => void;
  /** Clear one override prop, pruning the state (and `stateOverrides`) if empty. */
  clearStateOverride: (id: string, state: OverrideState, propKey: StatePropKey) => void;
  /** Set/clear a node's stack-lite layout (TD-10, WB-L). */
  setLayout: (id: string, layout: LayoutSpec | undefined) => void;
  /** Mark/unmark a child as the hug-group's fill background (WB-L). */
  setFillParent: (id: string, fill: boolean) => void;
  /** Mark/unmark a (group) node as an exported component/View. */
  setView: (id: string, view: View | undefined) => void;
  /** Tag/untag a node as a code-controllable binding slot. */
  setBinding: (id: string, binding: Binding | undefined) => void;
  setPreviewRegion: (region: WindowRegion | null) => void;
  /** Switch the canvas preview/edit state (WB2). */
  setEditState: (state: InteractionState) => void;
  toggleVisibility: (id: string) => void;
  setGridEnabled: (enabled: boolean) => void;
  setAutoPublish: (enabled: boolean) => void;
  setGridSize: (cm: number) => void;
  setPreviewDistance: (cm: number) => void;
  /** Register an uploaded font (deduped by path). */
  addCustomFont: (font: CustomFont) => void;
  /** Drop customFonts whose underlying file was deleted on disk (GC). */
  removeCustomFontsByFile: (filenames: string[]) => void;
  /** Bulk setters for the system + project font lists. */
  setSystemFonts: (fonts: DesignStore['systemFonts']) => void;
  setProjectFontFiles: (files: string[]) => void;
  /** Save the current tree as a WIP snapshot under `viewId`. */
  stashView: (viewId: string, tree: DesignNode[]) => void;
  /** Discard the stash for `viewId` (called on save / delete). */
  clearStash: (viewId: string) => void;
  /** Set the persisted active-view id. Pass null to clear. */
  setActiveViewId: (id: string | null) => void;
  /**
   * Bind the store to a project (its assetsDir, or 'sandbox'). When the key
   * differs from the current binding, resets the project-scoped state (tree,
   * activeViewId, stashes, undo) so a fresh/other project starts clean and no
   * view bleeds across projects. A same-project reconnect is a no-op — local
   * WIP survives. Called on every attach.
   */
  bindProject: (key: string | null) => void;
  /** Ask ViewsPanel to open its Save dialog in "new view" mode. */
  requestNewView: () => void;
  /** Reset to an empty document — confirms via the caller, no built-in dialog. */
  reset: () => void;
  /** Replace the document with a loaded view's tree (from `view.loaded`).
   *  Clears selection + undo history — can't undo back into a different view. */
  loadTree: (tree: DesignNode[]) => void;

  // --- History API ---
  undo: () => void;
  redo: () => void;
  /** Open a coalescing window for a continuous gesture (canvas drag, resize):
   *  every mutation until endTransaction() folds into a single undo step. */
  beginTransaction: () => void;
  endTransaction: () => void;
  /** Internal: snapshot the pre-mutation document before a change. Reducers
   *  call this first. `coalesceKey` merges consecutive same-key edits. */
  record: (coalesceKey?: string) => void;
}

/** A point-in-time document snapshot for undo/redo. References, not copies. */
interface HistorySnapshot {
  tree: DesignNode[];
  nameCounters: Record<string, number>;
  selectedIds: string[];
}

/** Cap on retained undo steps. Snapshots are references, so this is cheap. */
const MAX_HISTORY = 200;
/** Same-key edits within this window coalesce into one undo step. */
const COALESCE_MS = 500;

function capPast(past: HistorySnapshot[]): HistorySnapshot[] {
  return past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past;
}

function makeId(): string {
  // Crypto.randomUUID is available in modern browsers + Node 22.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildNode(manifest: PrimitiveManifest, n: number, atCanvas?: { x: number; y: number }): DesignNode {
  const properties: Record<string, unknown> = { ...manifest.defaultProperties };
  if (atCanvas) {
    properties['position'] = { x: atCanvas.x, y: atCanvas.y };
  }
  return {
    id: makeId(),
    type: manifest.type,
    name: `${manifest.displayName} ${n}`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    properties,
    children: [],
  };
}

/** Read a node's {x,y} position property (groups + leaves both have one). */
function readPos(n: DesignNode): { x: number; y: number } {
  const p = n.properties['position'];
  if (typeof p === 'object' && p !== null && 'x' in p && 'y' in p) {
    const o = p as Record<string, unknown>;
    return { x: typeof o['x'] === 'number' ? o['x'] : 0, y: typeof o['y'] === 'number' ? o['y'] : 0 };
  }
  return { x: 0, y: 0 };
}

/** How far (cm) a pasted/duplicated node lands from its source. */
const PASTE_OFFSET_CM = 1;

/** Deep-clone a node subtree, assigning fresh ids to it and every descendant
 *  (so a pasted group's children are new nodes, not aliases). */
function cloneWithFreshIds(node: DesignNode): DesignNode {
  const copy = structuredClone(node);
  const reid = (n: DesignNode): void => {
    n.id = makeId();
    for (const child of n.children) reid(child);
  };
  reid(copy);
  return copy;
}

/** The top-most selected nodes, in tree order: drops any selected node that
 *  is a descendant of another selected node so copy/duplicate never doubles it. */
function selectionRoots(tree: DesignNode[], selectedIds: string[]): DesignNode[] {
  const sel = new Set(selectedIds);
  const out: DesignNode[] = [];
  const walk = (nodes: DesignNode[], underSelected: boolean): void => {
    for (const n of nodes) {
      const isSel = sel.has(n.id);
      if (isSel && !underSelected) out.push(n);
      walk(n.children, underSelected || isSel);
    }
  };
  walk(tree, false);
  return out;
}

/** Find a node by id at any depth (groups nest their children). */
export function findNode(nodes: DesignNode[], id: string): DesignNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return undefined;
}

/** Path of nodes from a root down to `id` (inclusive), or [] if not found.
 *  The last element is the node itself; everything before it is its ancestry,
 *  outermost first. */
export function findPath(nodes: DesignNode[], id: string): DesignNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const sub = findPath(n.children, id);
    if (sub.length) return [n, ...sub];
  }
  return [];
}

/** A binding key becomes a property on the generated controller verbatim
 *  (`view.<key>`). These identifiers already exist on the controller — the
 *  LS `BaseScriptComponent` base class, plus the controller's own generated
 *  surface — so a slot using one shadows it and the controller won't compile
 *  (e.g. `name: LDTextHandle` vs the base `name: string`). Verified against
 *  LS 5.15.4 BaseScriptComponent.d.ts + the codegen output, 2026-06-05. */
export const RESERVED_BINDING_KEYS: ReadonlySet<string> = new Set([
  // BaseScriptComponent (LS 5.15.4)
  'api', 'enabled', 'isEnabledInHierarchy', 'name', 'uniqueIdentifier',
  'updatePriority', 'sceneObject', 'createEvent', 'destroy',
  'getReferencedEvents', 'getSceneObject', 'getTransform', 'getTypeName',
  'isOfType', 'isSame', 'removeEvent',
  // the generated controller's own public members
  'init', 'onAwake', 'onPinch', 'onPinchEnd', 'onPinchCancel',
  'onPinchEndOutside', 'onToggle',
]);

/** True if `key` collides with a reserved controller member (see
 *  RESERVED_BINDING_KEYS). Case-sensitive — TS identifiers are. */
export function isReservedBindingKey(key: string): boolean {
  return RESERVED_BINDING_KEYS.has(key.trim());
}

/** Immutably apply `fn` to every node in the tree, depth-first. */
function mapTree(nodes: DesignNode[], fn: (n: DesignNode) => DesignNode): DesignNode[] {
  return nodes.map((n) => {
    const m = fn(n);
    const children = mapTree(m.children, fn);
    return children === m.children ? m : { ...m, children };
  });
}

/** Immutably remove every node whose id is in `ids`, at any depth. */
function removeFromTree(nodes: DesignNode[], ids: Set<string>): DesignNode[] {
  const out: DesignNode[] = [];
  for (const n of nodes) {
    if (ids.has(n.id)) continue;
    const children = removeFromTree(n.children, ids);
    out.push(children === n.children ? n : { ...n, children });
  }
  return out;
}

/** Reorder `id` within whichever sibling list contains it, to `toIndex`. */
function reorderInParent(nodes: DesignNode[], id: string, toIndex: number): DesignNode[] {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const next = nodes.slice();
    const [node] = next.splice(idx, 1);
    if (node) next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, node);
    return next;
  }
  return nodes.map((n) => {
    const children = reorderInParent(n.children, id, toIndex);
    return children === n.children ? n : { ...n, children };
  });
}

export const useDesignStore = create<DesignStore>()(
  persist(
    (set, get) => ({
      tree: [],
      selectedIds: [],
      previewRegion: null,
      editState: 'default',
      nameCounters: {},
      gridEnabled: false,
      autoPublish: false,
      gridSize: 1,
      previewDistance: 52,
      customFonts: [],
      systemFonts: [],
      projectFontFiles: [],
      viewStashes: {},
      activeViewId: null,
      boundProjectKey: null,
      requestNewViewSignal: 0,
      clipboard: [],
      _pasteCount: 0,
      past: [],
      future: [],
      _txn: null,
      _txnDirty: false,
      _coalesceKey: null,
      _coalesceAt: 0,

      record(coalesceKey) {
        set((s) => {
          const before: HistorySnapshot = {
            tree: s.tree,
            nameCounters: s.nameCounters,
            selectedIds: s.selectedIds,
          };
          // Inside a gesture transaction: push the pre-gesture snapshot once.
          if (s._txn) {
            if (s._txnDirty) return {};
            return { past: capPast([...s.past, s._txn]), future: [], _txnDirty: true };
          }
          const now = Date.now();
          // Coalesce consecutive same-field edits into the existing entry.
          if (coalesceKey && coalesceKey === s._coalesceKey && now - s._coalesceAt < COALESCE_MS) {
            return s.future.length ? { future: [], _coalesceAt: now } : { _coalesceAt: now };
          }
          return {
            past: capPast([...s.past, before]),
            future: [],
            _coalesceKey: coalesceKey ?? null,
            _coalesceAt: now,
          };
        });
      },

      beginTransaction() {
        set((s) => ({
          _txn: { tree: s.tree, nameCounters: s.nameCounters, selectedIds: s.selectedIds },
          _txnDirty: false,
        }));
      },

      endTransaction() {
        set({ _txn: null, _txnDirty: false });
      },

      undo() {
        set((s) => {
          if (s.past.length === 0) return {};
          const prev = s.past[s.past.length - 1]!;
          const current: HistorySnapshot = {
            tree: s.tree,
            nameCounters: s.nameCounters,
            selectedIds: s.selectedIds,
          };
          return {
            past: s.past.slice(0, -1),
            future: [...s.future, current],
            tree: prev.tree,
            nameCounters: prev.nameCounters,
            selectedIds: prev.selectedIds,
            _coalesceKey: null, // a later edit must not coalesce across an undo
          };
        });
      },

      redo() {
        set((s) => {
          if (s.future.length === 0) return {};
          const next = s.future[s.future.length - 1]!;
          const current: HistorySnapshot = {
            tree: s.tree,
            nameCounters: s.nameCounters,
            selectedIds: s.selectedIds,
          };
          return {
            future: s.future.slice(0, -1),
            past: [...s.past, current],
            tree: next.tree,
            nameCounters: next.nameCounters,
            selectedIds: next.selectedIds,
            _coalesceKey: null,
          };
        });
      },

      addNode(typeName, atCanvas) {
        const manifest = MANIFESTS[typeName];
        if (!manifest) {
          // Silently no-op rather than throw — the palette only surfaces
          // legal types; an unknown type means stale localStorage.
          return null;
        }
        get().record();
        const counters = get().nameCounters;
        const nextN = (counters[typeName] ?? 0) + 1;
        const node = buildNode(manifest, nextN, atCanvas);
        set((s) => ({
          tree: [node, ...s.tree], // new nodes land on top (front layer)
          selectedIds: [node.id],
          nameCounters: { ...s.nameCounters, [typeName]: nextN },
        }));
        return node.id;
      },

      addInstance(ofViewId, name, sizeCm) {
        get().record();
        const counters = get().nameCounters;
        const nextN = (counters['Instance'] ?? 0) + 1;
        const node: DesignNode = {
          id: makeId(),
          type: 'Instance',
          name: nextN > 1 ? `${name} ${nextN}` : name,
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          // size is a canvas-side hit-box seeded from the definition's bounds;
          // the bridge expansion ignores it (content renders at natural size).
          properties: { position: { x: 0, y: 0 }, rotation: 0, size: { x: sizeCm.w, y: sizeCm.h } },
          instance: { of: ofViewId },
          children: [],
        };
        set((s) => ({
          tree: [node, ...s.tree],
          selectedIds: [node.id],
          nameCounters: { ...s.nameCounters, Instance: nextN },
        }));
        return node.id;
      },

      setInstanceOverride(id, slotKey, value) {
        get().record(`inst:${id}:${slotKey}`);
        set((s) => ({
          tree: mapTree(s.tree, (n) => {
            if (n.id !== id || !n.instance) return n;
            const slots = { ...(n.instance.overrides?.slots ?? {}) };
            if (value === undefined) delete slots[slotKey];
            else slots[slotKey] = value;
            const overrides = { ...(n.instance.overrides ?? {}), slots };
            if (Object.keys(slots).length === 0) delete (overrides as { slots?: unknown }).slots;
            const hasAny = Object.keys(overrides).length > 0;
            return { ...n, instance: { ...n.instance, ...(hasAny ? { overrides } : {}) } };
          }),
        }));
      },

      setInstanceActionKey(id, actionKey) {
        get().record(`inst:${id}:actionKey`);
        set((s) => ({
          tree: mapTree(s.tree, (n) => {
            if (n.id !== id || !n.instance) return n;
            const overrides = { ...(n.instance.overrides ?? {}) };
            if (actionKey === undefined) delete (overrides as { actionKey?: string }).actionKey;
            else (overrides as { actionKey?: string }).actionKey = actionKey;
            const hasAny = Object.keys(overrides).length > 0;
            const instance = { of: n.instance.of, ...(hasAny ? { overrides } : {}) };
            return { ...n, instance };
          }),
        }));
      },

      selectNode(id, additive = false) {
        set((s) => {
          if (id === null) return { selectedIds: [] };
          if (additive) {
            return s.selectedIds.includes(id)
              ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
              : { selectedIds: [...s.selectedIds, id] };
          }
          return { selectedIds: [id] };
        });
      },

      selectMany(ids) {
        set({ selectedIds: ids });
      },

      updateProp(id, propKey, value) {
        get().record(`prop:${id}:${propKey}`);
        set((s) => ({
          tree: mapTree(s.tree, (n) =>
            n.id === id ? { ...n, properties: { ...n.properties, [propKey]: value } } : n,
          ),
        }));
      },

      patchNodes(patches) {
        if (patches.length === 0) return;
        get().record();
        const byId = new Map(patches.map((p) => [p.id, p.props]));
        set((s) => ({
          tree: mapTree(s.tree, (n) => {
            const props = byId.get(n.id);
            return props ? { ...n, properties: { ...n.properties, ...props } } : n;
          }),
        }));
      },

      moveLayer(id, direction) {
        // Reorder within the node's own parent (handles nested groups). Find
        // the node's current index in its sibling list, then map direction
        // to a target index and reuse reorderInParent.
        const tree = get().tree;
        const siblingIndex = (nodes: DesignNode[]): number => {
          const i = nodes.findIndex((n) => n.id === id);
          if (i !== -1) return i;
          for (const n of nodes) {
            const r = siblingIndex(n.children);
            if (r !== -1) return r;
          }
          return -1;
        };
        const siblingCount = (nodes: DesignNode[]): number => {
          if (nodes.some((n) => n.id === id)) return nodes.length;
          for (const n of nodes) {
            const c = siblingCount(n.children);
            if (c !== -1) return c;
          }
          return -1;
        };
        const idx = siblingIndex(tree);
        if (idx === -1) return;
        const count = siblingCount(tree);
        const target =
          direction === 'top' ? 0
          : direction === 'bottom' ? count - 1
          : direction === 'up' ? idx - 1
          : idx + 1;
        get().record();
        set((s) => ({ tree: reorderInParent(s.tree, id, target) }));
      },

      reorderNode(id, toIndex) {
        get().record();
        set((s) => ({ tree: reorderInParent(s.tree, id, toIndex) }));
      },

      moveNode(id, newParentId, index) {
        set((s) => {
          const node = findNode(s.tree, id);
          if (!node) return {};
          // Can't move a node into itself or anywhere inside its own subtree.
          if (newParentId === id) return {};
          if (newParentId && findNode(node.children, newParentId)) return {};
          if (newParentId && !findNode(s.tree, newParentId)) return {};
          get().record();
          const without = removeFromTree(s.tree, new Set([id]));
          if (newParentId === null) {
            const next = without.slice();
            next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
            return { tree: next, selectedIds: [id] };
          }
          const next = mapTree(without, (n) => {
            if (n.id !== newParentId) return n;
            const kids = n.children.slice();
            kids.splice(Math.max(0, Math.min(index, kids.length)), 0, node);
            return { ...n, children: kids };
          });
          return { tree: next, selectedIds: [id] };
        });
      },

      removeNode(id) {
        get().record();
        set((s) => ({
          tree: removeFromTree(s.tree, new Set([id])),
          selectedIds: s.selectedIds.filter((x) => x !== id),
        }));
      },

      removeSelected() {
        if (get().selectedIds.length === 0) return;
        get().record();
        set((s) => ({ tree: removeFromTree(s.tree, new Set(s.selectedIds)), selectedIds: [] }));
      },

      copy() {
        const roots = selectionRoots(get().tree, get().selectedIds);
        if (roots.length === 0) return; // keep the existing clipboard
        set({ clipboard: roots.map((n) => structuredClone(n)), _pasteCount: 0 });
      },

      cut() {
        const roots = selectionRoots(get().tree, get().selectedIds);
        if (roots.length === 0) return;
        get().record();
        const ids = new Set(roots.map((r) => r.id));
        set((s) => ({
          clipboard: roots.map((n) => structuredClone(n)),
          _pasteCount: 0,
          tree: removeFromTree(s.tree, ids),
          selectedIds: [],
        }));
      },

      paste() {
        if (get().clipboard.length === 0) return;
        get().record();
        set((s) => {
          const count = s._pasteCount + 1;
          const off = PASTE_OFFSET_CM * count;
          const clones = s.clipboard.map((n) => {
            const c = cloneWithFreshIds(n);
            const p = readPos(c);
            // Cascade down-right (screen down is -y in design space).
            return { ...c, properties: { ...c.properties, position: { x: p.x + off, y: p.y - off } } };
          });
          return { tree: [...clones, ...s.tree], selectedIds: clones.map((c) => c.id), _pasteCount: count };
        });
      },

      duplicate() {
        const roots = selectionRoots(get().tree, get().selectedIds);
        if (roots.length === 0) return;
        get().record();
        set((s) => {
          const clones = roots.map((n) => {
            const c = cloneWithFreshIds(n);
            const p = readPos(c);
            return {
              ...c,
              properties: { ...c.properties, position: { x: p.x + PASTE_OFFSET_CM, y: p.y - PASTE_OFFSET_CM } },
            };
          });
          return { tree: [...clones, ...s.tree], selectedIds: clones.map((c) => c.id) };
        });
      },

      group() {
        const sel0 = new Set(get().selectedIds);
        if (!get().tree.some((n) => sel0.has(n.id))) return; // nothing top-level to group
        get().record();
        set((s) => {
          const sel = new Set(s.selectedIds);
          // MVP: group top-level selected nodes (the common case). Children
          // keep their positions; the group sits at the origin, so nothing
          // moves visually until the group itself is dragged.
          const picked = s.tree.filter((n) => sel.has(n.id));
          if (picked.length === 0) return {};
          const nextN = (s.nameCounters['Group'] ?? 0) + 1;
          const groupNode: DesignNode = {
            id: makeId(),
            type: 'Group',
            name: `Group ${nextN}`,
            transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
            properties: { position: { x: 0, y: 0 }, rotation: 0 },
            children: picked,
          };
          const next: DesignNode[] = [];
          let inserted = false;
          for (const n of s.tree) {
            if (sel.has(n.id)) {
              if (!inserted) { next.push(groupNode); inserted = true; }
            } else {
              next.push(n);
            }
          }
          return { tree: next, selectedIds: [groupNode.id], nameCounters: { ...s.nameCounters, Group: nextN } };
        });
      },

      ungroup(groupId) {
        if (!get().tree.some((n) => n.id === groupId && n.type === 'Group')) return;
        get().record();
        set((s) => {
          const g = s.tree.find((n) => n.id === groupId && n.type === 'Group');
          if (!g) return {}; // MVP: only top-level groups
          const gp = readPos(g);
          // Re-absolutize child positions by the group offset (rotation 0).
          const lifted = g.children.map((c) => {
            const cp = readPos(c);
            return { ...c, properties: { ...c.properties, position: { x: cp.x + gp.x, y: cp.y + gp.y } } };
          });
          const next: DesignNode[] = [];
          for (const n of s.tree) {
            if (n.id === groupId) next.push(...lifted);
            else next.push(n);
          }
          return { tree: next, selectedIds: lifted.map((c) => c.id) };
        });
      },

      renameNode(id, name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, name: trimmed } : n)),
        }));
      },

      setInteraction(id, interaction) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, interaction } : n)),
        }));
      },

      setVisibleInStates(id, states) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, visibleInStates: states } : n)),
        }));
      },

      setStateOverride(id, state, propKey, value) {
        // Coalesce rapid same-field edits (color drag, spinner) into one undo.
        get().record(`override:${id}:${state}:${propKey}`);
        set((s) => ({
          tree: mapTree(s.tree, (n) => {
            if (n.id !== id) return n;
            const so: StateOverrides = { ...(n.stateOverrides ?? {}) };
            so[state] = { ...(so[state] ?? {}), [propKey]: value } as StateProps;
            return { ...n, stateOverrides: so };
          }),
        }));
      },

      clearStateOverride(id, state, propKey) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => {
            if (n.id !== id || !n.stateOverrides || !n.stateOverrides[state]) return n;
            const stateProps: StateProps = { ...n.stateOverrides[state] };
            delete (stateProps as Record<string, unknown>)[propKey];
            const so: StateOverrides = { ...n.stateOverrides };
            if (Object.keys(stateProps).length === 0) delete so[state];
            else so[state] = stateProps;
            const next = Object.keys(so).length === 0 ? undefined : so;
            return { ...n, stateOverrides: next };
          }),
        }));
      },

      setLayout(id, layout) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, layout } : n)),
        }));
      },

      setFillParent(id, fill) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, fillParent: fill || undefined } : n)),
        }));
      },

      setView(id, view) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, view } : n)),
        }));
      },

      setBinding(id, binding) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => (n.id === id ? { ...n, binding } : n)),
        }));
      },

      setPreviewRegion(region) {
        set({ previewRegion: region });
      },

      setEditState(state) {
        set({ editState: state });
      },

      setGridEnabled(enabled) {
        set({ gridEnabled: enabled });
      },
      setAutoPublish(enabled) {
        set({ autoPublish: enabled });
      },

      setPreviewDistance(cm) {
        // Spectacles near-clip is ~30 cm; further than 200 cm makes UI
        // unreadable. Clamp to a usable range.
        set({ previewDistance: Math.max(30, Math.min(200, cm)) });
      },

      setGridSize(cm) {
        // Keep a sane positive grid; sub-mm grids are useless on this canvas.
        set({ gridSize: Math.max(0.1, cm) });
      },

      addCustomFont(font) {
        set((s) =>
          s.customFonts.some((f) => f.path === font.path)
            ? {}
            : { customFonts: [...s.customFonts, font] },
        );
      },

      removeCustomFontsByFile(filenames) {
        if (filenames.length === 0) return;
        const deletedSet = new Set(filenames);
        set((s) => {
          const next = s.customFonts.filter((f) => {
            // CustomFont.path is sandbox-relative like
            // `LensDesigner/fonts/font_<hash>.ttf`; match on the basename
            // so the renderer doesn't need to know the assets root.
            const base = f.path.split('/').pop();
            return !base || !deletedSet.has(base);
          });
          if (next.length === s.customFonts.length) return {};
          return { customFonts: next };
        });
      },

      setSystemFonts(fonts) {
        set({ systemFonts: fonts });
      },

      setProjectFontFiles(files) {
        // Reconcile customFonts against the authoritative list. Any
        // entry whose file isn't in `files` is a ghost (deleted by GC,
        // sandbox swap, manual delete) — drop it.
        set((s) => {
          const fileSet = new Set(files);
          const nextCustom = s.customFonts.filter((f) => {
            const base = f.path.split('/').pop();
            return base ? fileSet.has(base) : false;
          });
          const changed = nextCustom.length !== s.customFonts.length;
          return {
            projectFontFiles: files,
            ...(changed ? { customFonts: nextCustom } : {}),
          };
        });
      },

      requestNewView() {
        set((s) => ({ requestNewViewSignal: s.requestNewViewSignal + 1 }));
      },

      stashView(viewId, tree) {
        set((s) => ({ viewStashes: { ...s.viewStashes, [viewId]: tree } }));
      },

      clearStash(viewId) {
        set((s) => {
          if (!(viewId in s.viewStashes)) return {};
          const next = { ...s.viewStashes };
          delete next[viewId];
          return { viewStashes: next };
        });
      },

      setActiveViewId(id) {
        set({ activeViewId: id });
      },
      bindProject(key) {
        if (get().boundProjectKey === key) return; // same project — keep WIP
        // Different project: drop the previous project's canvas state so it
        // can't render here or bleed into this project's manifest via autosave.
        set({
          boundProjectKey: key,
          tree: [],
          selectedIds: [],
          activeViewId: null,
          viewStashes: {},
          past: [],
          future: [],
          _txn: null,
          _txnDirty: false,
          _coalesceKey: null,
          _coalesceAt: 0,
        });
      },

      toggleVisibility(id) {
        get().record();
        set((s) => ({
          tree: mapTree(s.tree, (n) => {
            if (n.id !== id) return n;
            const current = typeof n.properties['opacity'] === 'number' ? n.properties['opacity'] : 100;
            const next = current === 0 ? 100 : 0;
            return { ...n, properties: { ...n.properties, opacity: next } };
          }),
        }));
      },

      reset() {
        // New is a deliberate "start fresh" (guarded by a confirm dialog), so
        // it wipes the undo/redo stack too — you can't undo back into the old
        // design.
        set({
          tree: [],
          selectedIds: [],
          nameCounters: {},
          past: [],
          future: [],
          _txn: null,
          _txnDirty: false,
          _coalesceKey: null,
          _coalesceAt: 0,
        });
      },

      loadTree(tree) {
        // Crossing a view boundary — clear selection + undo so we can't
        // accidentally undo back into a different view's state.
        set({
          tree,
          selectedIds: [],
          past: [],
          future: [],
          _txn: null,
          _txnDirty: false,
          _coalesceKey: null,
          _coalesceAt: 0,
        });
      },
    }),
    {
      name: 'lens-designer/design-store',
      version: 1,
      storage: createJSONStorage(() => (typeof window === 'undefined' ? noopStorage : localStorage)),
      // Don't persist selectedIds — selection should not survive reloads
      // (selected nodes may have been deleted in another tab).
      partialize: (s) => ({
        tree: s.tree,
        previewRegion: s.previewRegion,
        nameCounters: s.nameCounters,
        gridEnabled: s.gridEnabled,
      autoPublish: s.autoPublish,
        gridSize: s.gridSize,
        previewDistance: s.previewDistance,
        customFonts: s.customFonts,
        viewStashes: s.viewStashes,
        activeViewId: s.activeViewId,
        boundProjectKey: s.boundProjectKey,
      }),
    },
  ),
);

// SSR-safe storage stub. Zustand calls storage methods during hydrate
// when document is undefined; this avoids the runtime warning.
const noopStorage: Storage = {
  length: 0,
  clear() {},
  getItem() {
    return null;
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {},
};
