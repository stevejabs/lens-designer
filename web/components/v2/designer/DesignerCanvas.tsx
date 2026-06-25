'use client';

import { MousePointer2, Hand, Frame, Eye, RefreshCw, Loader2, Monitor } from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { usePreview } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { getLd } from '@/lib/v2/native';
import { Pill } from '../ui/Primitives';
import { FlatEditor } from './FlatEditor';

function Stage({
  image,
  capturing,
  alt,
  hint,
}: {
  image: string | null;
  capturing: boolean;
  alt: string;
  hint: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-10">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={alt}
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
            <>
              <Eye className="w-6 h-6" />
              <span className="text-sm text-center max-w-[200px]">{hint}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The editor surface: a flat HTML reconstruction of the loaded view (flexbox
 *  mirrors UIKit's FlexLayout) — select elements, edit them in the inspector. */
function EditorPane() {
  const selected = useUiStore((s) => s.selectedElement);
  return (
    <div className="relative flex flex-1 min-w-0 flex-col">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <Pill tone="accent">
          <MousePointer2 className="w-3 h-3" /> Editor
        </Pill>
        {selected && <Pill tone="violet">{selected.type ?? selected.name}</Pill>}
      </div>
      <FlatEditor />
      <div className="absolute bottom-0 inset-x-0 h-7 px-3 flex items-center justify-between glass border-t border-subtle">
        <span className="font-num text-2xs text-text-tertiary">30 × 34 cm panel</span>
        <span className="text-2xs text-text-tertiary">flat editor · click to select</span>
      </div>
    </div>
  );
}

/** The live Lens Studio preview — how the view looks in the running lens. */
function PreviewPane() {
  const { image, capturing, capture } = usePreview();
  return (
    <div className="relative w-[38%] min-w-[260px] shrink-0 border-l border-subtle bg-bg-canvas overflow-hidden">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <Pill tone="neutral">
          <Monitor className="w-3 h-3" /> Preview
        </Pill>
      </div>
      <button
        onClick={capture}
        title="Re-capture live preview"
        className="absolute top-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded-md glass border border-subtle text-text-tertiary hover:text-text-primary transition-colors"
      >
        {capturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      </button>
      <Stage
        image={image}
        capturing={capturing}
        alt="Live Lens Studio preview"
        hint="The live Lens Studio preview appears here."
      />
      <div className="absolute bottom-0 inset-x-0 h-7 px-3 flex items-center glass border-t border-subtle">
        <span className="flex items-center gap-1.5 text-2xs text-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          synced with Lens Studio
        </span>
      </div>
    </div>
  );
}

export function DesignerCanvas() {
  const isElectron = getLd() !== null;
  if (!isElectron) {
    // Browser/mock: keep a single stage so the static site still renders.
    return (
      <div className="relative flex-1 min-h-0 canvas-dots overflow-hidden flex items-center justify-center text-text-tertiary text-sm">
        Open in the desktop app to edit live.
      </div>
    );
  }
  return (
    <div className="flex flex-1 min-h-0">
      <EditorPane />
      <PreviewPane />
    </div>
  );
}
