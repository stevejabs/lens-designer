'use client';

import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { useElementTree } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { useAgentStore } from '@/lib/v2/agent-store';
import { getLd, type LDElementNode } from '@/lib/v2/native';
import { deriveType } from '@/lib/v2/uikit/catalog';
import { cn } from '@/lib/v2/cn';

type Props = Record<string, Record<string, unknown>>;

const CONTAINER_TYPES = new Set(['BackPlate', 'Frame', 'FlexLayout', 'GridLayout', 'FlexItem']);

function hex(v: unknown): string | undefined {
  const o = v as { r?: number; g?: number; b?: number } | null;
  if (!o || typeof o.r !== 'number') return undefined;
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round((n ?? 0) * 255))).toString(16).padStart(2, '0');
  return `#${h(o.r)}${h(o.g ?? 0)}${h(o.b ?? 0)}`;
}

/** UIKit FlexLayout is flexbox-in-3D; a row holds a label + a control. */
function isRow(node: LDElementNode): boolean {
  const kinds = node.children.map((c) => deriveType(c.componentTypes));
  return kinds.includes('Text') && kinds.some((k) => k === 'Switch' || k === 'Slider' || k === 'Toggle' || k === 'Button');
}

function Glyph({ type }: { type: string | null }) {
  if (type === 'Switch' || type === 'Toggle')
    return (
      <span className="relative inline-block w-9 h-5 rounded-full bg-white/20 shrink-0 pointer-events-none">
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white/70" />
      </span>
    );
  if (type === 'Slider')
    return (
      <span className="relative inline-block w-full h-2 rounded-full bg-white/15 pointer-events-none">
        <span className="absolute top-0 left-0 h-full w-[55%] rounded-full bg-white/40" />
        <span className="absolute top-1/2 left-[55%] -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white/80 shadow" />
      </span>
    );
  return null;
}

function ElementBox({
  node,
  props,
  parentName,
  viewPath,
}: {
  node: LDElementNode;
  props: Props;
  parentName: string | null;
  viewPath: string | null;
}) {
  const selected = useUiStore((s) => s.selectedElement);
  const setSelectedElement = useUiStore((s) => s.setSelectedElement);
  const addElement = useAgentStore((s) => s.addElement);
  const moveElement = useAgentStore((s) => s.moveElement);
  const [over, setOver] = useState(false);
  const type = deriveType(node.componentTypes);
  const p = props[node.id] ?? {};
  const isSel = selected?.id === node.id;

  const select = (e: MouseEvent): void => {
    e.stopPropagation();
    setSelectedElement({ id: node.id, name: node.name, type });
  };

  const onDragStart = (e: DragEvent): void => {
    e.stopPropagation();
    e.dataTransfer.setData('ld/move', node.name);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOver(true);
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (!viewPath) return;
    const addType = e.dataTransfer.getData('ld/add');
    const moveName = e.dataTransfer.getData('ld/move');
    if (addType) {
      // Drop into this node if it's a container, else into its parent.
      const container = type && CONTAINER_TYPES.has(type) ? node.name : parentName ?? node.name;
      addElement({ viewPath, containerName: container, type: addType });
    } else if (moveName && moveName !== node.name) {
      moveElement({ viewPath, elementName: moveName, targetName: node.name, position: 'before' });
    }
  };

  const dnd = {
    draggable: true,
    onDragStart,
    onDragOver,
    onDragLeave: () => setOver(false),
    onDrop,
    onClick: select,
  };
  const ring = cn(isSel && 'outline outline-2 outline-accent-400 outline-offset-1', over && 'outline outline-2 outline-violet-400');

  // Leaves
  if (type === 'Text') {
    const text = (p['text'] as string) ?? node.name;
    const color = hex(p['color']) ?? '#ffffff';
    const fontPx = Math.max(9, Math.min(22, ((p['size'] as number) ?? 36) / 4));
    return (
      <span {...dnd} className={cn('cursor-grab rounded px-0.5', ring)} style={{ color, fontSize: fontPx }}>
        {text}
      </span>
    );
  }
  if (type === 'Switch' || type === 'Toggle' || type === 'Slider') {
    return (
      <span {...dnd} className={cn('cursor-grab rounded inline-flex items-center', type === 'Slider' && 'flex-1', ring)}>
        <Glyph type={type} />
      </span>
    );
  }
  if (type === 'Button') {
    const text = (Object.values(props).find((x) => x['text']) ?? {})['text'];
    return (
      <span {...dnd} className={cn('cursor-grab rounded-lg px-4 py-1.5 bg-white/85 text-bg-0 text-xs font-semibold', ring)}>
        {(text as string) ?? node.name}
      </span>
    );
  }

  // Containers
  const row = isRow(node);
  const isPanel = type === 'BackPlate' || type === 'Frame';
  const childEls = node.children.filter((c) => c.name !== 'Collider');
  return (
    <div
      {...dnd}
      className={cn(
        'cursor-grab',
        isPanel ? 'rounded-2xl p-5 w-full h-full overflow-hidden' : 'rounded',
        row ? 'flex items-center justify-between gap-3' : 'flex flex-col',
        !isPanel && (row ? 'py-1.5' : 'gap-2'),
        ring,
      )}
      style={isPanel ? { background: 'linear-gradient(160deg, #2a2550 0%, #1c4a66 60%, #1d6f86 100%)' } : undefined}
    >
      {childEls.map((c) => (
        <ElementBox key={c.id} node={c} props={props} parentName={node.name} viewPath={viewPath} />
      ))}
    </div>
  );
}

/** A real flat WYSIWYG canvas: drag elements to reorder, drag components from
 *  the palette to add, Delete to remove — every op writes back to the view
 *  source (agent-routed) so the live preview updates. */
export function FlatEditor() {
  const { tree, ok, reason } = useElementTree();
  const [props, setProps] = useState<Props>({});
  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const active = useUiStore((s) => s.activeArtifact);
  const viewPath = active?.kind === 'view' ? active.path : null;
  const selected = useUiStore((s) => s.selectedElement);
  const deleteElement = useAgentStore((s) => s.deleteElement);

  const ids = useMemo(() => {
    const out: string[] = [];
    const walk = (n: LDElementNode | null): void => {
      if (!n) return;
      out.push(n.id);
      n.children.forEach(walk);
    };
    walk(tree);
    return out;
  }, [tree]);

  useEffect(() => {
    const ld = getLd();
    if (!ld || ids.length === 0) return;
    let alive = true;
    void ld.ui.propsBatch(ids).then((p) => {
      if (alive) setProps(p ?? {});
    });
    return () => {
      alive = false;
    };
  }, [ids, artifactNonce]);

  // Delete key removes the selected element.
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
    <div
      className="relative flex-1 min-w-0 canvas-dots overflow-hidden flex items-center justify-center p-8"
      onClick={() => useUiStore.getState().setSelectedElement(null)}
    >
      {ok && tree ? (
        <div className="relative shadow-2xl" style={{ width: 'min(90%, 340px)', aspectRatio: '30 / 34' }}>
          <ElementBox node={tree} props={props} parentName={null} viewPath={viewPath} />
        </div>
      ) : (
        <p className="text-sm text-text-tertiary text-center max-w-[220px]">
          {reason === 'no-runtime-view'
            ? 'Select a view in the Layers panel — it rebuilds here as a drag-and-drop canvas.'
            : 'Load a view in Design mode to edit it.'}
        </p>
      )}
    </div>
  );
}
