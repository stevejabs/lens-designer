'use client';

import {
  Square,
  RectangleHorizontal,
  Type,
  ToggleRight,
  SlidersHorizontal,
  Rows3,
  Grid3x3,
  Image,
  Plus,
  Sparkles,
  FileCode2,
  RotateCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { useAgentStore } from '@/lib/v2/agent-store';
import { getLd } from '@/lib/v2/native';
import { ElementTree } from './ElementTree';
import { cn } from '@/lib/v2/cn';
import { useViews } from '@/lib/v2/hooks';
import { SectionLabel } from '../ui/Primitives';

const PALETTE: { label: string; icon: LucideIcon }[] = [
  { label: 'Frame', icon: Square },
  { label: 'BackPlate', icon: RectangleHorizontal },
  { label: 'Flex', icon: Rows3 },
  { label: 'Grid', icon: Grid3x3 },
  { label: 'Text', icon: Type },
  { label: 'Button', icon: RectangleHorizontal },
  { label: 'Switch', icon: ToggleRight },
  { label: 'Slider', icon: SlidersHorizontal },
  { label: 'Image', icon: Image },
];

export function DesignerLeft() {
  const selectedViewId = useUiStore((s) => s.selectedViewId);
  const selectView = useUiStore((s) => s.selectView);
  const posture = useUiStore((s) => s.posture);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);
  const openCreate = useAgentStore((s) => s.openCreate);
  const setActiveArtifact = useUiStore((s) => s.setActiveArtifact);
  const { views, refresh } = useViews();

  return (
    <div className="flex flex-col w-[220px] shrink-0 border-r border-subtle bg-bg-0">
      {/* Views */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-subtle">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-text-primary">Views</h1>
          <span className="text-2xs text-text-tertiary font-num">{views.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => refresh()}
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
            title="Refresh from project"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setAgentOpen(true);
              openCreate('ui');
            }}
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
            title="New view (prompt)"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-2 py-2 space-y-0.5">
        {views.map((v) => {
          const active = v.id === selectedViewId;
          return (
            <button
              key={v.id}
              onClick={() => {
                selectView(v.id);
                setActiveArtifact({ path: v.id, id: v.id, name: v.name, kind: 'view' });
                // Load this view's content into the edit bay so the preview
                // shows what you're editing (design posture only).
                if (posture === 'designing') void getLd()?.view.load(v.id);
              }}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors text-left',
                active ? 'bg-bg-3 text-text-primary' : 'text-text-secondary hover:bg-bg-2 hover:text-text-primary',
              )}
            >
              <FileCode2 className={cn('w-4 h-4 shrink-0', active ? 'text-accent-400' : 'text-text-tertiary')} />
              <span className="flex-1 min-w-0 truncate text-sm">{v.name}</span>
              {v.origin === 'prompt' && <Sparkles className="w-3 h-3 shrink-0 text-violet-400" />}
            </button>
          );
        })}
        {views.length === 0 && (
          <p className="px-2 py-3 text-xs text-text-tertiary">
            No views yet. Use + to prompt one, or build one on the canvas.
          </p>
        )}
      </div>

      {/* Live element tree of the loaded view */}
      <div className="border-t border-subtle min-h-0 flex-1 flex flex-col">
        <ElementTree />
      </div>

      {/* Palette */}
      <div className="px-4 pt-3 pb-2 border-t border-subtle">
        <SectionLabel>Components</SectionLabel>
      </div>
      <div className="overflow-y-auto px-2 pb-3 max-h-44">
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTE.map((p) => (
            <button
              key={p.label}
              className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border border-subtle bg-bg-1 hover:bg-bg-2 hover:border-default transition-all duration-150 ease-spring group"
            >
              <p.icon className="w-4 h-4 text-text-tertiary group-hover:text-accent-400 transition-colors" strokeWidth={1.6} />
              <span className="text-2xs text-text-secondary">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
