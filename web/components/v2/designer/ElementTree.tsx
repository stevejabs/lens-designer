'use client';

import {
  Square,
  Layout,
  Rows,
  Columns,
  Type as TypeIcon,
  Image as ImageIcon,
  ToggleRight,
  SlidersHorizontal,
  CircleDot,
  Box,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useElementTree } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { deriveType } from '@/lib/v2/uikit/catalog';
import type { LDElementNode } from '@/lib/v2/native';
import { cn } from '@/lib/v2/cn';

const TYPE_ICON: Record<string, LucideIcon> = {
  Frame: Square,
  BackPlate: Square,
  FlexLayout: Layout,
  GridLayout: Columns,
  FlexItem: Rows,
  Text: TypeIcon,
  Image: ImageIcon,
  Button: CircleDot,
  Switch: ToggleRight,
  Toggle: ToggleRight,
  Slider: SlidersHorizontal,
  ProgressBar: SlidersHorizontal,
  RoundedRectangle: Box,
};

function Node({ node, depth }: { node: LDElementNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const selected = useUiStore((s) => s.selectedElement);
  const setSelectedElement = useUiStore((s) => s.setSelectedElement);
  const type = deriveType(node.componentTypes);
  const Icon = (type && TYPE_ICON[type]) || Box;
  const isSel = selected?.id === node.id;
  const hasKids = node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => setSelectedElement({ id: node.id, name: node.name, type })}
        style={{ paddingLeft: depth * 12 + 4 }}
        className={cn(
          'group flex items-center gap-1.5 h-7 pr-2 rounded-md cursor-pointer transition-colors',
          isSel ? 'bg-bg-3 text-text-primary' : 'text-text-secondary hover:bg-bg-2 hover:text-text-primary',
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) setOpen((o) => !o);
          }}
          className={cn('flex items-center justify-center w-4 h-4 shrink-0', !hasKids && 'invisible')}
        >
          <ChevronRight className={cn('w-3 h-3 text-text-tertiary transition-transform', open && 'rotate-90')} />
        </button>
        <Icon className={cn('w-3.5 h-3.5 shrink-0', isSel ? 'text-accent-400' : 'text-text-tertiary')} />
        <span className="flex-1 min-w-0 truncate text-xs">{node.name}</span>
        {type && (
          <span className="text-2xs text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
            {type}
          </span>
        )}
      </div>
      {hasKids && open && node.children.map((c) => <Node key={c.id} node={c} depth={depth + 1} />)}
    </div>
  );
}

/** Live element tree of the loaded view — select any element to inspect it. */
export function ElementTree() {
  const { tree, ok, reason, loading } = useElementTree();

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 h-8 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Layers</span>
        {loading && <span className="text-2xs text-text-tertiary">·</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {ok && tree ? (
          <Node node={tree} depth={0} />
        ) : (
          <p className="px-2 py-2 text-2xs text-text-tertiary leading-relaxed">
            {reason === 'no-runtime-view'
              ? 'Select a view to load it, then its elements appear here.'
              : 'No elements yet. Load a view in Design mode.'}
          </p>
        )}
      </div>
    </div>
  );
}
