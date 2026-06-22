'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, ChevronUp, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useDesignStore, findNode } from '@/lib/design-model';
import { type DesignNode } from '@lens-designer/bridge/client';
import { NodeIcon } from './icons';

// Find a node that is a top-level Group (ungroup only operates on top-level
// groups for the MVP — see store.ungroup).
function topLevelGroup(tree: DesignNode[], id: string | undefined): DesignNode | null {
  if (!id) return null;
  const n = tree.find((t) => t.id === id);
  return n && n.type === 'Group' ? n : null;
}

export function Layers() {
  const tree = useDesignStore((s) => s.tree);
  const selectedIds = useDesignStore((s) => s.selectedIds);
  const selectNode = useDesignStore((s) => s.selectNode);
  const moveLayer = useDesignStore((s) => s.moveLayer);
  const removeNode = useDesignStore((s) => s.removeNode);
  const toggleVisibility = useDesignStore((s) => s.toggleVisibility);
  const moveNode = useDesignStore((s) => s.moveNode);
  const renameNode = useDesignStore((s) => s.renameNode);
  const group = useDesignStore((s) => s.group);
  const ungroup = useDesignStore((s) => s.ungroup);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Inline rename: which row is being edited + its in-progress text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  function beginRename(node: DesignNode) {
    setEditingId(node.id);
    setDraftName(node.name);
  }
  function commitRename() {
    if (editingId) renameNode(editingId, draftName);
    setEditingId(null);
  }

  if (tree.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        Layers will appear here as you add primitives.
      </div>
    );
  }

  const selectedGroup = selectedIds.length === 1 ? topLevelGroup(tree, selectedIds[0]) : null;

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Render one row + (for groups) its children indented. `siblings`/`parentId`
  // locate this node so a drag can reorder within a parent, reparent INTO a
  // group (drop on the group row), or move a node out (drop on a row elsewhere).
  function renderRow(node: DesignNode, depth: number, siblings: DesignNode[], parentId: string | null) {
    const isSelected = selectedIds.includes(node.id);
    const isGroup = node.type === 'Group';
    const isCollapsed = collapsed.has(node.id);
    const opacity = typeof node.properties['opacity'] === 'number' ? node.properties['opacity'] : 100;
    const hidden = opacity === 0;
    const idx = siblings.findIndex((n) => n.id === node.id);
    // Valid drop target? Not the dragged node itself, and not anywhere inside
    // its own subtree (that would create a cycle).
    const dragged = draggingId ? findNode(tree, draggingId) : null;
    const wouldCycle = dragged != null && (node.id === draggingId || !!findNode(dragged.children, node.id));
    const canDrop = draggingId != null && !wouldCycle;
    const intoGroup = canDrop && isGroup;

    return (
      <li key={node.id}>
        <div
          draggable={editingId !== node.id}
          onDragStart={() => setDraggingId(node.id)}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTargetId(null);
          }}
          onDragOver={(e) => {
            if (canDrop) {
              e.preventDefault();
              setDropTargetId(node.id);
            }
          }}
          onDrop={(e) => {
            if (canDrop && draggingId) {
              e.preventDefault();
              // Drop ON a group → into the group (append). Drop on any other row
              // → into that row's parent at its slot (reorder, or move out).
              if (isGroup) moveNode(draggingId, node.id, node.children.length);
              else moveNode(draggingId, parentId, idx);
            }
            setDraggingId(null);
            setDropTargetId(null);
          }}
          onClick={(e) => selectNode(node.id, e.shiftKey || e.metaKey || e.ctrlKey)}
          className={`group flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${
            isSelected ? 'bg-bg-3 text-text-primary' : 'text-text-secondary hover:bg-bg-2 hover:text-text-primary'
          } ${
            dropTargetId === node.id
              ? intoGroup
                ? 'ring-1 ring-accent-400 bg-accent-500/10'
                : 'border-t-2 border-accent-400'
              : 'border-t-2 border-transparent'
          }`}
          style={{ paddingLeft: 8 + depth * 14, ...(isSelected ? { boxShadow: 'inset 2px 0 0 0 var(--accent-400)' } : {}) }}
        >
          {isGroup ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(node.id);
              }}
              title={isCollapsed ? 'Expand' : 'Collapse'}
              className="w-4 flex items-center justify-center text-text-tertiary hover:text-text-primary"
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <NodeIcon type={node.type} size={14} className="text-text-tertiary shrink-0" />
          {editingId === node.id ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setEditingId(null);
              }}
              className="flex-1 min-w-0 text-base bg-bg-1 border border-accent-400 rounded px-1 outline-none text-text-primary"
            />
          ) : (
            <span
              className="flex-1 truncate text-base"
              title="Double-click to rename"
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginRename(node);
              }}
            >
              {node.name}
            </span>
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                moveLayer(node.id, 'up');
              }}
              disabled={idx === 0}
              title="Move forward"
              className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-4 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                moveLayer(node.id, 'down');
              }}
              disabled={idx === siblings.length - 1}
              title="Move back"
              className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-4 rounded disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronDown size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleVisibility(node.id);
              }}
              title={hidden ? 'Show' : 'Hide'}
              className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-4 rounded"
            >
              {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeNode(node.id);
              }}
              title="Delete"
              className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-danger hover:bg-bg-4 rounded"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {isGroup && !isCollapsed && node.children.length > 0 && (
          <ul className="space-y-1 mt-1">
            {node.children.map((c) => renderRow(c, depth + 1, node.children, node.id))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={group}
          disabled={selectedIds.length < 1}
          title="Group selection (⌘G)"
          className="px-2 py-0.5 text-xs rounded bg-bg-2 hover:bg-bg-3 text-text-secondary hover:text-text-primary disabled:opacity-30"
        >
          Group
        </button>
        <button
          type="button"
          onClick={() => selectedGroup && ungroup(selectedGroup.id)}
          disabled={!selectedGroup}
          title="Ungroup (⌘⇧G)"
          className="px-2 py-0.5 text-xs rounded bg-bg-2 hover:bg-bg-3 text-text-secondary hover:text-text-primary disabled:opacity-30"
        >
          Ungroup
        </button>
      </div>
      <ul className="space-y-1">{tree.map((n) => renderRow(n, 0, tree, null))}</ul>
    </div>
  );
}
