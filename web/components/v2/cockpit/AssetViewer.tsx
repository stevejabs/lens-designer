'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Maximize2,
  Download,
  MoreHorizontal,
  Box,
  History,
  Code2,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { useFileUrl, useVersions, useScriptMeshPreview } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { useAgentStore } from '@/lib/v2/agent-store';
import type { AssetItem } from '@/lib/v2/types';
import { Button, Pill, SectionLabel } from '../ui/Primitives';
import { AutoTextarea } from '../ui/AutoTextarea';
import { GLBViewer } from './GLBViewer';

function relAge(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* A stylized 3D stage stand-in: gridded floor, soft glow, slowly spinning
   wireframe solid. Real GLB rendering (three.js) drops in here later. */
function MeshStage({ asset, url }: { asset: AssetItem; url: string | null }) {
  return (
    <div className="relative flex items-center justify-center flex-1 rounded-xl overflow-hidden bg-bg-canvas border border-subtle">
      {/* Real GLB render when the file is available. */}
      {url && <GLBViewer dataUrl={url} />}
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
      {/* spinning placeholder solid — only when there's no real model to show */}
      {!url && (
        <div className="relative" style={{ animation: 'spin-slow 14s linear infinite' }}>
          <Box className="w-24 h-24 text-accent-300" strokeWidth={1} />
        </div>
      )}

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

/* A code-authored mesh renders in Lens Studio (it's a script that builds
   geometry at runtime), so we isolate it in the edit bay and show the live LS
   capture rather than a three.js model. */
function ScriptMeshStage({ asset }: { asset: AssetItem }) {
  const { image, loading, render } = useScriptMeshPreview(asset.id);
  return (
    <div className="relative flex items-center justify-center flex-1 rounded-xl overflow-hidden bg-bg-canvas border border-subtle">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="Live Lens Studio preview" className="max-h-full max-w-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-text-tertiary">
          {loading ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
              <span className="text-xs">Rendering in Lens Studio…</span>
            </>
          ) : (
            <>
              <Box className="w-12 h-12" strokeWidth={1} />
              <span className="text-xs">Open to render</span>
            </>
          )}
        </div>
      )}
      <div className="absolute top-3 left-3">
        <Pill tone="accent">
          <Code2 className="w-3 h-3" /> Scripted mesh
        </Pill>
      </div>
      <button
        onClick={render}
        disabled={loading}
        title="Re-render in Lens Studio"
        className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-md glass border border-subtle text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
      </button>
      <span className="absolute bottom-3 left-3 font-num text-2xs text-text-tertiary">
        rendered live in Lens Studio
      </span>
    </div>
  );
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* Real audio transport (HTMLAudioElement) with a static waveform skin. */
function AudioStage({ asset, url }: { asset: AssetItem; url: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);
  const bars = 64;

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setError(false);
  }, [url]);

  // Don't optimistically flip the icon — let the element's real play/pause/
  // error events drive state, so a file that won't decode can't get stuck.
  const toggle = (): void => {
    const a = audioRef.current;
    if (!a || !url) return;
    if (a.paused) {
      a.play().catch(() => setError(true));
    } else {
      a.pause();
    }
  };

  return (
    <div className="relative flex flex-col flex-1 rounded-xl overflow-hidden bg-bg-canvas border border-subtle">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setError(true);
            setPlaying(false);
          }}
        />
      )}
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
          <Pill tone="danger">audio failed to decode</Pill>
        </div>
      )}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="flex items-end gap-[3px] h-28 w-full max-w-md">
          {Array.from({ length: bars }).map((_, i) => {
            const h = 16 + Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.17)) * 84;
            const frac = duration ? progress / duration : 0;
            const active = i / bars < frac;
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
          onClick={toggle}
          disabled={!url}
          className="flex items-center justify-center w-9 h-9 rounded-full accent-bg text-text-inverse hover:brightness-110 transition-all disabled:opacity-40"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 h-1 rounded-full bg-bg-3 overflow-hidden">
          <div
            className="h-full accent-bg"
            style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
          />
        </div>
        <span className="font-num text-2xs text-text-tertiary">
          {duration ? `${fmtTime(progress)} / ${fmtTime(duration)}` : (asset.meta?.length ?? '0:00')}
        </span>
      </div>
    </div>
  );
}

export function AssetViewer({ asset }: { asset: AssetItem | null }) {
  const isScriptMesh = asset?.kind === 'mesh' && asset.backend === 'script';
  // Real file bytes for GLB/audio. Scripted meshes render via LS, not bytes.
  const url = useFileUrl(asset && !isScriptMesh ? asset.id : null);
  const refineAsset = useAgentStore((s) => s.refineAsset);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);
  const { versions, restore } = useVersions(asset?.id ?? null);
  const [refinePrompt, setRefinePrompt] = useState('');

  const submitRefine = (): void => {
    const p = refinePrompt.trim();
    if (!p || !asset) return;
    // The agent run is fully wired in main (gen-prompt reuses the asset's
    // original CLAD skill + exact path, versions are snapshotted, the result
    // is reconciled to replace in place). Here we just open the thread.
    setAgentOpen(true);
    refineAsset(asset, p);
    setRefinePrompt('');
  };

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
            {isScriptMesh ? 'Scripted mesh' : asset.kind} ·{' '}
            {asset.origin === 'prompt' ? 'AI generated' : 'imported'}
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
      {asset.kind === 'mesh' ? (
        isScriptMesh ? (
          <ScriptMeshStage asset={asset} />
        ) : (
          <MeshStage asset={asset} url={url} />
        )
      ) : (
        <AudioStage asset={asset} url={url} />
      )}

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

      {/* re-prompt — routes the prompt to the agent, scoped to this asset */}
      {asset.status === 'ready' && (
        <div className="rounded-lg border border-subtle bg-bg-1 p-3">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel>Refine with a prompt</SectionLabel>
            {asset.hasContext && (
              <Pill tone="violet"><Sparkles className="w-3 h-3" /> thread saved</Pill>
            )}
          </div>
          {asset.prompt && (
            <p className="text-xs text-text-tertiary mb-2 italic">“{asset.prompt}”</p>
          )}
          <div className="flex items-end gap-2">
            <AutoTextarea
              value={refinePrompt}
              onChange={setRefinePrompt}
              onSubmit={submitRefine}
              placeholder={
                asset.kind === 'mesh'
                  ? 'e.g. make it smaller and more cartoonish'
                  : 'e.g. make it warmer and shorter'
              }
              className="flex-1 min-h-9 py-2 px-3 rounded-md bg-bg-2 border border-default text-sm text-text-primary placeholder:text-text-tertiary focus:border-strong"
            />
            <Button variant="primary" size="md" icon={<Sparkles />} onClick={submitRefine} disabled={!refinePrompt.trim()}>
              Refine
            </Button>
          </div>
        </div>
      )}

      {/* version history — every refine snapshots the prior bytes; roll back here */}
      {versions.length > 0 && (
        <div className="rounded-lg border border-subtle bg-bg-1 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <History className="w-3.5 h-3.5 text-text-tertiary" />
            <SectionLabel>Version history</SectionLabel>
            <span className="text-2xs text-text-tertiary font-num">{versions.length}</span>
          </div>
          <div className="flex flex-col gap-1">
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-bg-2 transition-colors"
              >
                <div className="flex flex-col">
                  <span className="text-xs text-text-secondary">{relAge(v.createdMs)}</span>
                  <span className="font-num text-2xs text-text-tertiary">
                    {(v.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  onClick={() => void restore(v.id)}
                  className="flex items-center gap-1 px-2 h-6 rounded-md text-2xs text-text-secondary border border-subtle hover:border-default hover:text-text-primary transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
