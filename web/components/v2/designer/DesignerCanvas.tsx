'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Eye, RefreshCw, Loader2 } from 'lucide-react';
import { usePreview, useViewLayout } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { useAgentStore } from '@/lib/v2/agent-store';
import { getLd, type LDElementLayout } from '@/lib/v2/native';
import { deriveType } from '@/lib/v2/uikit/catalog';
import { cn } from '@/lib/v2/cn';
import { Pill } from '../ui/Primitives';

// Elements that get an interactive box on the canvas (skip sub-parts/containers).
const BOX_TYPES = new Set(['Text', 'Switch', 'Toggle', 'Slider', 'Button', 'Image', 'ProgressBar', 'BackPlate', 'Frame']);
// Approx element size (cm) for the overlay box, by type.
const SIZE_CM: Record<string, [number, number]> = {
  Text: [14, 4],
  Switch: [5, 2.6],
  Toggle: [5, 2.6],
  Slider: [26, 2.6],
  ProgressBar: [26, 2],
  Button: [8, 3.2],
  Image: [6, 6],
  BackPlate: [30, 34],
  Frame: [30, 34],
};
const CONTAINER_TYPES = new Set(['BackPlate', 'Frame', 'FlexLayout', 'GridLayout', 'FlexItem']);

interface Box {
  el: LDElementLayout;
  type: string;
  left: number;
  top: number;
  w: number;
  h: number;
}

/** Project world positions onto the rendered image (camera at origin, looking
 *  -Z, vertical FOV `fovDeg`). Returns percentage boxes over the image. */
function project(
  els: LDElementLayout[],
  fovDeg: number,
  aspect: number,
): Box[] {
  const out: Box[] = [];
  for (const el of els) {
    const type = deriveType(el.componentTypes);
    if (!type || !BOX_TYPES.has(type)) continue;
    const d = Math.abs(el.z) || 100;
    const halfV = d * Math.tan(((fovDeg / 2) * Math.PI) / 180);
    const halfH = halfV * aspect;
    const xFrac = 0.5 + (el.x / halfH) * 0.5;
    const yFrac = 0.5 - (el.y / halfV) * 0.5;
    const [cmW, cmH] = SIZE_CM[type] ?? [6, 4];
    out.push({
      el,
      type,
      left: xFrac * 100,
      top: yFrac * 100,
      w: (cmW / (2 * halfH)) * 100,
      h: (cmH / (2 * halfV)) * 100,
    });
  }
  // Panel first (behind), then the rest.
  return out.sort((a, b) => (a.type === 'BackPlate' ? -1 : 0) - (b.type === 'BackPlate' ? -1 : 0));
}

function OverlayBox({ box, viewPath }: { box: Box; viewPath: string | null }) {
  const selected = useUiStore((s) => s.selectedElement);
  const setSelectedElement = useUiStore((s) => s.setSelectedElement);
  const addElement = useAgentStore((s) => s.addElement);
  const moveElement = useAgentStore((s) => s.moveElement);
  const [over, setOver] = useState(false);
  const isSel = selected?.id === box.el.id;
  const isPanel = box.type === 'BackPlate' || box.type === 'Frame';

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (!viewPath) return;
    const addType = e.dataTransfer.getData('ld/add');
    const moveName = e.dataTransfer.getData('ld/move');
    if (addType) {
      const container = CONTAINER_TYPES.has(box.type) ? box.el.name : box.el.parentName ?? box.el.name;
      addElement({ viewPath, containerName: container, type: addType });
    } else if (moveName && moveName !== box.el.name) {
      moveElement({ viewPath, elementName: moveName, targetName: box.el.name, position: 'before' });
    }
  };

  return (
    <div
      draggable={!isPanel}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData('ld/move', box.el.name);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedElement({ id: box.el.id, name: box.el.name, type: box.type });
      }}
      title={`${box.el.name} · ${box.type}`}
      style={{
        position: 'absolute',
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
        transform: 'translate(-50%, -50%)',
      }}
      className={cn(
        'rounded transition-colors',
        isPanel ? 'cursor-default' : 'cursor-grab hover:bg-accent-400/10',
        isSel
          ? 'outline outline-2 outline-accent-400 bg-accent-400/10'
          : over
            ? 'outline outline-2 outline-violet-400 bg-violet-400/10'
            : 'outline outline-1 outline-transparent hover:outline-accent-400/50',
      )}
    >
      {isSel && (
        <span className="absolute -top-4 left-0 text-2xs font-medium px-1 rounded accent-bg text-text-inverse whitespace-nowrap">
          {box.el.name}
        </span>
      )}
    </div>
  );
}

export function DesignerCanvas() {
  const { image, capturing, capture } = usePreview();
  const layout = useViewLayout();
  const selected = useUiStore((s) => s.selectedElement);
  const active = useUiStore((s) => s.activeArtifact);
  const viewPath = active?.kind === 'view' ? active.path : null;
  const deleteElement = useAgentStore((s) => s.deleteElement);
  const isElectron = getLd() !== null;
  const [aspect, setAspect] = useState(0.78);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && viewPath) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        deleteElement({ viewPath, elementName: selected.name });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, viewPath, deleteElement]);

  if (!isElectron) {
    return (
      <div className="relative flex-1 min-h-0 canvas-dots overflow-hidden flex items-center justify-center text-text-tertiary text-sm">
        Open in the desktop app to edit live.
      </div>
    );
  }

  const boxes = layout && image ? project(layout.elements, layout.fovDeg, aspect) : [];

  return (
    <div className="relative flex-1 min-h-0 canvas-dots overflow-hidden">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <Pill tone="accent">
          <Eye className="w-3 h-3" /> Design · 1:1
        </Pill>
        {selected && <Pill tone="violet">{selected.type ?? selected.name}</Pill>}
      </div>
      <button
        onClick={capture}
        title="Re-render"
        className="absolute top-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded-md glass border border-subtle text-text-tertiary hover:text-text-primary transition-colors"
      >
        {capturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      </button>

      <div className="absolute inset-0 flex items-center justify-center p-12" onClick={() => useUiStore.getState().setSelectedElement(null)}>
        {image ? (
          <div className="relative max-w-full max-h-full" style={{ aspectRatio: aspect, height: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt="Live Lens Studio design"
              onLoad={(e) => {
                const i = e.currentTarget;
                if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight);
              }}
              className="w-full h-full object-fill rounded-lg shadow-lg"
              style={{ boxShadow: '0 24px 80px -24px rgba(34,211,238,0.25)' }}
            />
            {/* interactive element overlays, projected onto the render */}
            <div className="absolute inset-0">
              {boxes.map((b) => (
                <OverlayBox key={b.el.id} box={b} viewPath={viewPath} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-text-tertiary">
            {capturing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                <span className="text-sm">Rendering…</span>
              </>
            ) : (
              <span className="text-sm text-center max-w-[220px]">
                Select a view in the Layers panel — its live render + editable elements appear here.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 h-7 px-3 flex items-center justify-between glass border-t border-subtle">
        <span className="font-num text-2xs text-text-tertiary">click an element · drag to reorder · drop a component to add</span>
        <span className="flex items-center gap-1.5 text-2xs text-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          live from Lens Studio
        </span>
      </div>
    </div>
  );
}
