'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDesignStore } from '@/lib/design-model';
import { resolveTreeForState } from '@/lib/resolve-state';
import { cmToPx, pxToCm, rgbaToCss } from '@/lib/coord';
import { bridgeImageUrl, bridgeFontUrl } from '@/lib/bridge-http';
import { useDefinitions, defRootNode } from '@/lib/definitions';
import { computeHugLayout, type DesignNode, type HugItem, type InteractionState } from '@lens-designer/bridge/client';

/** The four interaction states, with friendly labels for the canvas switcher. */
const EDIT_STATES: Array<{ value: InteractionState; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'hover', label: 'Hover' },
  { value: 'pinched', label: 'Pinched' },
  { value: 'disabled', label: 'Disabled' },
];

/** Map manifest font name → CSS font-family. Mirrors FONT_PRESETS in
 *  bridge/src/manifests/text.ts so the canvas previews the same
 *  typeface that LS will render. */
const FONT_FAMILIES: Record<string, string> = {
  LibreBaskerville: '"Libre Baskerville", Georgia, serif',
  CutiveMono: '"Cutive Mono", "Courier New", monospace',
  Merriweather: 'Merriweather, Georgia, serif',
};

/** FontFace families already registered (uploaded fonts), so we don't re-add. */
const loadedFontFamilies = new Set<string>();

// Canvas uses the global cmToPx (10 px/cm) for text — same scale as
// rectangles so the canvas is internally consistent. Pixel-perfect
// match with the LS Spectacles Preview perspective render requires
// per-region calibration; that's Phase 1.5.

interface CanvasProps {
  /**
   * False when no view is selected. The canvas overlays a CTA
   * directing the user to select / create a view; placing primitives
   * without an active view would leave them orphaned.
   */
  hasActiveView: boolean;
  /**
   * True if the project has at least one saved view. Drives the
   * empty-state copy: with no views the CTA says "Create your first
   * view"; with existing views it says "Select a view from the left,
   * or create a new one" so we don't claim the user has no views when
   * they do.
   */
  hasAnyViews: boolean;
  /** True when the bridge has an attached LS target. */
  connected: boolean;
}

/**
 * 2D vector-editor canvas. Coords are cm with origin at the visual
 * center; SVG uses a viewBox that mirrors that so we can write
 * `<rect x={pos.x - w/2} ...>` and it lines up with the preview.
 */
export function Canvas({ hasActiveView, hasAnyViews, connected }: CanvasProps) {
  const tree = useDesignStore((s) => s.tree);
  const selectedIds = useDesignStore((s) => s.selectedIds);
  const selectNode = useDesignStore((s) => s.selectNode);
  const selectMany = useDesignStore((s) => s.selectMany);
  const patchNodes = useDesignStore((s) => s.patchNodes);
  const gridEnabled = useDesignStore((s) => s.gridEnabled);
  const gridSize = useDesignStore((s) => s.gridSize);
  const setGridEnabled = useDesignStore((s) => s.setGridEnabled);
  const setGridSize = useDesignStore((s) => s.setGridSize);
  const editState = useDesignStore((s) => s.editState);
  const setEditState = useDesignStore((s) => s.setEditState);
  const customFonts = useDesignStore((s) => s.customFonts);
  const ref = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Live alignment guides (design cm) shown while dragging; cleared on drop.
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  // Bumped once the web fonts finish loading so text wrap (which calls
  // measureText) recomputes with real metrics instead of fallback ones.
  const [, setFontTick] = useState(0);
  const zoom = 1; // Fixed zoom — pan/zoom was dropped from Phase 1.5.

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const fams = ['"Libre Baskerville"', '"Cutive Mono"', 'Merriweather'];
    Promise.all(fams.map((f) => document.fonts.load(`20px ${f}`).catch(() => undefined))).then(() => {
      document.fonts.ready.then(() => setFontTick((n) => n + 1));
    });
  }, []);

  // Register uploaded fonts as FontFaces so the canvas previews them. Each
  // family loads once (tracked module-side); bump fontTick when new ones land
  // so wrap/measureText recompute with real metrics.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    const pending = customFonts.filter((f) => !loadedFontFamilies.has(f.family));
    if (pending.length === 0) return;
    Promise.all(
      pending.map(async (f) => {
        try {
          const face = new FontFace(f.family, `url(${bridgeFontUrl(f.path)})`);
          await face.load();
          document.fonts.add(face);
          loadedFontFamilies.add(f.family);
        } catch {
          // font fetch/parse failed — leave it unregistered (falls back)
        }
      }),
    ).then(() => {
      if (!cancelled) setFontTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [customFonts]);

  /**
   * Group-drag state. Pointer-capture on the node's SVG group so we don't
   * lose events when the cursor crosses a sibling. Captures the start cm
   * position of every node moving together so a multi-select drag stays
   * rigid; live position is start + delta(px → cm).
   */
  const dragRef = useRef<{
    pointerId: number;
    startPx: { x: number; y: number };
    nodes: Array<{ id: string; startCm: { x: number; y: number } }>;
    /** Combined bbox of the moving set at drag start (design cm). */
    startBox: BBox;
    /** Static snap targets from non-moving nodes + the canvas axes. */
    targetsX: number[];
    targetsY: number[];
    /** Snap (grid + guides) only for top-level drags; nested moves are raw. */
    snap: boolean;
  } | null>(null);

  /** Rubber-band marquee state, in SVG-centered px (1 unit = 1 px). */
  const marqueeRef = useRef<{
    pointerId: number;
    startSvg: { x: number; y: number };
    additive: boolean;
    moved: boolean;
  } | null>(null);

  /** Client px → SVG-centered px (viewBox is centered, 1 unit = 1 px). */
  function toSvgCenter(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  }

  function beginDrag(node: DesignNode, e: React.PointerEvent<SVGGElement>) {
    const state = useDesignStore.getState();
    const movingIds = state.selectedIds.includes(node.id) ? state.selectedIds : [node.id];
    const movingSet = new Set(movingIds);
    const nodes = movingIds.flatMap((id) => {
      const n = findNodeById(state.tree, id);
      return n ? [{ id, startCm: readVec2(n.properties['position'], { x: 0, y: 0 }) }] : [];
    });
    // Snapping (alignment guides + grid) applies only to top-level drags,
    // where positions are absolute. A nested child moves in its group's local
    // space, so snapping it against top-level targets would be wrong — drag raw.
    const topLevel = movingIds.every((id) => state.tree.some((t) => t.id === id));
    const movingNodes = state.tree.filter((t) => movingSet.has(t.id));
    const startBox = combinedBBoxCm(movingNodes);
    const targetsX = [0];
    const targetsY = [0];
    if (topLevel) {
      for (const t of state.tree) {
        if (movingSet.has(t.id)) continue;
        const b = nodeBBoxCm(t);
        targetsX.push(b.xMin, (b.xMin + b.xMax) / 2, b.xMax);
        targetsY.push(b.yMin, (b.yMin + b.yMax) / 2, b.yMax);
      }
    }
    dragRef.current = { pointerId: e.pointerId, startPx: { x: e.clientX, y: e.clientY }, nodes, startBox, targetsX, targetsY, snap: topLevel };
    // Coalesce the whole drag into one undo step (no-op if nothing moves).
    useDesignStore.getState().beginTransaction();
    try {
      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    } catch {
      // pointer not capturable (e.g. already released)
    }
  }

  function continueDrag(e: React.PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // SVG y is inverted vs. the design model — pointer DOWN decreases design.y.
    let dxCm = pxToCm(e.clientX - drag.startPx.x, zoom);
    let dyCm = pxToCm(-(e.clientY - drag.startPx.y), zoom);

    // Snapping (Alt bypasses). Alignment guides take priority; grid fills in
    // on any axis the guides didn't already snap.
    let gx: number[] = [];
    let gy: number[] = [];
    if (!e.altKey && drag.snap) {
      const thr = pxToCm(SNAP_PX, zoom);
      const box = drag.startBox;
      const probesX = [box.xMin + dxCm, (box.xMin + box.xMax) / 2 + dxCm, box.xMax + dxCm];
      const probesY = [box.yMin + dyCm, (box.yMin + box.yMax) / 2 + dyCm, box.yMax + dyCm];
      const sx = snapAxis(probesX, drag.targetsX, thr);
      const sy = snapAxis(probesY, drag.targetsY, thr);
      if (sx.guides.length) { dxCm += sx.snap; gx = sx.guides; }
      else if (gridEnabled) { dxCm += gridSnapDelta((box.xMin + box.xMax) / 2 + dxCm, gridSize); }
      if (sy.guides.length) { dyCm += sy.snap; gy = sy.guides; }
      else if (gridEnabled) { dyCm += gridSnapDelta((box.yMin + box.yMax) / 2 + dyCm, gridSize); }
    }
    setGuides({ x: gx, y: gy });

    patchNodes(
      drag.nodes.map((n) => ({
        id: n.id,
        props: { position: { x: n.startCm.x + dxCm, y: n.startCm.y + dyCm } },
      })),
    );
  }

  function endDrag(e: React.PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      try {
        (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
      } catch {
        // pointer was already released
      }
    }
    dragRef.current = null;
    setGuides({ x: [], y: [] });
    useDesignStore.getState().endTransaction();
  }

  // Select + begin drag for a node (works at any nesting depth). Shared with
  // nested nodes via NodeRenderContext.
  function handleNodePointerDown(node: DesignNode, e: React.PointerEvent<SVGGElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Toggle membership; don't start a drag.
      selectNode(node.id, true);
      return;
    }
    // Clicking an unselected node selects just it; clicking one already in the
    // selection keeps the group so a multi-select drag stays intact.
    if (!useDesignStore.getState().selectedIds.includes(node.id)) {
      selectNode(node.id);
    }
    // Non-default state is preview-only (WB2): allow selection, skip drag so a
    // state-preview gesture can't move base geometry.
    if (editState === 'default') beginDrag(node, e);
  }

  // --- Marquee (rubber-band) selection on empty canvas ---
  function bgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    marqueeRef.current = {
      pointerId: e.pointerId,
      startSvg: toSvgCenter(e),
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer not capturable
    }
  }

  function bgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const m = marqueeRef.current;
    if (!m || m.pointerId !== e.pointerId) return;
    const p = toSvgCenter(e);
    const x = Math.min(m.startSvg.x, p.x);
    const y = Math.min(m.startSvg.y, p.y);
    const w = Math.abs(p.x - m.startSvg.x);
    const h = Math.abs(p.y - m.startSvg.y);
    if (w > 3 || h > 3) m.moved = true;
    setMarquee({ x, y, w, h });
  }

  function bgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const m = marqueeRef.current;
    if (!m || m.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (m.moved) {
      const p = toSvgCenter(e);
      // Marquee → design cm (y up). SVG y is down, so top = -minY.
      const xMin = pxToCm(Math.min(m.startSvg.x, p.x), zoom);
      const xMax = pxToCm(Math.max(m.startSvg.x, p.x), zoom);
      const yMax = pxToCm(-Math.min(m.startSvg.y, p.y), zoom);
      const yMin = pxToCm(-Math.max(m.startSvg.y, p.y), zoom);
      const hits = tree
        .filter((n) => bboxIntersects(nodeBBoxCm(n), { xMin, xMax, yMin, yMax }))
        .map((n) => n.id);
      if (m.additive) {
        const cur = useDesignStore.getState().selectedIds;
        selectMany([...new Set([...cur, ...hits])]);
      } else {
        selectMany(hits);
      }
    } else if (!m.additive) {
      // Plain click on empty space clears the selection.
      selectNode(null);
    }
    marqueeRef.current = null;
    setMarquee(null);
  }

  // Keyboard: Delete/Backspace removes the selection, Escape clears it,
  // Cmd/Ctrl+A selects all. Ignored while typing in a form field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      const store = useDesignStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.removeSelected();
        }
      } else if (e.key === 'Escape') {
        store.selectNode(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (store.tree.length > 0) {
          e.preventDefault();
          store.selectMany(store.tree.map((n) => n.id));
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        // ⌘Z undo, ⌘⇧Z redo. (Text inputs are excluded above, so native
        // text undo still works while editing a field.)
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          // ⌘⇧G — ungroup the sole-selected top-level group.
          const sel = store.selectedIds;
          if (sel.length === 1) {
            const n = store.tree.find((t) => t.id === sel[0]);
            if (n && n.type === 'Group') store.ungroup(n.id);
          }
        } else if (store.selectedIds.length > 0) {
          // ⌘G — group the selection.
          store.group();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.copy();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.cut();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (store.clipboard.length > 0) {
          e.preventDefault();
          store.paste();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.duplicate();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Initial measurement — ResizeObserver only fires on *changes*, not
    // on initial layout. Without this, `size` stays at the default
    // 800×600 until something else triggers a resize (e.g. window
    // resize, splitter drag). With the no-view overlay collapsing on
    // first view-create, the bounding box can settle non-trivially
    // late, so we measure synchronously here too.
    const initial = el.getBoundingClientRect();
    if (initial.width > 0 && initial.height > 0) {
      setSize({ w: initial.width, h: initial.height });
    }
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      // Ignore zero-dimension measurements (transient during reflows
      // and the no-view → view-selected swap). The SVG renders nothing
      // at 0×0 — once size flips to 0, the user sees an empty canvas
      // even after the layout settles non-zero.
      if (r.width > 0 && r.height > 0) {
        setSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render layers back-to-front so index 0 paints last (on top).
  // Render the tree resolved for the active edit-state (identity for 'default'),
  // so hover/pinch/disabled previews show on-canvas (WB2). Editing is gated to
  // 'default' below — non-default states are preview-only until WB3 wires
  // override authoring.
  const previewing = editState !== 'default';
  const renderTree = resolveTreeForState(tree, editState);
  const renderOrder = renderTree.slice().reverse();
  const soleSelected = selectedIds.length === 1 ? tree.find((n) => n.id === selectedIds[0]) : undefined;

  return (
    <section
      ref={ref}
      className="relative h-full border-r border-border-subtle overflow-hidden"
      style={{
        background:
          'repeating-conic-gradient(var(--bg-canvas) 0% 25%, var(--bg-canvas-checker) 0% 50%) 50% / 16px 16px',
      }}
      aria-label="Canvas"
    >
      {/* Empty-state overlay sits ON the canvas (not in place of it) so
          the ResizeObserver on `ref` keeps a live target across the
          no-view → view-selected transition. Replacing the section with
          a different element used to leave the observer attached to a
          detached node — `size` froze at the empty-state's measurement
          and the SVG never resized when the user added objects. */}
      {!hasActiveView && <NoViewOverlay connected={connected} hasAnyViews={hasAnyViews} />}
      <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
        <span className="px-2 py-1 rounded bg-bg-2 text-text-secondary font-num text-sm">
          {Math.round(zoom * 100)}%
        </span>
        <label
          className={`flex items-center gap-1.5 px-2 py-1 rounded bg-bg-2 text-sm cursor-pointer select-none ${
            gridEnabled ? 'text-text-primary' : 'text-text-secondary'
          }`}
          title="Snap to grid (hold Alt while dragging to bypass)"
        >
          <input
            type="checkbox"
            checked={gridEnabled}
            onChange={(e) => setGridEnabled(e.target.checked)}
            className="accent-[var(--accent-500)]"
          />
          Grid
        </label>
        {gridEnabled && (
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-bg-2 text-sm text-text-secondary">
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={gridSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setGridSize(n);
              }}
              className="w-12 bg-bg-4 border border-border-subtle rounded px-1 text-right font-num text-text-primary focus:border-accent-500 focus:outline-none"
            />
            cm
          </span>
        )}
        {/* State switcher (WB2): preview hover/pinch/disabled on-canvas. Non-
            default states are preview-only (editing gated to Default). */}
        <div
          className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-bg-2"
          role="group"
          aria-label="Preview interaction state"
        >
          {EDIT_STATES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setEditState(s.value)}
              title={s.value === 'default' ? 'Base design (editable)' : `Preview the ${s.label} state`}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                editState === s.value
                  ? 'bg-accent-500 text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-3'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {previewing && (
          <span className="px-2 py-1 rounded bg-bg-2 text-[11px] text-text-tertiary">
            preview-only
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0"
        onPointerDown={bgPointerDown}
        onPointerMove={bgPointerMove}
        onPointerUp={bgPointerUp}
        onPointerCancel={bgPointerUp}
      >
        {gridEnabled && (
          <>
            <defs>
              <pattern
                id="ld-grid"
                width={cmToPx(gridSize, zoom)}
                height={cmToPx(gridSize, zoom)}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${cmToPx(gridSize, zoom)} 0 L 0 0 0 ${cmToPx(gridSize, zoom)}`}
                  fill="none"
                  stroke="var(--border-subtle)"
                  strokeWidth={1}
                />
              </pattern>
            </defs>
            <rect
              x={-size.w / 2}
              y={-size.h / 2}
              width={size.w}
              height={size.h}
              fill="url(#ld-grid)"
              pointerEvents="none"
            />
          </>
        )}
        <NodeRenderContext.Provider
          value={{
            selectedIds,
            zoom,
            onNodePointerDown: handleNodePointerDown,
            continueDrag,
            endDrag,
          }}
        >
          {renderOrder.map((node) => (
            <NodeView key={node.id} node={node} />
          ))}
        </NodeRenderContext.Provider>

        {!previewing && soleSelected && soleSelected.type !== 'Group' && soleSelected.type !== 'Instance' && (
          <ResizeHandles
            node={soleSelected}
            zoom={zoom}
            patchNodes={patchNodes}
            gridEnabled={gridEnabled}
            gridSize={gridSize}
          />
        )}

        {marquee && (marquee.w > 0 || marquee.h > 0) && (
          <rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
            fill="var(--accent-400)"
            fillOpacity={0.12}
            stroke="var(--accent-400)"
            strokeWidth={1}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}

        {guides.x.map((gx) => (
          <line
            key={`gx-${gx}`}
            x1={cmToPx(gx, zoom)}
            y1={-size.h / 2}
            x2={cmToPx(gx, zoom)}
            y2={size.h / 2}
            stroke="var(--danger)"
            strokeWidth={1}
            pointerEvents="none"
          />
        ))}
        {guides.y.map((gy) => (
          <line
            key={`gy-${gy}`}
            x1={-size.w / 2}
            y1={cmToPx(-gy, zoom)}
            x2={size.w / 2}
            y2={cmToPx(-gy, zoom)}
            stroke="var(--danger)"
            strokeWidth={1}
            pointerEvents="none"
          />
        ))}
      </svg>

      {tree.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-text-secondary text-base text-center">
            <div className="text-md text-text-primary mb-2">Empty canvas</div>
            <div>Click a primitive in the palette to add it.</div>
          </div>
        </div>
      )}
    </section>
  );
}

interface NodeViewProps {
  node: DesignNode;
  selected: boolean;
  zoom: number;
  onSelect: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerCancel: (e: React.PointerEvent<SVGGElement>) => void;
}

/** Shared render/interaction context so nodes (including nested group
 *  children) build their own handlers + selected state without prop-drilling
 *  through the recursion. */
interface NodeCtx {
  selectedIds: string[];
  zoom: number;
  onNodePointerDown: (node: DesignNode, e: React.PointerEvent<SVGGElement>) => void;
  continueDrag: (e: React.PointerEvent<SVGGElement>) => void;
  endDrag: (e: React.PointerEvent<SVGGElement>) => void;
}
const NodeRenderContext = createContext<NodeCtx | null>(null);

function NodeView({ node }: { node: DesignNode }) {
  const ctx = useContext(NodeRenderContext);
  if (!ctx) return null;
  const selected = ctx.selectedIds.includes(node.id);
  if (node.instance) {
    return <InstanceNodeView node={node} selected={selected} ctx={ctx} />;
  }
  if (node.type === 'Group') {
    return <GroupView node={node} selected={selected} ctx={ctx} />;
  }
  const props: NodeViewProps = {
    node,
    selected,
    zoom: ctx.zoom,
    onSelect: (e) => e.stopPropagation(),
    onPointerDown: (e) => ctx.onNodePointerDown(node, e),
    onPointerMove: ctx.continueDrag,
    onPointerUp: ctx.endDrag,
    onPointerCancel: ctx.endDrag,
  };
  switch (node.type) {
    case 'Rectangle':
      return <RectangleView {...props} />;
    case 'Ellipse':
      return <EllipseView {...props} />;
    case 'Polygon':
      return <PolygonView {...props} />;
    case 'Image':
      return <ImageNodeView {...props} />;
    case 'Text':
      return <TextView {...props} />;
    default:
      return null;
  }
}

/** A shared-component INSTANCE: draws its definition's tree read-only at the
 *  instance transform (slot overrides applied), with a selectable hit box +
 *  a component badge. The definition comes from the useDefinitions cache —
 *  while it loads (or if the def view lost its component marker), a labeled
 *  placeholder renders instead. Children are non-interactive (pointerEvents
 *  none): you edit the DEFINITION, not the instance. */
function InstanceNodeView({ node, selected, ctx }: { node: DesignNode; selected: boolean; ctx: NodeCtx }) {
  const z = ctx.zoom;
  const defs = useDefinitions((s) => s.defs);
  const entry = node.instance ? defs[node.instance.of] : undefined;
  const defRoot = defRootNode(entry);
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const transform = `translate(${cmToPx(pos.x, z)} ${cmToPx(-pos.y, z)}) rotate(${-rotation})`;

  const slots = node.instance?.overrides?.slots ?? {};
  const children = defRoot ? applyInstanceSlots(defRoot.children, slots) : [];
  // index 0 = front → paint last (same convention as GroupView).
  const order = children.slice().reverse();

  const { w, h } = nodeSizeCm(node);
  const Lpx = cmToPx(-w / 2, z);
  const Tpx = cmToPx(-h / 2, z);
  const Wpx = cmToPx(w, z);
  const Hpx = cmToPx(h, z);
  const cast = (e: React.PointerEvent<SVGRectElement>) => e as unknown as React.PointerEvent<SVGGElement>;

  return (
    <g transform={transform}>
      {defRoot ? (
        <g pointerEvents="none">
          {order.map((c) => (
            <NodeView key={c.id} node={c} />
          ))}
        </g>
      ) : (
        <>
          <rect x={Lpx} y={Tpx} width={Wpx} height={Hpx} fill="var(--bg-3)" fillOpacity={0.5}
            stroke="var(--border-default)" strokeDasharray="4 3" pointerEvents="none" />
          <text x={0} y={4} textAnchor="middle" fontSize={11} fill="var(--text-tertiary)" pointerEvents="none">
            {node.name}
          </text>
        </>
      )}
      {/* hit box: select + drag the whole instance */}
      <rect
        x={Lpx}
        y={Tpx}
        width={Wpx}
        height={Hpx}
        fill="transparent"
        style={{ cursor: 'move' }}
        onPointerDown={(e) => ctx.onNodePointerDown(node, cast(e))}
        onPointerMove={(e) => ctx.continueDrag(cast(e))}
        onPointerUp={(e) => ctx.endDrag(cast(e))}
        onPointerCancel={(e) => ctx.endDrag(cast(e))}
      />
      {selected && (
        <rect
          x={Lpx - 4}
          y={Tpx - 4}
          width={Wpx + 8}
          height={Hpx + 8}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          pointerEvents="none"
        />
      )}
      {/* component badge: top-left, purple-ish to distinguish from groups */}
      <g transform={`translate(${Lpx} ${Tpx - 6})`} pointerEvents="none">
        <text fontSize={9} fill="var(--accent-400)" fontWeight={600}>
          ⬡ {entry?.codeName ?? node.name}
        </text>
      </g>
    </g>
  );
}

/** Apply per-instance slot overrides onto a definition subtree (canvas-side
 *  mirror of the bridge expansion's cloneWithOverrides). */
function applyInstanceSlots(nodes: DesignNode[], slots: Record<string, unknown>): DesignNode[] {
  return nodes.map((n) => {
    let properties = n.properties;
    if (n.binding && Object.prototype.hasOwnProperty.call(slots, n.binding.key)) {
      const v = slots[n.binding.key];
      if (n.type === 'Text' && typeof v === 'string') properties = { ...properties, text: v };
      else if (n.type === 'Image' && typeof v === 'string') properties = { ...properties, imageSource: v };
    }
    return { ...n, properties, children: applyInstanceSlots(n.children, slots) };
  });
}

/** A Group: nests its children under its transform; when selected, shows a
 *  dashed bounds outline + a transparent grab handle that drags the whole
 *  group (children follow via the nested transform). */
function GroupView({ node, selected, ctx }: { node: DesignNode; selected: boolean; ctx: NodeCtx }) {
  const z = ctx.zoom;
  const customFonts = useDesignStore((s) => s.customFonts);
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const transform = `translate(${cmToPx(pos.x, z)} ${cmToPx(-pos.y, z)}) rotate(${-rotation})`;

  // WB-L hug: a group with hug layout sizes to its content children + padding.
  // Children render at solver-computed positions; a `fillParent` child stretches
  // to the hugged size. This is the live designer feedback — the pill grows as
  // the (bound) text changes.
  const hug = node.layout?.hug ? node.layout : null;
  let renderChildren = node.children;
  let hugBB: BBox | null = null;
  if (hug) {
    const items = node.children.map((c) => measureHugItem(c, z, customFonts));
    const res = computeHugLayout(items, { mode: hug.mode, spacing: hug.spacing, padding: hug.padding });
    hugBB = { xMin: -res.group.w / 2, xMax: res.group.w / 2, yMin: -res.group.h / 2, yMax: res.group.h / 2 };
    renderChildren = node.children.map((c, i) => {
      const b = res.boxes[i]!;
      const nextProps: Record<string, unknown> = { ...c.properties, position: { x: b.x, y: b.y } };
      if (c.fillParent) nextProps['size'] = { x: b.w, y: b.h };
      return { ...c, properties: nextProps };
    });
  }

  // index 0 = front → paint last.
  const order = renderChildren.slice().reverse();
  const bb = hugBB ?? localBBox(node);
  const Lpx = cmToPx(bb.xMin, z);
  const Rpx = cmToPx(bb.xMax, z);
  const Tpx = cmToPx(-bb.yMax, z); // svg y is flipped
  const Bpx = cmToPx(-bb.yMin, z);
  const cast = (e: React.PointerEvent<SVGRectElement>) => e as unknown as React.PointerEvent<SVGGElement>;
  return (
    <g transform={transform}>
      {order.map((c) => (
        <NodeView key={c.id} node={c} />
      ))}
      {selected && (
        <>
          <rect
            x={Lpx}
            y={Tpx}
            width={Rpx - Lpx}
            height={Bpx - Tpx}
            fill="transparent"
            style={{ cursor: 'move' }}
            onPointerDown={(e) => ctx.onNodePointerDown(node, cast(e))}
            onPointerMove={(e) => ctx.continueDrag(cast(e))}
            onPointerUp={(e) => ctx.endDrag(cast(e))}
            onPointerCancel={(e) => ctx.endDrag(cast(e))}
          />
          <rect
            x={Lpx - 4}
            y={Tpx - 4}
            width={Rpx - Lpx + 8}
            height={Bpx - Tpx + 8}
            fill="none"
            stroke="var(--accent-400)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            pointerEvents="none"
          />
        </>
      )}
    </g>
  );
}

function readVec2(v: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  if (typeof v === 'object' && v !== null && 'x' in v && 'y' in v) {
    const o = v as Record<string, unknown>;
    const x = typeof o['x'] === 'number' ? o['x'] : fallback.x;
    const y = typeof o['y'] === 'number' ? o['y'] : fallback.y;
    return { x, y };
  }
  return fallback;
}

function readNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function readRgba(v: unknown): { r: number; g: number; b: number; a: number } {
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return {
      r: typeof o['r'] === 'number' ? o['r'] : 255,
      g: typeof o['g'] === 'number' ? o['g'] : 255,
      b: typeof o['b'] === 'number' ? o['b'] : 255,
      a: typeof o['a'] === 'number' ? o['a'] : 100,
    };
  }
  return { r: 255, g: 255, b: 255, a: 100 };
}

/** Node size in design cm. Every primitive (including Text, post box-model)
 *  carries a `size` box, so marquee + resize read it uniformly. */
function nodeSizeCm(node: DesignNode): { w: number; h: number } {
  const s = readVec2(node.properties['size'], { x: 8, y: 4 });
  return { w: s.x, h: s.y };
}

interface BBox { xMin: number; xMax: number; yMin: number; yMax: number }

/** Depth-first find a node by id. */
function findNodeById(nodes: DesignNode[], id: string): DesignNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return undefined;
}

/** A node's bbox in its OWN local frame (centered at the node origin). For a
 *  Group, the union of its children's bboxes offset by their positions. */
function localBBox(node: DesignNode): BBox {
  if (node.type === 'Group') {
    if (node.children.length === 0) return { xMin: -4, xMax: 4, yMin: -2, yMax: 2 };
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const c of node.children) {
      const cp = readVec2(c.properties['position'], { x: 0, y: 0 });
      const b = localBBox(c);
      xMin = Math.min(xMin, cp.x + b.xMin); xMax = Math.max(xMax, cp.x + b.xMax);
      yMin = Math.min(yMin, cp.y + b.yMin); yMax = Math.max(yMax, cp.y + b.yMax);
    }
    return { xMin, xMax, yMin, yMax };
  }
  const { w, h } = nodeSizeCm(node);
  return { xMin: -w / 2, xMax: w / 2, yMin: -h / 2, yMax: h / 2 };
}

/** Measure one child for the hug solver (cm). Text is measured from its actual
 *  content (so the pill grows as the text changes); other content uses its size;
 *  a fillParent child isn't measured (it takes the hugged size). */
function measureHugItem(node: DesignNode, z: number, customFonts: { path: string; family: string }[]): HugItem {
  if (node.fillParent) return { w: 0, h: 0, fill: true };
  if (node.type === 'Text') {
    const fontSizeCm = readNumber(node.properties['fontSize'], 1);
    const text = typeof node.properties['text'] === 'string' ? node.properties['text'] : 'Text';
    const fontName = typeof node.properties['font'] === 'string' ? node.properties['font'] : 'LibreBaskerville';
    const lsCm = readNumber(node.properties['letterSpacing'], 0);
    const custom = customFonts.find((f) => f.path === fontName);
    const cssFamily = custom
      ? `"${custom.family}", "Libre Baskerville", Georgia, serif`
      : FONT_FAMILIES[fontName] ?? '"Libre Baskerville", Georgia, serif';
    const fontPx = fontSizeCm * FONT_EM_PER_CM * z;
    const lsPx = cmToPx(lsCm, z);
    const lines = text.split('\n');
    const widestPx = Math.max(1, ...lines.map((l) => measureWidth(l, `${fontPx}px ${cssFamily}`, lsPx)));
    return { w: pxToCm(widestPx, z), h: lines.length * fontSizeCm * 1.2, fill: false };
  }
  const { w, h } = nodeSizeCm(node);
  return { w, h, fill: false };
}

/** Axis-aligned bounding box in the parent's design cm (y up). Rotation is
 *  ignored for hit-testing. Groups span their children's extent. */
function nodeBBoxCm(node: DesignNode): BBox {
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const b = localBBox(node);
  return { xMin: pos.x + b.xMin, xMax: pos.x + b.xMax, yMin: pos.y + b.yMin, yMax: pos.y + b.yMax };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.xMax < b.xMin || a.xMin > b.xMax || a.yMax < b.yMin || a.yMin > b.yMax);
}

/** Union bbox of several nodes in design cm. Empty → a zero box at origin. */
function combinedBBoxCm(nodes: DesignNode[]): BBox {
  if (nodes.length === 0) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  const boxes = nodes.map(nodeBBoxCm);
  return {
    xMin: Math.min(...boxes.map((b) => b.xMin)),
    xMax: Math.max(...boxes.map((b) => b.xMax)),
    yMin: Math.min(...boxes.map((b) => b.yMin)),
    yMax: Math.max(...boxes.map((b) => b.yMax)),
  };
}

const SNAP_PX = 6; // alignment-guide snap radius, in screen px

/**
 * Find the best single-axis snap for a moving box. `probes` are the box's
 * candidate edges/center (already shifted by the raw drag), `targets` are
 * static lines (other nodes' edges/centers + canvas axis). Returns the snap
 * offset to add and every target the box coincides with after snapping (so
 * simultaneous edge+center alignments all draw a guide).
 */
function snapAxis(probes: number[], targets: number[], thresholdCm: number): { snap: number; guides: number[] } {
  let best: number | null = null;
  for (const p of probes) {
    for (const t of targets) {
      const d = t - p;
      if (Math.abs(d) <= thresholdCm && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return { snap: 0, guides: [] };
  const guides = targets.filter((t) => probes.some((p) => Math.abs(p + best! - t) < 0.05));
  return { snap: best, guides: [...new Set(guides)] };
}

/** cm offset that lands `value` on the nearest grid multiple. */
function gridSnapDelta(value: number, grid: number): number {
  return Math.round(value / grid) * grid - value;
}

const MIN_SIZE_CM = 0.5;
const HANDLE_PX = 8;

/** 8 resize handles. hx/hy are the local-axis direction of each handle:
 *  hx -1=left/+1=right, hy -1=top/+1=bottom (SVG y-down local frame). */
const RESIZE_HANDLES: Array<{ id: string; hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string }> = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' },
  { id: 'n', hx: 0, hy: -1, cursor: 'ns-resize' },
  { id: 'ne', hx: 1, hy: -1, cursor: 'nesw-resize' },
  { id: 'e', hx: 1, hy: 0, cursor: 'ew-resize' },
  { id: 'se', hx: 1, hy: 1, cursor: 'nwse-resize' },
  { id: 's', hx: 0, hy: 1, cursor: 'ns-resize' },
  { id: 'sw', hx: -1, hy: 1, cursor: 'nesw-resize' },
  { id: 'w', hx: -1, hy: 0, cursor: 'ew-resize' },
];

interface ResizeHandlesProps {
  node: DesignNode;
  zoom: number;
  patchNodes: (patches: Array<{ id: string; props: Record<string, unknown> }>) => void;
  gridEnabled: boolean;
  gridSize: number;
}

/**
 * 8-point resize box for a single selected node. Resizes in the node's local
 * frame (works under rotation) keeping the opposite edge/corner anchored;
 * Shift on a corner locks aspect. Live cm readout while dragging. Text is
 * excluded — it's sized by font, not a box.
 */
function ResizeHandles({ node, zoom, patchNodes, gridEnabled, gridSize }: ResizeHandlesProps) {
  const resizeRef = useRef<{
    pointerId: number;
    hx: number;
    hy: number;
    aspect: boolean;
    startClient: { x: number; y: number };
    start: { cx: number; cy: number; w: number; h: number };
    rotation: number;
  } | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);

  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const sizeCm = readVec2(node.properties['size'], { x: 8, y: 4 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const xPx = cmToPx(pos.x, zoom);
  const yPx = cmToPx(-pos.y, zoom);
  const wPx = cmToPx(sizeCm.x, zoom);
  const hPx = cmToPx(sizeCm.y, zoom);
  const transform = `translate(${xPx} ${yPx}) rotate(${-rotation})`;

  function begin(h: (typeof RESIZE_HANDLES)[number], e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizeRef.current = {
      pointerId: e.pointerId,
      hx: h.hx,
      hy: h.hy,
      aspect: e.shiftKey,
      startClient: { x: e.clientX, y: e.clientY },
      start: { cx: pos.x, cy: pos.y, w: sizeCm.x, h: sizeCm.y },
      rotation,
    };
    // One undo step for the whole resize gesture.
    useDesignStore.getState().beginTransaction();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer not capturable
    }
    setLive({ w: sizeCm.x, h: sizeCm.y });
  }

  function move(e: React.PointerEvent<SVGRectElement>) {
    const r = resizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const dxPx = e.clientX - r.startClient.x;
    const dyPx = e.clientY - r.startClient.y;
    // Undo the SVG rotate(-rotation): map screen delta into the local frame.
    const rad = (r.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lDxCm = pxToCm(cos * dxPx - sin * dyPx, zoom);
    const lDyCm = pxToCm(sin * dxPx + cos * dyPx, zoom); // local y is down

    let newW = Math.max(MIN_SIZE_CM, r.start.w + r.hx * lDxCm);
    let newH = Math.max(MIN_SIZE_CM, r.start.h + r.hy * lDyCm);
    if (r.aspect && r.hx !== 0 && r.hy !== 0) {
      const scale = Math.max(newW / r.start.w, newH / r.start.h);
      newW = Math.max(MIN_SIZE_CM, r.start.w * scale);
      newH = Math.max(MIN_SIZE_CM, r.start.h * scale);
    } else if (gridEnabled && r.rotation === 0 && !e.altKey) {
      // Snap the dragged edge(s) to the grid (axis-aligned only). The
      // newPos formula below keeps the opposite edge fixed, so snapping the
      // size lands the moved edge on a grid line.
      if (r.hx === 1) {
        const left = r.start.cx - r.start.w / 2;
        newW = Math.max(MIN_SIZE_CM, Math.round((left + newW) / gridSize) * gridSize - left);
      } else if (r.hx === -1) {
        const right = r.start.cx + r.start.w / 2;
        newW = Math.max(MIN_SIZE_CM, right - Math.round((right - newW) / gridSize) * gridSize);
      }
      if (r.hy === -1) {
        const bottom = r.start.cy - r.start.h / 2;
        newH = Math.max(MIN_SIZE_CM, Math.round((bottom + newH) / gridSize) * gridSize - bottom);
      } else if (r.hy === 1) {
        const top = r.start.cy + r.start.h / 2;
        newH = Math.max(MIN_SIZE_CM, top - Math.round((top - newH) / gridSize) * gridSize);
      }
    }

    // Keep the opposite edge fixed: shift center half the size change toward
    // the dragged handle, rotate that local shift back into design (y-up).
    const lShiftX = (r.hx * (newW - r.start.w)) / 2;
    const lShiftY = (r.hy * (newH - r.start.h)) / 2;
    const newPos = {
      x: r.start.cx + (cos * lShiftX + sin * lShiftY),
      y: r.start.cy - (-sin * lShiftX + cos * lShiftY),
    };
    patchNodes([{ id: node.id, props: { size: { x: newW, y: newH }, position: newPos } }]);
    setLive({ w: newW, h: newH });
  }

  function end(e: React.PointerEvent<SVGRectElement>) {
    const r = resizeRef.current;
    if (r && r.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
    }
    resizeRef.current = null;
    setLive(null);
    useDesignStore.getState().endTransaction();
  }

  return (
    <g transform={transform}>
      <rect
        x={-wPx / 2}
        y={-hPx / 2}
        width={wPx}
        height={hPx}
        fill="none"
        stroke="var(--accent-400)"
        strokeWidth={1}
        pointerEvents="none"
      />
      {RESIZE_HANDLES.map((h) => (
        <rect
          key={h.id}
          x={(h.hx * wPx) / 2 - HANDLE_PX / 2}
          y={(h.hy * hPx) / 2 - HANDLE_PX / 2}
          width={HANDLE_PX}
          height={HANDLE_PX}
          fill="var(--bg-0)"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          style={{ cursor: h.cursor }}
          onPointerDown={(e) => begin(h, e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
      {live && (
        <text
          x={0}
          y={-hPx / 2 - 8}
          textAnchor="middle"
          fontSize={11}
          fill="var(--accent-300)"
          pointerEvents="none"
        >
          {live.w.toFixed(1)} × {live.h.toFixed(1)} cm
        </text>
      )}
    </g>
  );
}

function RectangleView({
  node,
  selected,
  zoom,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: NodeViewProps) {
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const size = readVec2(node.properties['size'], { x: 8, y: 4 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const opacity = readNumber(node.properties['opacity'], 100) / 100;
  const fill = readRgba(node.properties['fillColor']);
  const stroke = readRgba(node.properties['strokeColor']);
  const strokeWidthCm = readNumber(node.properties['strokeWidth'], 0);
  const tlCm = readNumber(node.properties['cornerTL'], 0);
  const trCm = readNumber(node.properties['cornerTR'], 0);
  const brCm = readNumber(node.properties['cornerBR'], 0);
  const blCm = readNumber(node.properties['cornerBL'], 0);

  // SVG y axis is flipped vs. Spectacles design coords. Flip here so a
  // positive y in the design model means "toward the top of the page,"
  // matching the LS preview.
  const xPx = cmToPx(pos.x, zoom);
  const yPx = cmToPx(-pos.y, zoom);
  const wPx = cmToPx(size.x, zoom);
  const hPx = cmToPx(size.y, zoom);
  const strokeWidthPx = cmToPx(strokeWidthCm, zoom);
  // SVG strokes are centered on the path. The LS shader puts the stroke
  // INSIDE the shape bounds, so inset by half the stroke width to match.
  const inset = strokeWidthPx / 2;

  // Clamp each corner so two adjacent radii can't exceed the available
  // edge — mirrors what a sane SDF does and keeps the path valid.
  const innerW = Math.max(0, wPx - strokeWidthPx);
  const innerH = Math.max(0, hPx - strokeWidthPx);
  const maxR = Math.min(innerW, innerH) / 2;
  const tl = Math.min(cmToPx(tlCm, zoom), maxR);
  const tr = Math.min(cmToPx(trCm, zoom), maxR);
  const br = Math.min(cmToPx(brCm, zoom), maxR);
  const bl = Math.min(cmToPx(blCm, zoom), maxR);

  // Build a rounded-rect path with independent corner radii. Origin is
  // the shape center; coords run left=-w/2 .. right=+w/2, top=-h/2.
  const L = -innerW / 2;
  const R = innerW / 2;
  const T = -innerH / 2;
  const B = innerH / 2;
  const path = [
    `M ${L + tl} ${T}`,
    `L ${R - tr} ${T}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${R} ${T + tr}` : `L ${R} ${T}`,
    `L ${R} ${B - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${R - br} ${B}` : `L ${R} ${B}`,
    `L ${L + bl} ${B}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${L} ${B - bl}` : `L ${L} ${B}`,
    `L ${L} ${T + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${L + tl} ${T}` : `L ${L} ${T}`,
    'Z',
  ].join(' ');

  const transform = `translate(${xPx} ${yPx}) rotate(${-rotation})`;

  return (
    <g
      transform={transform}
      opacity={opacity}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ cursor: 'move' }}
    >
      <path
        d={path}
        fill={rgbaToCss(fill)}
        stroke={strokeWidthPx > 0 ? rgbaToCss(stroke) : 'none'}
        strokeWidth={strokeWidthPx}
      />
      {selected && (
        <rect
          x={-wPx / 2 - 4}
          y={-hPx / 2 - 4}
          width={wPx + 8}
          height={hPx + 8}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

function EllipseView({
  node,
  selected,
  zoom,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: NodeViewProps) {
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const size = readVec2(node.properties['size'], { x: 8, y: 8 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const opacity = readNumber(node.properties['opacity'], 100) / 100;
  const fill = readRgba(node.properties['fillColor']);
  const stroke = readRgba(node.properties['strokeColor']);
  const strokeWidthCm = readNumber(node.properties['strokeWidth'], 0);

  // SVG y axis is flipped vs. Spectacles design coords.
  const xPx = cmToPx(pos.x, zoom);
  const yPx = cmToPx(-pos.y, zoom);
  const wPx = cmToPx(size.x, zoom);
  const hPx = cmToPx(size.y, zoom);
  const strokeWidthPx = cmToPx(strokeWidthCm, zoom);
  // The LS shader keeps the stroke inside the shape bounds, so shrink the
  // ellipse radii by half the stroke width (SVG centers the stroke).
  const inset = strokeWidthPx / 2;
  const rx = Math.max(0, wPx / 2 - inset);
  const ry = Math.max(0, hPx / 2 - inset);

  const transform = `translate(${xPx} ${yPx}) rotate(${-rotation})`;

  return (
    <g
      transform={transform}
      opacity={opacity}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ cursor: 'move' }}
    >
      <ellipse
        cx={0}
        cy={0}
        rx={rx}
        ry={ry}
        fill={rgbaToCss(fill)}
        stroke={strokeWidthPx > 0 ? rgbaToCss(stroke) : 'none'}
        strokeWidth={strokeWidthPx}
      />
      {selected && (
        <rect
          x={-wPx / 2 - 4}
          y={-hPx / 2 - 4}
          width={wPx + 8}
          height={hPx + 8}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

function PolygonView({
  node,
  selected,
  zoom,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: NodeViewProps) {
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const size = readVec2(node.properties['size'], { x: 8, y: 8 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const opacity = readNumber(node.properties['opacity'], 100) / 100;
  const fill = readRgba(node.properties['fillColor']);
  const stroke = readRgba(node.properties['strokeColor']);
  const strokeWidthCm = readNumber(node.properties['strokeWidth'], 0);
  const sides = Math.max(3, Math.round(readNumber(node.properties['sides'], 6)));

  const xPx = cmToPx(pos.x, zoom);
  const yPx = cmToPx(-pos.y, zoom);
  const wPx = cmToPx(size.x, zoom);
  const hPx = cmToPx(size.y, zoom);
  const strokeWidthPx = cmToPx(strokeWidthCm, zoom);
  // LS shader keeps the stroke inside the bounds; inset half the width so the
  // SVG (centered stroke) matches.
  const inset = strokeWidthPx / 2;
  const rx = Math.max(0, wPx / 2 - inset);
  const ry = Math.max(0, hPx / 2 - inset);

  // Regular N-gon vertices, pointy-top (first vertex at the top), fitting the
  // W×H box. The LS polygon shader is authored to match this orientation.
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push(`${(rx * Math.cos(a)).toFixed(2)},${(ry * Math.sin(a)).toFixed(2)}`);
  }
  const transform = `translate(${xPx} ${yPx}) rotate(${-rotation})`;

  return (
    <g
      transform={transform}
      opacity={opacity}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ cursor: 'move' }}
    >
      <polygon
        points={pts.join(' ')}
        fill={rgbaToCss(fill)}
        stroke={strokeWidthPx > 0 ? rgbaToCss(stroke) : 'none'}
        strokeWidth={strokeWidthPx}
        strokeLinejoin="round"
      />
      {selected && (
        <rect
          x={-wPx / 2 - 4}
          y={-hPx / 2 - 4}
          width={wPx + 8}
          height={hPx + 8}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/** Build a rounded-rect SVG path with independent corner radii, centered at origin. */
function roundedRectPath(
  w: number, h: number, tl: number, tr: number, br: number, bl: number,
): string {
  const L = -w / 2, R = w / 2, T = -h / 2, B = h / 2;
  const maxR = Math.min(w, h) / 2;
  const a = Math.min(tl, maxR), b = Math.min(tr, maxR);
  const c = Math.min(br, maxR), d = Math.min(bl, maxR);
  return [
    `M ${L + a} ${T}`,
    `L ${R - b} ${T}`,
    b > 0 ? `A ${b} ${b} 0 0 1 ${R} ${T + b}` : `L ${R} ${T}`,
    `L ${R} ${B - c}`,
    c > 0 ? `A ${c} ${c} 0 0 1 ${R - c} ${B}` : `L ${R} ${B}`,
    `L ${L + d} ${B}`,
    d > 0 ? `A ${d} ${d} 0 0 1 ${L} ${B - d}` : `L ${L} ${B}`,
    `L ${L} ${T + a}`,
    a > 0 ? `A ${a} ${a} 0 0 1 ${L + a} ${T}` : `L ${L} ${T}`,
    'Z',
  ].join(' ');
}

/** alignment name → SVG preserveAspectRatio align token. */
const SVG_ALIGN: Record<string, string> = {
  'top-left': 'xMinYMin', 'top-center': 'xMidYMin', 'top-right': 'xMaxYMin',
  'center-left': 'xMinYMid', center: 'xMidYMid', 'center-right': 'xMaxYMid',
  'bottom-left': 'xMinYMax', 'bottom-center': 'xMidYMax', 'bottom-right': 'xMaxYMax',
};

function ImageNodeView({
  node,
  selected,
  zoom,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: NodeViewProps) {
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const size = readVec2(node.properties['size'], { x: 16, y: 12 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const opacity = readNumber(node.properties['opacity'], 100) / 100;
  const stroke = readRgba(node.properties['strokeColor']);
  const strokeWidthCm = readNumber(node.properties['strokeWidth'], 0);
  const src = typeof node.properties['imageSource'] === 'string'
    ? (node.properties['imageSource'] as string)
    : '';
  const fit = typeof node.properties['fitMode'] === 'string' ? node.properties['fitMode'] : 'fill';
  const alignName = typeof node.properties['alignment'] === 'string'
    ? (node.properties['alignment'] as string)
    : 'center';

  const xPx = cmToPx(pos.x, zoom);
  const yPx = cmToPx(-pos.y, zoom);
  const wPx = cmToPx(size.x, zoom);
  const hPx = cmToPx(size.y, zoom);
  const strokeWidthPx = cmToPx(strokeWidthCm, zoom);
  const inset = strokeWidthPx / 2;
  const innerW = Math.max(0, wPx - strokeWidthPx);
  const innerH = Math.max(0, hPx - strokeWidthPx);
  const path = roundedRectPath(
    innerW, innerH,
    cmToPx(readNumber(node.properties['cornerTL'], 0), zoom),
    cmToPx(readNumber(node.properties['cornerTR'], 0), zoom),
    cmToPx(readNumber(node.properties['cornerBR'], 0), zoom),
    cmToPx(readNumber(node.properties['cornerBL'], 0), zoom),
  );

  const par = fit === 'stretch'
    ? 'none'
    : `${SVG_ALIGN[alignName] ?? 'xMidYMid'} ${fit === 'fit' ? 'meet' : 'slice'}`;
  const clipId = `imgclip-${node.id}`;
  const transform = `translate(${xPx} ${yPx}) rotate(${-rotation})`;

  return (
    <g
      transform={transform}
      opacity={opacity}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ cursor: 'move' }}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={path} />
        </clipPath>
      </defs>
      {src ? (
        // Blink doesn't repaint an <image> when only `preserveAspectRatio`
        // changes (the attribute updates but the raster keeps its old crop
        // until the window repaints). Keying by `par` remounts the element so
        // the new fit/alignment paints immediately. See Phase 1.5-I notes.
        <image
          key={par}
          href={bridgeImageUrl(src)}
          x={-innerW / 2}
          y={-innerH / 2}
          width={innerW}
          height={innerH}
          preserveAspectRatio={par}
          clipPath={`url(#${clipId})`}
        />
      ) : (
        <path d={path} fill="var(--bg-4)" stroke="var(--border-subtle)" strokeDasharray="4 3" />
      )}
      {strokeWidthPx > 0 && (
        <path d={path} fill="none" stroke={rgbaToCss(stroke)} strokeWidth={strokeWidthPx} />
      )}
      {selected && (
        <rect
          x={-wPx / 2 - 4}
          y={-hPx / 2 - 4}
          width={wPx + 8}
          height={hPx + 8}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

// cm → SVG font-size (em) px at zoom 1. Calibrated on-device (2026-05-24)
// by frame-diffing the LS preview (empty vs shapes, which cancels the AR
// room background): a 20 cm reference rect measured 220 px (11 px/cm) and
// "Designer" at fontSize 2 cm measured 102 px = 9.27 cm in LS. The designer
// renders that word at 0.9214 × E cm; solving 0.9214·E = 9.27 → E ≈ 10.1.
// Same font both sides, so this single em scale matches width and height.
const FONT_EM_PER_CM = 10.1;

/** Lazily-created offscreen canvas for text measurement (matches LS wrap). */
let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function measureWidth(s: string, cssFont: string, letterSpacingPx: number): number {
  const ctx = getMeasureCtx();
  if (!ctx) return s.length * 8; // SSR / no-canvas fallback
  ctx.font = cssFont;
  // letterSpacing is supported in modern Chromium; ignored elsewhere.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${letterSpacingPx}px`;
  return ctx.measureText(s).width;
}

/** Truncate/ellipsis a single line to fit `maxW`, from front or back. */
function clipLine(line: string, maxW: number, cssFont: string, ls: number, ellipsis: boolean, front: boolean): string {
  if (measureWidth(line, cssFont, ls) <= maxW) return line;
  const mark = ellipsis ? '…' : '';
  let lo = 0;
  let hi = line.length;
  // Binary-search the longest kept substring that fits with the mark.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = front ? mark + line.slice(line.length - mid) : line.slice(0, mid) + mark;
    if (measureWidth(candidate, cssFont, ls) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return front ? mark + line.slice(line.length - lo) : line.slice(0, lo) + mark;
}

/** Word-wrap a line to `maxW` (falls back to char-wrap for long words). */
function wrapLine(line: string, maxW: number, cssFont: string, ls: number): string[] {
  if (line === '' || measureWidth(line, cssFont, ls) <= maxW) return [line];
  const out: string[] = [];
  const words = line.split(/(\s+)/); // keep whitespace tokens
  let cur = '';
  for (const tok of words) {
    const next = cur + tok;
    if (measureWidth(next, cssFont, ls) <= maxW || cur === '') {
      cur = next;
    } else {
      out.push(cur.trimEnd());
      cur = tok.trimStart();
    }
    // Hard-break a single token longer than the box.
    while (measureWidth(cur, cssFont, ls) > maxW && cur.length > 1) {
      let lo = 1;
      let hi = cur.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measureWidth(cur.slice(0, mid), cssFont, ls) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out.push(cur.slice(0, lo));
      cur = cur.slice(lo);
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/**
 * Lay text out within the box, mirroring LS horizontal/vertical overflow.
 * Returns the lines to render plus a possibly-reduced font px (Shrink).
 */
function layoutText(
  text: string,
  hOverflow: string,
  vOverflow: string,
  boxWpx: number,
  boxHpx: number,
  fontPx: number,
  cssFamily: string,
  lineSpacing: number,
  letterSpacingPx: number,
): { lines: string[]; fontPx: number } {
  const rawLines = text.split('\n');
  const cssFont = `${fontPx}px ${cssFamily}`;
  let lines: string[];
  switch (hOverflow) {
    case 'Wrap':
      lines = rawLines.flatMap((l) => wrapLine(l, boxWpx, cssFont, letterSpacingPx));
      break;
    case 'Truncate':
      lines = rawLines.map((l) => clipLine(l, boxWpx, cssFont, letterSpacingPx, false, false));
      break;
    case 'TruncateFront':
      lines = rawLines.map((l) => clipLine(l, boxWpx, cssFont, letterSpacingPx, false, true));
      break;
    case 'Ellipsis':
      lines = rawLines.map((l) => clipLine(l, boxWpx, cssFont, letterSpacingPx, true, false));
      break;
    case 'EllipsisFront':
      lines = rawLines.map((l) => clipLine(l, boxWpx, cssFont, letterSpacingPx, true, true));
      break;
    default: // Overflow, Shrink (handled below)
      lines = rawLines;
  }

  let outFont = fontPx;
  // Shrink (h): scale font down so the widest line fits the box width.
  if (hOverflow === 'Shrink') {
    const widest = Math.max(1, ...lines.map((l) => measureWidth(l, cssFont, letterSpacingPx)));
    if (widest > boxWpx) outFont = fontPx * (boxWpx / widest);
  }

  const lineAdvance = outFont * 1.2 * lineSpacing;
  const maxLines = Math.max(1, Math.floor((boxHpx + lineAdvance - outFont) / lineAdvance));
  if (vOverflow === 'Truncate' && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
  } else if (vOverflow === 'Shrink' && lines.length > maxLines) {
    outFont = outFont * (maxLines / lines.length);
  }
  return { lines, fontPx: outFont };
}

function TextView({
  node,
  selected,
  zoom,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: NodeViewProps) {
  const customFonts = useDesignStore((s) => s.customFonts);
  const pos = readVec2(node.properties['position'], { x: 0, y: 0 });
  const box = readVec2(node.properties['size'], { x: 20, y: 4 });
  const rotation = readNumber(node.properties['rotation'], 0);
  const opacity = readNumber(node.properties['opacity'], 100) / 100;
  const fontSizeCm = readNumber(node.properties['fontSize'], 1);
  const text = typeof node.properties['text'] === 'string' ? node.properties['text'] : 'Text';
  const font = typeof node.properties['font'] === 'string' ? node.properties['font'] : 'LibreBaskerville';
  const color = readRgba(node.properties['fillColor']);
  const hAlign = typeof node.properties['horizontalAlignment'] === 'string' ? node.properties['horizontalAlignment'] : 'center';
  const vAlign = typeof node.properties['verticalAlignment'] === 'string' ? node.properties['verticalAlignment'] : 'middle';
  const lineSpacing = readNumber(node.properties['lineSpacing'], 1);
  const letterSpacingCm = readNumber(node.properties['letterSpacing'], 0);
  const outlineOn = node.properties['outlineEnabled'] === true;
  const outlineColor = readRgba(node.properties['outlineColor']);
  const outlineSize = readNumber(node.properties['outlineSize'], 0.25);
  const hOverflow = typeof node.properties['horizontalOverflow'] === 'string' ? node.properties['horizontalOverflow'] : 'Overflow';
  const vOverflow = typeof node.properties['verticalOverflow'] === 'string' ? node.properties['verticalOverflow'] : 'Overflow';

  const xPx = cmToPx(pos.x, zoom);
  const yPx = cmToPx(-pos.y, zoom);
  const wPx = cmToPx(box.x, zoom);
  const hPx = cmToPx(box.y, zoom);
  const baseFontPx = fontSizeCm * FONT_EM_PER_CM * zoom;
  const letterSpacingPx = cmToPx(letterSpacingCm, zoom);
  // Built-in fonts resolve via FONT_FAMILIES; uploaded fonts (font = sandbox
  // path) resolve to their registered FontFace family from the store.
  const custom = customFonts.find((f) => f.path === font);
  const cssFamily = custom
    ? `"${custom.family}", "Libre Baskerville", Georgia, serif`
    : FONT_FAMILIES[font] ?? '"Libre Baskerville", Georgia, serif';

  // Lay out within the box per LS overflow modes (wrap/truncate/ellipsis/shrink).
  const laid = layoutText(text, hOverflow, vOverflow, wPx, hPx, baseFontPx, cssFamily, lineSpacing, letterSpacingPx);
  const lines = laid.lines;
  const fontPx = laid.fontPx;
  const lineAdvance = fontPx * 1.2 * lineSpacing;
  const ascent = fontPx * 0.8;

  // Box edges in local SVG coords (y down). Design y-up box top maps to -hPx/2.
  const L = -wPx / 2;
  const R = wPx / 2;
  const T = -hPx / 2;
  const B = hPx / 2;

  // h-align pins to a box edge; v-align positions the line block in the box.
  const blockH = (lines.length - 1) * lineAdvance + fontPx;
  const anchorX = hAlign === 'left' ? L : hAlign === 'right' ? R : 0;
  const textAnchor = hAlign === 'left' ? 'start' : hAlign === 'right' ? 'end' : 'middle';
  const blockTopY = vAlign === 'top' ? T : vAlign === 'bottom' ? B - blockH : -blockH / 2;

  // Overflow lets text spill (like LS); any other mode clips — but PER AXIS:
  // a horizontal mode must not clip vertically and vice-versa. Leave the
  // non-clipped axis effectively unbounded.
  const clipX = hOverflow !== 'Overflow';
  const clipY = vOverflow !== 'Overflow';
  const clip = clipX || clipY;
  const clipId = `txtclip-${node.id}`;
  const BIG = 1e5;
  const clipBox = {
    x: clipX ? L : -BIG,
    y: clipY ? T : -BIG,
    w: clipX ? wPx : 2 * BIG,
    h: clipY ? hPx : 2 * BIG,
  };

  const transform = `translate(${xPx} ${yPx}) rotate(${-rotation})`;

  return (
    <g
      transform={transform}
      opacity={opacity}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ cursor: 'move' }}
    >
      {clip && (
        <defs>
          <clipPath id={clipId}>
            <rect x={clipBox.x} y={clipBox.y} width={clipBox.w} height={clipBox.h} />
          </clipPath>
        </defs>
      )}
      {/* Layout box (LS worldSpaceRect) — only shown while selected so it
          doesn't clutter the canvas; hidden when unselected. */}
      {selected && (
        <rect
          x={L}
          y={T}
          width={wPx}
          height={hPx}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
          pointerEvents="none"
        />
      )}
      <text
        fontFamily={cssFamily}
        fontSize={fontPx}
        textAnchor={textAnchor}
        fill={rgbaToCss(color)}
        stroke={outlineOn ? rgbaToCss(outlineColor) : undefined}
        strokeWidth={outlineOn ? outlineSize * fontPx : undefined}
        paintOrder="stroke"
        strokeLinejoin="round"
        clipPath={clip ? `url(#${clipId})` : undefined}
        style={letterSpacingPx ? { letterSpacing: `${letterSpacingPx}px` } : undefined}
      >
        {lines.map((ln, i) => (
          <tspan key={i} x={anchorX} y={blockTopY + ascent + i * lineAdvance}>
            {ln === '' ? '​' : ln}
          </tspan>
        ))}
      </text>
      {selected && (
        <rect
          x={L}
          y={T}
          width={wPx}
          height={hPx}
          fill="none"
          stroke="var(--accent-400)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}


/**
 * Rendered ON TOP of the canvas section (not in place of it) when no
 * view is selected. Keeps the canvas's ResizeObserver target stable
 * across the no-view → view-selected transition — see comment at the
 * call site.
 */
function NoViewOverlay({ connected, hasAnyViews }: { connected: boolean; hasAnyViews: boolean }) {
  const requestNewView = useDesignStore((s) => s.requestNewView);
  const body = hasAnyViews
    ? 'Pick a view from the left to keep editing, or create a new one to start fresh.'
    : 'Views are the unit of work in Lens Designer. Each view becomes a prefab + controller class in your Lens Studio project. Create one to start placing primitives.';
  const ctaLabel = hasAnyViews ? 'New view' : 'Create your first view';
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      // Block pointer events on the SVG underneath so the user can't
      // accidentally interact with stale state. Backdrop dims the
      // checker pattern.
      style={{ background: 'rgba(8, 12, 22, 0.55)' }}
    >
      <div className="max-w-sm text-center px-6 py-8 rounded-lg bg-bg-2/95 border border-border-subtle shadow-xl backdrop-blur-sm">
        <h2 className="m-0 mb-2 text-base font-semibold text-text-primary">
          {hasAnyViews ? 'Select a view to edit' : 'No view selected'}
        </h2>
        <p className="m-0 mb-5 text-[13px] text-text-secondary leading-relaxed">
          {body}
        </p>
        <button
          type="button"
          onClick={requestNewView}
          disabled={!connected}
          title={connected ? ctaLabel : 'Connect to a project first'}
          className="px-4 py-2 text-[13px] text-text-inverse font-semibold bg-accent-500 hover:bg-accent-400 disabled:bg-bg-3 disabled:text-text-tertiary disabled:cursor-not-allowed rounded-md shadow-sm"
        >
          {ctaLabel}
        </button>
        {!connected && (
          <p className="m-0 mt-3 text-[11px] text-text-tertiary">
            Open or attach to a Lens Studio project to enable this.
          </p>
        )}
      </div>
    </div>
  );
}
