'use client';

import { useEffect, useRef, useState } from 'react';
import { useDesignStore } from '@/lib/design-model';
import { bridgeHttpOrigin } from '@/lib/bridge-http';
import type { ClientToServerMsg, ServerToClientMsg, WindowRegion } from '@lens-designer/bridge/client';

// Reuse the shared bridge-http origin helper so the Electron app://
// host fix (see bridge-http.ts) applies here too. Old local copy
// shipped `http://${window.location.hostname}:9230` which resolved to
// `http://lens-designer:9230` under the Electron app:// protocol —
// unreachable, which is why previews never displayed.
const previewHttpOrigin = bridgeHttpOrigin;

interface PreviewProps {
  onMessage: (fn: (msg: ServerToClientMsg) => void) => () => void;
  send: (msg: ClientToServerMsg) => boolean;
  connected: boolean;
}

const SECTION_STYLE: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: 'var(--bg-1)',
  borderLeft: '1px solid var(--border-subtle)',
  overflow: 'hidden',
  minWidth: 0,
};

const HEADER_STYLE: React.CSSProperties = {
  flex: '0 0 28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 12px',
  borderBottom: '1px solid var(--border-subtle)',
};

// Centering lives in globals.css as .lens-preview-stage + .lens-preview-image
// with !important so nothing can override it.

const EMPTY_STATE_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-tertiary)',
  fontSize: 11,
  textAlign: 'center',
  padding: 16,
};

export function Preview({ onMessage, send, connected }: PreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const region = useDesignStore((s) => s.previewRegion);
  const previewDistance = useDesignStore((s) => s.previewDistance);
  const setPreviewDistance = useDesignStore((s) => s.setPreviewDistance);

  // Live preview loop on the bridge broadcasts `preview.ready` at
  // ~10fps. We just swap the <img> src each time — the URL only differs
  // in its cache-busting query param so the browser re-fetches.
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === 'preview.ready') {
        setPreviewUrl(`${previewHttpOrigin()}${msg.url}?ts=${msg.capturedAt}`);
      }
    });
  }, [onMessage]);

  return (
    <section style={SECTION_STYLE} aria-label="Preview">
      <header style={HEADER_STYLE}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Preview</span>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={!connected}
          style={{
            fontSize: 11,
            color: connected ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            background: 'none',
            border: 'none',
            cursor: connected ? 'pointer' : 'not-allowed',
            padding: 0,
          }}
        >
          Preview region
        </button>
      </header>

      <div className="lens-preview-stage">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Live preview from Lens Studio" className="lens-preview-image" />
        ) : (
          <div style={EMPTY_STATE_STYLE}>
            {connected ? 'Awaiting first preview frame…' : 'Preview unavailable — bridge not connected.'}
          </div>
        )}
      </div>

      <footer
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-1)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-tertiary)',
            flex: '0 0 auto',
          }}
        >
          Distance
        </span>
        <input
          type="range"
          min={30}
          max={150}
          step={1}
          value={previewDistance}
          disabled={!connected}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setPreviewDistance(n);
          }}
          aria-label="Distance from camera (cm) — smaller = closer = larger in preview"
          title="Drag to move the design canvas closer to or further from the Spectacles camera"
          style={{
            flex: '1 1 auto',
            accentColor: 'var(--accent-500)',
            cursor: connected ? 'pointer' : 'not-allowed',
            opacity: connected ? 1 : 0.4,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: 'SF Mono, Monaco, monospace',
            minWidth: 50,
            textAlign: 'right',
            flex: '0 0 auto',
          }}
        >
          {previewDistance} cm
        </span>
      </footer>

      {pickerOpen && (
        <RegionPicker
          region={region}
          send={send}
          onMessage={onMessage}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}

interface RegionPickerProps {
  region: WindowRegion | null;
  send: (msg: ClientToServerMsg) => boolean;
  onMessage: (fn: (msg: ServerToClientMsg) => void) => () => void;
  onClose: () => void;
}

interface Snapshot {
  url: string;
  windowWidth: number;
  windowHeight: number;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; startMouse: { x: number; y: number }; startRect: WindowRegion }
  | {
      kind: 'resize';
      handle: ResizeHandle;
      startMouse: { x: number; y: number };
      startRect: WindowRegion;
    }
  | { kind: 'draw'; startWindow: { x: number; y: number } };

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_SIZE = 40;

function RegionPicker({ region, send, onMessage, onClose }: RegionPickerProps) {
  const setPreviewRegion = useDesignStore((s) => s.setPreviewRegion);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WindowRegion | null>(region);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode>({ kind: 'none' });
  const requestedRef = useRef(false);

  // Request a full-window snapshot once on open.
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    send({ type: 'preview.capture-full' });
  }, [send]);

  // Listen for the snapshot reply and error fallback.
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === 'preview.full-snapshot') {
        setSnapshot({
          url: `${previewHttpOrigin()}${msg.url}?ts=${msg.capturedAt}`,
          windowWidth: msg.windowWidth,
          windowHeight: msg.windowHeight,
        });
        // Seed the draft if we don't already have one (no prior region).
        setDraft((cur) => {
          if (cur) return cur;
          // Default: roughly the Spectacles preview area inside a typical
          // LS window — same heuristic as the legacy numeric default.
          const w = Math.round(msg.windowWidth * 0.25);
          const h = Math.round(msg.windowHeight * 0.75);
          return {
            x: Math.round(msg.windowWidth * 0.75) - w,
            y: Math.round(msg.windowHeight * 0.05),
            width: w,
            height: h,
          };
        });
      } else if (msg.type === 'design.error' && /capture-full/.test(msg.error.lsError)) {
        setError(msg.error.lsError);
      }
    });
  }, [onMessage]);

  // Global pointer move/up while dragging.
  useEffect(() => {
    function move(e: PointerEvent) {
      const mode = dragRef.current;
      if (mode.kind === 'none' || !snapshot) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const scale = rect.width / snapshot.windowWidth;
      if (mode.kind === 'move') {
        const dxW = (e.clientX - mode.startMouse.x) / scale;
        const dyW = (e.clientY - mode.startMouse.y) / scale;
        const next: WindowRegion = {
          x: clamp(mode.startRect.x + dxW, 0, snapshot.windowWidth - mode.startRect.width),
          y: clamp(mode.startRect.y + dyW, 0, snapshot.windowHeight - mode.startRect.height),
          width: mode.startRect.width,
          height: mode.startRect.height,
        };
        setDraft(roundRect(next));
      } else if (mode.kind === 'resize') {
        const dxW = (e.clientX - mode.startMouse.x) / scale;
        const dyW = (e.clientY - mode.startMouse.y) / scale;
        setDraft(roundRect(resize(mode.startRect, mode.handle, dxW, dyW, snapshot)));
      } else if (mode.kind === 'draw') {
        const mouseW = clientToWindow(e.clientX, e.clientY, rect, snapshot);
        const x = Math.min(mode.startWindow.x, mouseW.x);
        const y = Math.min(mode.startWindow.y, mouseW.y);
        const width = Math.max(MIN_SIZE, Math.abs(mouseW.x - mode.startWindow.x));
        const height = Math.max(MIN_SIZE, Math.abs(mouseW.y - mode.startWindow.y));
        setDraft(
          roundRect({
            x: clamp(x, 0, snapshot.windowWidth - width),
            y: clamp(y, 0, snapshot.windowHeight - height),
            width,
            height,
          }),
        );
      }
    }
    function up() {
      dragRef.current = { kind: 'none' };
      document.body.style.userSelect = '';
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [snapshot]);

  function startMove(e: React.PointerEvent) {
    if (!draft) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    dragRef.current = {
      kind: 'move',
      startMouse: { x: e.clientX, y: e.clientY },
      startRect: { ...draft },
    };
  }

  function startResize(handle: ResizeHandle) {
    return (e: React.PointerEvent) => {
      if (!draft) return;
      e.preventDefault();
      e.stopPropagation();
      document.body.style.userSelect = 'none';
      dragRef.current = {
        kind: 'resize',
        handle,
        startMouse: { x: e.clientX, y: e.clientY },
        startRect: { ...draft },
      };
    };
  }

  function startDraw(e: React.PointerEvent) {
    if (!snapshot) return;
    const stage = stageRef.current;
    if (!stage) return;
    e.preventDefault();
    document.body.style.userSelect = 'none';
    const rect = stage.getBoundingClientRect();
    const startWindow = clientToWindow(e.clientX, e.clientY, rect, snapshot);
    dragRef.current = { kind: 'draw', startWindow };
    setDraft({ x: startWindow.x, y: startWindow.y, width: MIN_SIZE, height: MIN_SIZE });
  }

  function commit() {
    if (!draft) return;
    setPreviewRegion(draft);
    // Bridge live-preview loop picks up the new region on the next tick
    // (~100ms). No need to also send `design.apply` — the loop is
    // decoupled from applies.
    send({ type: 'preview.configure-region', region: draft });
    onClose();
  }

  function updateField(key: keyof WindowRegion, value: number) {
    if (!draft || !snapshot) return;
    const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    const next = { ...draft, [key]: n };
    if (key === 'x') next.x = clamp(n, 0, snapshot.windowWidth - next.width);
    if (key === 'y') next.y = clamp(n, 0, snapshot.windowHeight - next.height);
    if (key === 'width') next.width = clamp(Math.max(MIN_SIZE, n), MIN_SIZE, snapshot.windowWidth - next.x);
    if (key === 'height') next.height = clamp(Math.max(MIN_SIZE, n), MIN_SIZE, snapshot.windowHeight - next.y);
    setDraft(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick preview region"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(2px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxWidth: '90vw',
          maxHeight: '90vh',
          minWidth: 480,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
              Pick preview region
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
              Drag the rectangle, resize from any edge, or click-drag on the snapshot to draw a new one.
            </p>
          </div>
          {snapshot && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                fontFamily: 'SF Mono, Monaco, monospace',
              }}
            >
              LS window {snapshot.windowWidth}×{snapshot.windowHeight}
            </span>
          )}
        </div>

        {error ? (
          <div
            style={{
              padding: 12,
              background: 'rgba(248, 113, 113, 0.08)',
              border: '1px solid var(--danger)',
              borderRadius: 6,
              color: 'var(--danger)',
              fontSize: 12,
              fontFamily: 'SF Mono, Monaco, monospace',
              maxWidth: 560,
            }}
          >
            {error}
          </div>
        ) : !snapshot ? (
          <div
            style={{
              minWidth: 480,
              minHeight: 320,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 12,
            }}
          >
            Capturing Lens Studio window…
          </div>
        ) : (
          <PickerStage
            snapshot={snapshot}
            draft={draft}
            stageRef={stageRef}
            onPointerDownEmpty={startDraw}
            onMoveStart={startMove}
            onResizeStart={startResize}
          />
        )}

        {snapshot && draft && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
            }}
          >
            {(['x', 'y', 'width', 'height'] as Array<keyof WindowRegion>).map((key) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {key}
                </span>
                <input
                  type="number"
                  value={draft[key]}
                  onChange={(e) => updateField(key, Number(e.target.value))}
                  style={{
                    background: 'var(--bg-4)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    fontFamily: 'SF Mono, Monaco, monospace',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              color: 'var(--text-secondary)',
              background: 'none',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!draft || !snapshot}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              color: 'var(--text-inverse)',
              background: 'var(--accent-500)',
              border: 'none',
              borderRadius: 6,
              cursor: draft && snapshot ? 'pointer' : 'not-allowed',
              opacity: draft && snapshot ? 1 : 0.5,
              fontWeight: 600,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

interface PickerStageProps {
  snapshot: Snapshot;
  draft: WindowRegion | null;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onPointerDownEmpty: (e: React.PointerEvent) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (handle: ResizeHandle) => (e: React.PointerEvent) => void;
}

const STAGE_MAX_W = 1024;
const STAGE_MAX_H = 640;

function PickerStage({
  snapshot,
  draft,
  stageRef,
  onPointerDownEmpty,
  onMoveStart,
  onResizeStart,
}: PickerStageProps) {
  // Fit-contain inside (STAGE_MAX_W × STAGE_MAX_H) so the stage matches the
  // window's aspect ratio. The displayed pixel size determines the px-per-
  // window-point scale used in the drag math.
  const scale = Math.min(
    STAGE_MAX_W / snapshot.windowWidth,
    STAGE_MAX_H / snapshot.windowHeight,
    1,
  );
  const displayW = Math.round(snapshot.windowWidth * scale);
  const displayH = Math.round(snapshot.windowHeight * scale);

  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDownEmpty}
      style={{
        position: 'relative',
        width: displayW,
        height: displayH,
        background: 'var(--bg-0)',
        border: '1px solid var(--border-default)',
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'crosshair',
        userSelect: 'none',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={snapshot.url}
        alt="Lens Studio window"
        draggable={false}
        style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />
      {draft && (
        <div
          onPointerDown={onMoveStart}
          style={{
            position: 'absolute',
            left: Math.round(draft.x * scale),
            top: Math.round(draft.y * scale),
            width: Math.round(draft.width * scale),
            height: Math.round(draft.height * scale),
            border: '2px solid var(--accent-500)',
            background: 'rgba(99, 102, 241, 0.08)',
            cursor: 'move',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            boxSizing: 'border-box',
          }}
        >
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[]).map((h) => (
            <span
              key={h}
              onPointerDown={onResizeStart(h)}
              style={handleStyle(h)}
              aria-label={`Resize ${h}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- math + handle helpers ----

function handleStyle(handle: ResizeHandle): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 10,
    height: 10,
    background: 'var(--accent-500)',
    border: '1.5px solid var(--bg-0)',
    borderRadius: 2,
    boxSizing: 'border-box',
  };
  const cur: Record<ResizeHandle, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  };
  const pos: Record<ResizeHandle, React.CSSProperties> = {
    nw: { left: -6, top: -6 },
    n: { left: 'calc(50% - 5px)', top: -6 },
    ne: { right: -6, top: -6 },
    e: { right: -6, top: 'calc(50% - 5px)' },
    se: { right: -6, bottom: -6 },
    s: { left: 'calc(50% - 5px)', bottom: -6 },
    sw: { left: -6, bottom: -6 },
    w: { left: -6, top: 'calc(50% - 5px)' },
  };
  return { ...base, ...pos[handle], cursor: cur[handle] };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function roundRect(r: WindowRegion): WindowRegion {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function clientToWindow(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  snapshot: Snapshot,
): { x: number; y: number } {
  const scaleX = snapshot.windowWidth / stageRect.width;
  const scaleY = snapshot.windowHeight / stageRect.height;
  return {
    x: clamp((clientX - stageRect.left) * scaleX, 0, snapshot.windowWidth),
    y: clamp((clientY - stageRect.top) * scaleY, 0, snapshot.windowHeight),
  };
}

function resize(
  start: WindowRegion,
  handle: ResizeHandle,
  dxW: number,
  dyW: number,
  snapshot: Snapshot,
): WindowRegion {
  let { x, y, width, height } = start;
  const left = handle.includes('w');
  const right = handle.includes('e');
  const top = handle === 'n' || handle === 'nw' || handle === 'ne';
  const bottom = handle === 's' || handle === 'sw' || handle === 'se';
  if (left) {
    const nx = clamp(x + dxW, 0, x + width - MIN_SIZE);
    width = width + (x - nx);
    x = nx;
  } else if (right) {
    width = clamp(width + dxW, MIN_SIZE, snapshot.windowWidth - x);
  }
  if (top) {
    const ny = clamp(y + dyW, 0, y + height - MIN_SIZE);
    height = height + (y - ny);
    y = ny;
  } else if (bottom) {
    height = clamp(height + dyW, MIN_SIZE, snapshot.windowHeight - y);
  }
  return { x, y, width, height };
}
