'use client';

import { Component } from 'lucide-react';
import { MANIFESTS, type PrimitiveManifest } from '@lens-designer/bridge/client';
import { useDesignStore } from '@/lib/design-model';
import { useDefinitions, defRootNode, defBoundsCm, wouldCycle } from '@/lib/definitions';
import type { UseAttachMode } from '@/lib/use-attach-mode';
import { NodeIcon } from './icons';

interface PaletteProps {
  /**
   * False when no view is selected in the Views panel. The Palette
   * buttons become inert and a one-line nudge replaces the click
   * affordance — placing objects without a view leaves them orphaned
   * (nothing to save against). The "Create view" CTA lives on the
   * Canvas; we just gate the action here.
   */
  hasActiveView: boolean;
  /** Attach state — drives the shared-components section (saved views are
   *  the component library). */
  attach: UseAttachMode;
}

export function Palette({ hasActiveView, attach }: PaletteProps) {
  const addNode = useDesignStore((s) => s.addNode);
  const addInstance = useDesignStore((s) => s.addInstance);
  const defs = useDefinitions((s) => s.defs);
  const atomics: PrimitiveManifest[] = Object.values(MANIFESTS).filter(
    (m): m is PrimitiveManifest => m !== undefined && m.category === 'atomic',
  );

  const disabled = !hasActiveView;
  const activeId = attach.activeViewId;

  // Saved views usable as components in the ACTIVE view: must have a marked
  // component root (a definition), and placing them must not create a cycle
  // (no self, no view that transitively instances the active view). The
  // bridge expansion re-guards at apply time.
  const components = attach.views.filter((v) => {
    if (activeId === null || v.id === activeId) return false;
    if (!defRootNode(defs[v.id])) return false;
    return !wouldCycle(defs, activeId, v.id);
  });

  return (
    <aside className="flex flex-col h-full bg-bg-1 border-r border-border-subtle py-2 overflow-y-auto">
      <div className="px-4 pt-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        Primitives
      </div>
      {disabled && (
        <div className="px-4 pb-2 text-[11px] text-text-tertiary leading-snug">
          Select or create a view to start placing primitives.
        </div>
      )}
      <div className="px-2 flex flex-col gap-1">
        {atomics.map((m) => (
          <button
            key={m.type}
            type="button"
            onClick={() => addNode(m.type)}
            disabled={disabled}
            title={disabled ? 'Create a view first' : m.displayName}
            className="group flex items-center gap-3.5 px-3 py-3 rounded-lg text-text-secondary hover:bg-bg-3 hover:text-text-primary active:bg-bg-4 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            <NodeIcon
              type={m.type}
              size={22}
              className="text-text-tertiary group-hover:text-accent-400 transition-colors shrink-0"
            />
            <span className="text-[15px] font-medium leading-none">{m.displayName}</span>
          </button>
        ))}
      </div>

      {components.length > 0 && (
        <>
          <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Components
          </div>
          <div className="px-2 flex flex-col gap-1">
            {components.map((v) => {
              const codeName = defs[v.id]?.codeName ?? v.codeName;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => addInstance(v.id, codeName, defBoundsCm(defs[v.id]))}
                  disabled={disabled}
                  title={`Place an instance of ${codeName} — edit the original view and every instance updates`}
                  className="group flex items-center gap-3.5 px-3 py-3 rounded-lg text-text-secondary hover:bg-bg-3 hover:text-text-primary active:bg-bg-4 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                >
                  <Component
                    size={22}
                    className="text-text-tertiary group-hover:text-accent-400 transition-colors shrink-0"
                  />
                  <span className="text-[15px] font-medium leading-none truncate">{codeName}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
