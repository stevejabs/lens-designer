'use client';

import { useState } from 'react';
import { Layers, Sparkles } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { useAgentStore } from '@/lib/v2/agent-store';
import { specForType, type PropSpec, type ComponentSpec } from '@/lib/v2/uikit/catalog';
import { CornerControl } from './CornerControl';
import { Button } from '../ui/Primitives';
import { cn } from '@/lib/v2/cn';

type Change = { label: string; value: string };
type Pending = Record<string, Change>;

function PropRow({
  spec,
  value,
  onChange,
}: {
  spec: PropSpec;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const val = value ?? (spec.default !== undefined ? String(spec.default) : spec.type === 'boolean' ? 'false' : '');
  const label = <span className="text-xs text-text-secondary">{spec.label}</span>;

  if (spec.type === 'boolean') {
    const on = val === 'true';
    return (
      <div className="flex items-center justify-between h-8">
        {label}
        <button
          onClick={() => onChange(on ? 'false' : 'true')}
          className={cn('relative w-9 h-5 rounded-full transition-colors', on ? 'accent-bg' : 'bg-bg-3')}
        >
          <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform', on && 'translate-x-4')} />
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
          onChange={(e) => onChange(e.target.value)}
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
          onChange={(e) => onChange(e.target.value)}
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
  return (
    <div className="flex items-center justify-between h-8 gap-2">
      {label}
      <input
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder={spec.type === 'vec2' ? 'x, y' : spec.type === 'vec3' ? 'x, y, z' : ''}
        className="w-28 h-6 px-2 rounded-md bg-bg-2 border border-default text-2xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-strong text-right font-num"
      />
    </div>
  );
}

const CATEGORY_ORDER = ['state', 'text', 'color', 'corner', 'border', 'size', 'layout', 'behavior', 'visual'];

function ElementInspector({
  spec,
  name,
  type,
  viewPath,
}: {
  spec: ComponentSpec;
  name: string;
  type: string | null;
  viewPath: string | null;
}) {
  const editElement = useAgentStore((s) => s.editElement);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);
  const [pending, setPending] = useState<Pending>({});

  const setProp = (key: string, label: string, value: string): void =>
    setPending((p) => ({ ...p, [key]: { label, value } }));

  const apply = (): void => {
    const changes = Object.values(pending);
    if (changes.length === 0 || !viewPath) return;
    setAgentOpen(true);
    editElement({ viewPath, elementName: name, elementType: type, changes });
    setPending({});
  };

  const byCategory = new Map<string, PropSpec[]>();
  for (const p of spec.props) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }
  const hasCorner = spec.props.some((p) => p.category === 'corner');
  const pendingCount = Object.keys(pending).length;

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-subtle">
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-accent-400" />
          <h3 className="text-sm font-semibold text-text-primary truncate">{name}</h3>
        </div>
        <p className="text-2xs text-text-tertiary mt-0.5">{spec.label}</p>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const specs = (byCategory.get(cat) ?? []).filter((p) => p.category !== 'corner');
        if (specs.length === 0) return null;
        return (
          <div key={cat} className="px-4 py-2 border-b border-subtle">
            <div className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mb-1">{cat}</div>
            {specs.map((s) => (
              <PropRow key={s.key} spec={s} value={pending[s.key]?.value} onChange={(v) => setProp(s.key, s.label, v)} />
            ))}
          </div>
        );
      })}

      {hasCorner && (
        <div className="px-4 py-2 border-b border-subtle">
          <div className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mb-1">corners</div>
          <CornerControl onChange={(label, value) => setProp('corners', label, value)} />
        </div>
      )}

      {pendingCount > 0 && viewPath && (
        <div className="p-3 border-b border-subtle">
          <Button variant="primary" size="md" icon={<Sparkles />} onClick={apply} className="w-full justify-center">
            Apply {pendingCount} change{pendingCount > 1 ? 's' : ''}
          </Button>
          <p className="text-2xs text-text-tertiary mt-1.5 text-center">Routed through your CLI to edit the view.</p>
        </div>
      )}
    </div>
  );
}

/** Picks the inspector for the current selection. */
export function ElementInspectorPanel() {
  const selected = useUiStore((s) => s.selectedElement);
  const active = useUiStore((s) => s.activeArtifact);
  const viewPath = active?.kind === 'view' ? active.path : null;
  const spec = specForType(selected?.type);
  if (!selected) return null;
  if (!spec) {
    return (
      <div className="px-4 py-3 text-xs text-text-tertiary border-b border-subtle">
        <div className="text-sm text-text-primary mb-1">{selected.name}</div>
        {selected.type ? `${selected.type} — no editable properties catalogued yet.` : 'Structural node.'}
      </div>
    );
  }
  return <ElementInspector key={selected.id} spec={spec} name={selected.name} type={selected.type} viewPath={viewPath} />;
}
