'use client';

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { specForType, type PropSpec, type ComponentSpec } from '@/lib/v2/uikit/catalog';
import { CornerControl } from './CornerControl';
import { cn } from '@/lib/v2/cn';

function PropRow({ spec }: { spec: PropSpec }) {
  const [val, setVal] = useState<string>(
    spec.default !== undefined ? String(spec.default) : spec.type === 'boolean' ? 'false' : '',
  );

  const label = (
    <span className="text-xs text-text-secondary">{spec.label}</span>
  );

  if (spec.type === 'boolean') {
    const on = val === 'true';
    return (
      <div className="flex items-center justify-between h-8">
        {label}
        <button
          onClick={() => setVal(on ? 'false' : 'true')}
          className={cn(
            'relative w-9 h-5 rounded-full transition-colors',
            on ? 'accent-bg' : 'bg-bg-3',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              on && 'translate-x-4',
            )}
          />
        </button>
      </div>
    );
  }

  if (spec.type === 'color') {
    return (
      <div className="flex items-center justify-between h-8">
        {label}
        <input
          type="color"
          value={/^#/.test(val) ? val : '#8899aa'}
          onChange={(e) => setVal(e.target.value)}
          className="w-7 h-5 rounded border border-default bg-transparent cursor-pointer"
        />
      </div>
    );
  }

  if (spec.type === 'enum') {
    return (
      <div className="flex items-center justify-between h-8 gap-2">
        {label}
        <select
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="h-6 px-1.5 rounded-md bg-bg-2 border border-default text-2xs text-text-primary outline-none focus:border-strong"
        >
          <option value="">—</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // number / string / vec
  return (
    <div className="flex items-center justify-between h-8 gap-2">
      {label}
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={spec.type === 'vec2' ? 'x, y' : spec.type === 'vec3' ? 'x, y, z' : ''}
        className="w-28 h-6 px-2 rounded-md bg-bg-2 border border-default text-2xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-strong text-right font-num"
      />
    </div>
  );
}

const CATEGORY_ORDER = ['state', 'text', 'color', 'corner', 'border', 'size', 'layout', 'behavior', 'visual'];

function Group({ title, specs }: { title: string; specs: PropSpec[] }) {
  if (specs.length === 0) return null;
  return (
    <div className="px-4 py-2 border-b border-subtle">
      <div className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mb-1">{title}</div>
      {specs.map((s) => (
        <PropRow key={s.key} spec={s} />
      ))}
    </div>
  );
}

/** Schema-driven inspector for the selected UIKit element. Renders controls
 *  from the catalog; corner-capable elements also get the per-corner control
 *  (the individual-rounded-corners fork). */
export function ElementInspector({ spec, name }: { spec: ComponentSpec; name: string }) {
  const byCategory = new Map<string, PropSpec[]>();
  for (const p of spec.props) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }
  const hasCorner = spec.props.some((p) => p.category === 'corner');

  return (
    <div className="flex flex-col min-h-0 overflow-y-auto">
      <div className="px-4 py-3 border-b border-subtle">
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-accent-400" />
          <h3 className="text-sm font-semibold text-text-primary truncate">{name}</h3>
        </div>
        <p className="text-2xs text-text-tertiary mt-0.5">{spec.label}</p>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const specs = (byCategory.get(cat) ?? []).filter((p) => p.category !== 'corner');
        return <Group key={cat} title={cat} specs={specs} />;
      })}

      {hasCorner && (
        <div className="px-4 py-2 border-b border-subtle">
          <div className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mb-1">corners</div>
          <CornerControl />
        </div>
      )}
    </div>
  );
}

/** Picks the inspector for the current selection, falling back to a hint. */
export function ElementInspectorPanel() {
  const selected = useUiStore((s) => s.selectedElement);
  const spec = specForType(selected?.type);
  if (!selected) return null;
  if (!spec) {
    return (
      <div className="px-4 py-3 text-xs text-text-tertiary">
        <div className="text-sm text-text-primary mb-1">{selected.name}</div>
        {selected.type ? `${selected.type} — no editable properties catalogued yet.` : 'Structural node.'}
      </div>
    );
  }
  return <ElementInspector spec={spec} name={selected.name} />;
}
