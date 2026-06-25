'use client';

import { Eye, RefreshCw, Loader2 } from 'lucide-react';
import { usePreview } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { getLd } from '@/lib/v2/native';
import { Pill } from '../ui/Primitives';

/** The design canvas IS the live, front-on Lens Studio render — so it's exactly
 *  1:1 with what LS produces. Elements are selected + manipulated via the Layers
 *  tree (drag to reorder, drop a component to add) and the inspector; every edit
 *  re-renders here. (UIKit's runtime doesn't expose per-element screen rects, so
 *  the tree is the manipulation surface rather than click-drag on the bitmap.) */
export function DesignerCanvas() {
  const { image, capturing, capture } = usePreview();
  const selected = useUiStore((s) => s.selectedElement);
  const isElectron = getLd() !== null;

  if (!isElectron) {
    return (
      <div className="relative flex-1 min-h-0 canvas-dots overflow-hidden flex items-center justify-center text-text-tertiary text-sm">
        Open in the desktop app to edit live.
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 canvas-dots overflow-hidden">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <Pill tone="accent">
          <Eye className="w-3 h-3" /> Live design · 1:1
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

      <div className="absolute inset-0 flex items-center justify-center p-12">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt="Live Lens Studio design"
            className="max-w-full max-h-full object-contain rounded-lg shadow-lg animate-fade-in"
            style={{ boxShadow: '0 24px 80px -24px rgba(34,211,238,0.25)' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-text-tertiary">
            {capturing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                <span className="text-sm">Rendering…</span>
              </>
            ) : (
              <span className="text-sm text-center max-w-[220px]">
                Select a view in the Layers panel — its live render appears here.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 h-7 px-3 flex items-center justify-between glass border-t border-subtle">
        <span className="font-num text-2xs text-text-tertiary">30 × 34 cm panel · live from Lens Studio</span>
        <span className="flex items-center gap-1.5 text-2xs text-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          synced
        </span>
      </div>
    </div>
  );
}
