'use client';

import { MousePointer2, Hand, Frame, ZoomIn, Eye, Maximize, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { usePreview } from '@/lib/v2/hooks';
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
        title="Re-capture live preview"
        className="flex items-center justify-center w-8 h-8 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
      >
        {capturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      </button>
    </div>
  );
}

/* A faithful mock of the live SettingsPanel as it renders in LS preview —
   gradient BackPlate, header, two toggle rows, a slider, action buttons. */
function PanelPreview() {
  return (
    <div className="relative" style={{ animation: 'scale-in 0.3s ease-out both' }}>
      {/* selection chrome */}
      <div className="absolute -inset-3 rounded-xl border border-[rgba(34,211,238,0.5)] pointer-events-none">
        <span className="absolute -top-6 left-0 flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-2xs font-medium accent-bg text-text-inverse">BackPlate</span>
          <span className="font-num text-2xs text-text-tertiary">30 × 34 cm</span>
        </span>
        {['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map((p) => (
          <span key={p} className={cn('absolute w-2 h-2 rounded-full bg-text-primary border border-accent-500', p)} />
        ))}
      </div>

      <div
        className="w-[300px] rounded-2xl p-5 border"
        style={{
          background: 'linear-gradient(160deg, #28218f 0%, #1c6f97 60%, #26b8d9 100%)',
          borderColor: 'rgba(166,230,255,0.6)',
          boxShadow: '0 20px 60px -20px rgba(34,211,238,0.4)',
        }}
      >
        <h3 className="text-white text-lg font-bold mb-4">Settings</h3>

        {[
          { label: 'Notifications', on: true },
          { label: 'Spatial audio', on: false },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between py-2.5">
            <span className="text-white/90 text-sm font-medium">{row.label}</span>
            <span className={cn('relative w-9 h-5 rounded-full', row.on ? 'bg-white' : 'bg-white/25')}>
              <span className={cn('absolute top-0.5 w-4 h-4 rounded-full transition-all', row.on ? 'right-0.5 bg-accent-500' : 'left-0.5 bg-white')} />
            </span>
          </div>
        ))}

        <div className="py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-white/90 text-sm font-medium">Volume</span>
            <span className="text-white/60 text-xs font-num">60%</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-white/20">
            <div className="absolute h-full w-3/5 rounded-full bg-white" />
            <div className="absolute top-1/2 left-3/5 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4">
          <span className="text-white/70 text-sm px-3 py-1.5">Cancel</span>
          <span className="text-text-inverse text-sm font-semibold px-4 py-1.5 rounded-lg bg-white">Save</span>
        </div>
      </div>
    </div>
  );
}

export function DesignerCanvas() {
  const { image, capturing, capture } = usePreview();
  const isElectron = getLd() !== null;

  return (
    <div className="relative flex-1 min-h-0 canvas-dots overflow-hidden">
      <CanvasToolbar onResync={capture} capturing={capturing} />

      {/* status chips */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <Pill tone="neutral"><Eye className="w-3 h-3" /> Live preview</Pill>
        <Pill tone="accent">z = −110 cm</Pill>
      </div>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button className="flex items-center gap-1.5 h-6 px-2 rounded-md glass border border-subtle text-2xs text-text-secondary hover:text-text-primary transition-colors">
          <ZoomIn className="w-3 h-3" /> 100%
        </button>
        <button className="flex items-center justify-center w-6 h-6 rounded-md glass border border-subtle text-text-tertiary hover:text-text-primary transition-colors" title="Fit">
          <Maximize className="w-3 h-3" />
        </button>
      </div>

      {/* stage — real LS preview when connected, mock panel in the browser */}
      <div className="absolute inset-0 flex items-center justify-center p-12">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt="Live Lens Studio preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-lg animate-fade-in"
            style={{ boxShadow: '0 24px 80px -24px rgba(34,211,238,0.25)' }}
          />
        ) : isElectron ? (
          <div className="flex flex-col items-center gap-3 text-text-tertiary">
            {capturing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                <span className="text-sm">Capturing live preview…</span>
              </>
            ) : (
              <>
                <Eye className="w-6 h-6" />
                <span className="text-sm">No preview yet — open a view in Lens Studio</span>
                <button
                  onClick={capture}
                  className="text-xs px-3 h-7 rounded-md bg-bg-3 text-text-secondary hover:text-text-primary"
                >
                  Capture preview
                </button>
              </>
            )}
          </div>
        ) : (
          <PanelPreview />
        )}
      </div>

      {/* bottom status bar */}
      <div className="absolute bottom-0 inset-x-0 h-7 px-3 flex items-center justify-between glass border-t border-subtle">
        <span className="font-num text-2xs text-text-tertiary">53 × 77 cm usable · binocular overlap</span>
        <span className="flex items-center gap-1.5 text-2xs text-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          synced with Lens Studio
        </span>
      </div>
    </div>
  );
}
