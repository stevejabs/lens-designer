'use client';

import { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Maximize2,
  Download,
  MoreHorizontal,
  Box,
} from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import type { AssetItem } from '@/lib/v2/types';
import { Button, Pill, SectionLabel } from '../ui/Primitives';

/* A stylized 3D stage stand-in: gridded floor, soft glow, slowly spinning
   wireframe solid. Real GLB rendering (three.js) drops in here later. */
function MeshStage({ asset }: { asset: AssetItem }) {
  return (
    <div className="relative flex items-center justify-center flex-1 rounded-xl overflow-hidden bg-bg-canvas border border-subtle">
      {/* floor grid */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(var(--border-default) 1px, transparent 1px), linear-gradient(90deg, var(--border-default) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'linear-gradient(to top, black, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
          transform: 'perspective(420px) rotateX(60deg)',
          transformOrigin: 'bottom',
        }}
      />
      {/* glow */}
      <div className="absolute w-48 h-48 rounded-full blur-3xl opacity-30 accent-bg" />
      {/* spinning solid */}
      <div className="relative" style={{ animation: 'spin-slow 14s linear infinite' }}>
        <Box className="w-24 h-24 text-accent-300" strokeWidth={1} />
      </div>

      <div className="absolute top-3 left-3">
        <Pill tone="accent">
          <Box className="w-3 h-3" /> GLB
        </Pill>
      </div>
      <div className="absolute top-3 right-3 flex gap-1.5">
        <button className="flex items-center justify-center w-7 h-7 rounded-md glass border border-subtle text-text-tertiary hover:text-text-primary transition-colors" title="Reset view">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button className="flex items-center justify-center w-7 h-7 rounded-md glass border border-subtle text-text-tertiary hover:text-text-primary transition-colors" title="Fullscreen">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <span className="absolute bottom-3 left-3 font-num text-2xs text-text-tertiary">
        orbit · scroll to zoom
      </span>
    </div>
  );
}

/* Static waveform bars + transport. Real WebAudio analysis replaces the bars. */
function AudioStage({ asset }: { asset: AssetItem }) {
  const [playing, setPlaying] = useState(false);
  const bars = 64;
  return (
    <div className="relative flex flex-col flex-1 rounded-xl overflow-hidden bg-bg-canvas border border-subtle">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="flex items-end gap-[3px] h-28 w-full max-w-md">
          {Array.from({ length: bars }).map((_, i) => {
            const h = 16 + Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.17)) * 84;
            const active = playing && i < bars * 0.42;
            return (
              <span
                key={i}
                className={cn('flex-1 rounded-full transition-colors', active ? 'accent-bg' : 'bg-bg-3')}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 h-12 border-t border-subtle">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="flex items-center justify-center w-9 h-9 rounded-full accent-bg text-text-inverse hover:brightness-110 transition-all"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 h-1 rounded-full bg-bg-3 overflow-hidden">
          <div className={cn('h-full accent-bg transition-all duration-500', playing ? 'w-2/5' : 'w-0')} />
        </div>
        <span className="font-num text-2xs text-text-tertiary">
          {asset.meta?.length ?? '0:00'}
        </span>
      </div>
    </div>
  );
}

export function AssetViewer({ asset }: { asset: AssetItem | null }) {
  if (!asset) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Select an asset to preview
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-3 animate-fade-in">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">{asset.name}</h2>
          <p className="text-xs text-text-tertiary capitalize">
            {asset.kind} · {asset.origin === 'prompt' ? 'AI generated' : 'imported'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" icon={<Download />}>Export</Button>
          <button className="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* stage */}
      {asset.kind === 'mesh' ? <MeshStage asset={asset} /> : <AudioStage asset={asset} />}

      {/* meta */}
      {asset.meta && (
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-1">
          {Object.entries(asset.meta).map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <span className="text-2xs uppercase tracking-wide text-text-tertiary">{k}</span>
              <span className="font-num text-xs text-text-secondary">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* re-prompt */}
      {asset.hasContext && (
        <div className="rounded-lg border border-subtle bg-bg-1 p-3">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel>Refine with a prompt</SectionLabel>
            <Pill tone="violet"><Sparkles className="w-3 h-3" /> thread saved</Pill>
          </div>
          {asset.prompt && (
            <p className="text-xs text-text-tertiary mb-2 italic">“{asset.prompt}”</p>
          )}
          <div className="flex items-center gap-2">
            <input
              placeholder="e.g. make it smaller and add a lock"
              className="flex-1 h-9 px-3 rounded-md bg-bg-2 border border-default text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-strong"
            />
            <Button variant="primary" size="md" icon={<Sparkles />}>Refine</Button>
          </div>
        </div>
      )}
    </div>
  );
}
