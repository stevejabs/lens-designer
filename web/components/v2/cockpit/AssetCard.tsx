'use client';

import { useRef, useState, type MouseEvent } from 'react';
import {
  Box,
  Music,
  AudioWaveform,
  Loader2,
  Sparkles,
  Download,
  AlertTriangle,
  Play,
  Pause,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { useFileUrl, useInView } from '@/lib/v2/hooks';
import type { AssetItem, AssetKind } from '@/lib/v2/types';
import { GLBViewer } from './GLBViewer';

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  mesh: Box,
  music: Music,
  sfx: AudioWaveform,
};

const KIND_LABEL: Record<AssetKind, string> = {
  mesh: '3D Mesh',
  music: 'Music',
  sfx: 'SFX',
};

const gridBg = (
  <div
    className="absolute inset-0 opacity-[0.07]"
    style={{
      backgroundImage:
        'linear-gradient(var(--accent-400) 1px, transparent 1px), linear-gradient(90deg, var(--accent-400) 1px, transparent 1px)',
      backgroundSize: '14px 14px',
    }}
  />
);

/** Live rotating 3D thumbnail for a mesh card — lazily loaded once in view. */
function MeshThumb({ asset }: { asset: AssetItem }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const url = useFileUrl(inView && asset.status === 'ready' ? asset.id : null);
  return (
    <div
      ref={ref}
      className="relative flex items-center justify-center h-24 rounded-md bg-gradient-to-br from-bg-1 to-bg-2 overflow-hidden"
    >
      {gridBg}
      {url ? (
        <GLBViewer dataUrl={url} interactive={false} />
      ) : inView ? (
        <Loader2 className="relative w-5 h-5 text-text-tertiary animate-spin" />
      ) : (
        <Box className="relative w-8 h-8 text-text-secondary" strokeWidth={1.4} />
      )}
    </div>
  );
}

/** Audio card thumbnail with a centered inline play/pause button. */
function AudioThumb({ asset }: { asset: AssetItem }) {
  const Icon = KIND_ICON[asset.kind];
  const [ref, inView] = useInView<HTMLDivElement>();
  const url = useFileUrl(inView && asset.status === 'ready' ? asset.id : null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = (e: MouseEvent): void => {
    e.stopPropagation(); // don't open the asset — just play
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  };

  return (
    <div
      ref={ref}
      className="relative flex items-center justify-center h-24 rounded-md bg-gradient-to-br from-bg-1 to-bg-2 overflow-hidden"
    >
      {gridBg}
      <Icon className="relative w-8 h-8 text-text-secondary" strokeWidth={1.4} />
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <button
        onClick={toggle}
        disabled={!url}
        title={playing ? 'Pause' : 'Play'}
        className="absolute inset-0 m-auto w-9 h-9 rounded-full accent-bg text-text-inverse flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 data-[on=true]:opacity-100 transition-opacity hover:brightness-110 disabled:opacity-0"
        data-on={playing}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
    </div>
  );
}

function Thumb({ asset }: { asset: AssetItem }) {
  if (asset.status === 'generating') {
    return (
      <div className="relative flex items-center justify-center h-24 rounded-md bg-bg-1 overflow-hidden">
        <div className="absolute inset-0 shimmer opacity-40" />
        <div className="relative flex flex-col items-center gap-1.5 text-accent-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-2xs text-text-tertiary">Generating…</span>
        </div>
      </div>
    );
  }
  if (asset.status === 'failed') {
    const Icon = KIND_ICON[asset.kind];
    return (
      <div className="relative flex items-center justify-center h-24 rounded-md bg-gradient-to-br from-bg-1 to-bg-2 overflow-hidden">
        {gridBg}
        <Icon className="relative w-8 h-8 text-text-secondary" strokeWidth={1.4} />
        <span className="absolute top-1.5 right-1.5 text-danger">
          <AlertTriangle className="w-3.5 h-3.5" />
        </span>
      </div>
    );
  }
  if (asset.kind === 'mesh') return <MeshThumb asset={asset} />;
  return <AudioThumb asset={asset} />;
}

export function AssetCard({
  asset,
  selected,
  onClick,
}: {
  asset: AssetItem;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'group block text-left p-2 rounded-lg border cursor-pointer transition-all duration-150 ease-spring animate-fade-in',
        selected
          ? 'border-[rgba(34,211,238,0.4)] bg-bg-2 glow-ring'
          : 'border-subtle bg-bg-1 hover:border-default hover:bg-bg-2',
      )}
    >
      <Thumb asset={asset} />
      <div className="mt-2 px-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{asset.name}</span>
          {asset.origin === 'prompt' ? (
            <Sparkles className="w-3 h-3 shrink-0 text-accent-400" />
          ) : (
            <Download className="w-3 h-3 shrink-0 text-text-tertiary" />
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-2xs text-text-tertiary">{KIND_LABEL[asset.kind]}</span>
          <span className="text-2xs text-text-tertiary">{asset.updated}</span>
        </div>
      </div>
    </div>
  );
}
