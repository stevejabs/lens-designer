'use client';

import { MousePointer2, Hand, Frame, Eye, RefreshCw, Loader2, Monitor } from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { usePreview, useViewRender } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { getLd } from '@/lib/v2/native';
import { Pill } from '../ui/Primitives';

function CanvasToolbar({ onResync, capturing }: { onResync: () => void; capturing: boolean }) {
  const tools = [
    { icon: MousePointer2, label: 'Select', active: true },
    { icon: Hand, label: 'Pan' },
    { icon: Frame, label: 'Frame' },
  ];
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 p-1 rounded-lg glass border border-default shadow-md">
      {tools.map((t) => (
        <button
          key={t.label}
          title={t.label}
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
            t.active ? 'bg-bg-4 text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-3',
          )}
        >
          <t.icon className="w-4 h-4" />
        </button>
      ))}
      <div className="w-px h-5 mx-1 bg-border-subtle" />
      <button
        onClick={onResync}
        title="Re-render"
        className="flex items-center justify-center w-8 h-8 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
      >
        {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      </button>
    </div>
  );
}

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

/** The editor surface: the loaded view, isolated + auto-framed so it's always
 *  in view. The selected element + drag-and-drop live here. */
function EditorPane() {
  const { image, capturing, capture } = useViewRender();
  const selected = useUiStore((s) => s.selectedElement);
  return (
    <div className="relative flex-1 min-w-0 canvas-dots overflow-hidden">
      <CanvasToolbar onResync={capture} capturing={capturing} />
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <Pill tone="accent">
          <MousePointer2 className="w-3 h-3" /> Editor
        </Pill>
        {selected && <Pill tone="violet">{selected.type ?? selected.name}</Pill>}
      </div>
      <Stage
        image={image}
        capturing={capturing}
        alt="Editor — loaded view"
        hint="Select a view in the Layers panel to edit it here."
      />
      <div className="absolute bottom-0 inset-x-0 h-7 px-3 flex items-center justify-between glass border-t border-subtle">
        <span className="font-num text-2xs text-text-tertiary">53 × 77 cm usable</span>
        <span className="text-2xs text-text-tertiary">isolated view · always in frame</span>
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
