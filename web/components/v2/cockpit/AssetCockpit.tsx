'use client';

import { useState } from 'react';
import { Box, Music, AudioWaveform, Plus, Search, Sparkles, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { cn } from '@/lib/v2/cn';
import { MOCK_ASSETS } from '@/lib/v2/mock-data';
import type { AssetKind } from '@/lib/v2/types';
import { AssetCard } from './AssetCard';
import { AssetViewer } from './AssetViewer';

const NEW_OPTIONS: { kind: AssetKind; label: string; icon: LucideIcon }[] = [
  { kind: 'mesh', label: '3D Asset', icon: Box },
  { kind: 'music', label: 'Music', icon: Music },
  { kind: 'sfx', label: 'SFX', icon: AudioWaveform },
];

type Filter = 'all' | AssetKind;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mesh', label: 'Meshes' },
  { value: 'music', label: 'Music' },
  { value: 'sfx', label: 'SFX' },
];

function NewAssetMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-md accent-bg text-text-inverse text-sm font-semibold hover:brightness-110 transition-all shadow-[0_2px_12px_-2px_var(--accent-glow)]"
      >
        <Plus className="w-4 h-4" />
        New Asset
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-52 p-1.5 rounded-lg glass border border-default shadow-lg animate-scale-in origin-top-right">
            {NEW_OPTIONS.map((o) => (
              <button
                key={o.kind}
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-bg-3 transition-colors"
              >
                <o.icon className="w-4 h-4 text-accent-400" />
                <span className="flex-1 text-left">{o.label}</span>
              </button>
            ))}
            <div className="my-1 h-px bg-border-subtle" />
            <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-bg-3 transition-colors">
              <Upload className="w-4 h-4 text-text-tertiary" />
              <span className="flex-1 text-left">Import file…</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AssetCockpit() {
  const selectedId = useUiStore((s) => s.selectedAssetId);
  const selectAsset = useUiStore((s) => s.selectAsset);
  const [filter, setFilter] = useState<Filter>('all');

  const assets = MOCK_ASSETS.filter((a) => filter === 'all' || a.kind === filter);
  const selected = MOCK_ASSETS.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex flex-1 min-h-0">
      {/* Library */}
      <div className="flex flex-col w-[380px] shrink-0 border-r border-subtle bg-bg-0">
        <div className="flex items-center justify-between h-11 px-4 border-b border-subtle">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-text-primary">Assets</h1>
            <span className="text-2xs text-text-tertiary font-num">{MOCK_ASSETS.length}</span>
          </div>
          <NewAssetMenu />
        </div>

        {/* search + filters */}
        <div className="px-3 pt-3 pb-2 space-y-2.5">
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-bg-2 border border-subtle focus-within:border-default">
            <Search className="w-3.5 h-3.5 text-text-tertiary" />
            <input
              placeholder="Search assets"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'h-6 px-2.5 rounded-md text-xs font-medium transition-colors',
                  filter === f.value
                    ? 'bg-bg-3 text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* grid */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="grid grid-cols-2 gap-2">
            {assets.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                selected={a.id === selectedId}
                onClick={() => selectAsset(a.id)}
              />
            ))}
          </div>
          {assets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-bg-2 mb-3">
                <Sparkles className="w-5 h-5 text-text-tertiary" />
              </div>
              <p className="text-sm text-text-secondary">No {filter} assets yet</p>
              <p className="text-xs text-text-tertiary mt-0.5">Generate one with a prompt or import a file.</p>
            </div>
          )}
        </div>
      </div>

      {/* Viewer */}
      <AssetViewer asset={selected} />
    </div>
  );
}
