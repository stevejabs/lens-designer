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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { cn } from '@/lib/v2/cn';
import { MOCK_VIEWS } from '@/lib/v2/mock-data';
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

  return (
    <div className="flex flex-col w-[220px] shrink-0 border-r border-subtle bg-bg-0">
      {/* Views */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-text-primary">Views</h1>
        <button className="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors" title="New view">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="px-2 py-2 space-y-0.5">
        {MOCK_VIEWS.map((v) => {
          const active = v.id === selectedViewId;
          return (
            <button
              key={v.id}
              onClick={() => selectView(v.id)}
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
      </div>

      {/* Palette */}
      <div className="px-4 pt-3 pb-2">
        <SectionLabel>Components</SectionLabel>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
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
