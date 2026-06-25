'use client';

import {
  Square,
  Layout,
  Columns,
  Rows,
  Type as TypeIcon,
  Image as ImageIcon,
  ToggleRight,
  SlidersHorizontal,
  CircleDot,
  Box,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import { useElementTree } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { useAgentStore } from '@/lib/v2/agent-store';
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

const CONTAINER_TYPES = new Set(['BackPlate', 'Frame', 'FlexLayout', 'GridLayout', 'FlexItem']);

function Node({
  node,
  depth,
  parentName,
  viewPath,
}: {
  node: LDElementNode;
  depth: number;
  parentName: string | null;
  viewPath: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [over, setOver] = useState(false);
  const selected = useUiStore((s) => s.selectedElement);
  const setSelectedElement = useUiStore((s) => s.setSelectedElement);
  const addElement = useAgentStore((s) => s.addElement);
  const moveElement = useAgentStore((s) => s.moveElement);
  const type = deriveType(node.componentTypes);
  const Icon = (type && TYPE_ICON[type]) || Box;
  const isSel = selected?.id === node.id;
  const hasKids = node.children.filter((c) => c.name !== 'Collider').length > 0;

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (!viewPath) return;
    const addType = e.dataTransfer.getData('ld/add');
    const moveName = e.dataTransfer.getData('ld/move');
    if (addType) {
      const container = type && CONTAINER_TYPES.has(type) ? node.name : parentName ?? node.name;
      addElement({ viewPath, containerName: container, type: addType });
    } else if (moveName && moveName !== node.name) {
      moveElement({ viewPath, elementName: moveName, targetName: node.name, position: 'before' });
    }
  };

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData('ld/move', node.name);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => setSelectedElement({ id: node.id, name: node.name, type })}
        style={{ paddingLeft: depth * 12 + 4 }}
        className={cn(
          'group flex items-center gap-1.5 h-7 pr-2 rounded-md cursor-grab transition-colors',
          isSel ? 'bg-bg-3 text-text-primary' : 'text-text-secondary hover:bg-bg-2 hover:text-text-primary',
          over && 'outline outline-1 outline-violet-400 bg-bg-2',
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
          <span className="text-2xs text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">{type}</span>
        )}
      </div>
      {hasKids &&
        open &&
        node.children
          .filter((c) => c.name !== 'Collider')
          .map((c) => <Node key={c.id} node={c} depth={depth + 1} parentName={node.name} viewPath={viewPath} />)}
    </div>
  );
}

/** The live element tree — and the drag-and-drop manipulation surface. Drag a
 *  node onto another to reorder, drop a palette component to add it, Delete to
 *  remove. Every op edits the view source so the canvas re-renders. */
export function ElementTree() {
  const { tree, ok, reason } = useElementTree();
  const active = useUiStore((s) => s.activeArtifact);
  const viewPath = active?.kind === 'view' ? active.path : null;
  const selected = useUiStore((s) => s.selectedElement);
  const deleteElement = useAgentStore((s) => s.deleteElement);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && viewPath) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        deleteElement({ viewPath, elementName: selected.name });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, viewPath, deleteElement]);

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 h-8 shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Layers</span>
        <span className="text-2xs text-text-tertiary normal-case tracking-normal">drag to arrange</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {ok && tree ? (
          <Node node={tree} depth={0} parentName={null} viewPath={viewPath} />
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
