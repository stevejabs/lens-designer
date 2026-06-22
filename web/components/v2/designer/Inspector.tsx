'use client';

import { useState } from 'react';
import { Square, Layers as LayersIcon, Sparkles, Loader2 } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { useViewFields } from '@/lib/v2/hooks';
import { getLd, type LDViewField, type LDFieldKind } from '@/lib/v2/native';
import { cn } from '@/lib/v2/cn';
import { Group, Row, NumField, Swatch, Slider, Toggle, StateTabs } from './InspectorFields';
import { Pill } from '../ui/Primitives';

function vec4ToHex(v: number[]): string {
  const c = (n: number): string =>
    Math.max(0, Math.min(255, Math.round((n ?? 0) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(v[0] ?? 0)}${c(v[1] ?? 0)}${c(v[2] ?? 0)}`;
}
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [
    parseInt(m.slice(0, 2), 16) / 255,
    parseInt(m.slice(2, 4), 16) / 255,
    parseInt(m.slice(4, 6), 16) / 255,
  ];
}

/** A live, editable control for one parsed view constant. */
function FieldRow({
  field,
  onChange,
}: {
  field: LDViewField;
  onChange: (kind: LDFieldKind, value: number | number[] | string | boolean) => void;
}) {
  const label = field.name
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Single text-buffer hook, used by the number + string editors. Called
  // unconditionally to satisfy rules-of-hooks.
  const [text, setText] = useState(String(field.value));

  if (field.kind === 'number') {
    return (
      <Row label={label}>
        <div className="flex items-center h-7 px-2 flex-1 rounded-md bg-bg-2 border border-subtle focus-within:border-strong">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const n = Number.parseFloat(text);
              if (Number.isFinite(n) && n !== field.value) onChange('number', n);
            }}
            className="w-full bg-transparent font-num text-xs text-text-primary outline-none"
          />
        </div>
      </Row>
    );
  }

  if (field.kind === 'color') {
    const arr = field.value as number[];
    return (
      <Row label={label}>
        <label className="flex items-center gap-2 h-7 px-2 flex-1 rounded-md bg-bg-2 border border-subtle hover:border-default cursor-pointer">
          <input
            type="color"
            value={vec4ToHex(arr)}
            onChange={(e) => {
              const [r, g, b] = hexToRgb(e.target.value);
              onChange('color', [r, g, b, arr[3] ?? 1]);
            }}
            className="w-4 h-4 rounded border-0 bg-transparent cursor-pointer p-0"
          />
          <span className="font-num text-xs text-text-secondary uppercase">{vec4ToHex(arr)}</span>
        </label>
      </Row>
    );
  }

  if (field.kind === 'boolean') {
    return (
      <Row label={label}>
        <div className="flex-1 flex justify-end">
          <button onClick={() => onChange('boolean', !(field.value as boolean))}>
            <Toggle on={field.value as boolean} />
          </button>
        </div>
      </Row>
    );
  }

  // string
  return (
    <Row label={label}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== field.value && onChange('string', text)}
        className="flex-1 h-7 px-2 rounded-md bg-bg-2 border border-subtle text-xs text-text-primary outline-none focus:border-strong"
      />
    </Row>
  );
}

/** Static mock inspector (browser / no view selected) — shows the rich surface. */
function MockInspector() {
  return (
    <>
      <Group title="Layout">
        <Row label="Size">
          <NumField value="30" suffix="cm" />
          <NumField value="34" suffix="cm" />
        </Row>
        <Row label="Padding">
          <NumField value="2.0" suffix="cm" />
        </Row>
      </Group>
      <Group title="Appearance">
        <Row label="Fill">
          <Swatch color="var(--accent-grad)" label="Gradient" />
        </Row>
        <Row label="Corner">
          <Slider value={28} />
        </Row>
        <Row label="Opacity">
          <Slider value={100} />
        </Row>
      </Group>
      <Group title="Border">
        <Row label="Enabled">
          <div className="flex-1 flex justify-end">
            <Toggle on={true} />
          </div>
        </Row>
        <Row label="Width">
          <NumField value="0.35" suffix="cm" />
        </Row>
      </Group>
      <Group title="States" right={<Sparkles className="w-3 h-3 text-violet-400" />}>
        <StateTabs />
      </Group>
    </>
  );
}

// Group parsed fields into sections by kind for a tidy inspector.
function groupFields(fields: LDViewField[]): { title: string; items: LDViewField[] }[] {
  const colors = fields.filter((f) => f.kind === 'color');
  const numbers = fields.filter((f) => f.kind === 'number');
  const flags = fields.filter((f) => f.kind === 'boolean');
  const strings = fields.filter((f) => f.kind === 'string');
  return [
    { title: 'Colors', items: colors },
    { title: 'Dimensions', items: numbers },
    { title: 'Flags', items: flags },
    { title: 'Text', items: strings },
  ].filter((g) => g.items.length > 0);
}

export function Inspector() {
  const active = useUiStore((s) => s.activeArtifact);
  const viewPath = active?.kind === 'view' ? active.path : null;
  const { fields, setField, saving } = useViewFields(viewPath);
  const electron = getLd() !== null;
  const live = electron && fields.length > 0;
  const groups = groupFields(fields);

  return (
    <aside className="flex flex-col w-[280px] shrink-0 border-l border-subtle bg-bg-0">
      <div className="flex items-center gap-2.5 h-11 px-4 border-b border-subtle">
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-bg-2 border border-subtle">
          <Square className="w-3.5 h-3.5 text-accent-400" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">
            {active?.name ?? 'BackPlate'}
          </div>
          <div className="text-2xs text-text-tertiary">
            {live ? `${fields.length} editable properties` : 'SpectaclesUIKit'}
          </div>
        </div>
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-400" />
        ) : (
          <Pill tone="accent">UIKit</Pill>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {live ? (
          groups.map((g) => (
            <Group key={g.title} title={g.title}>
              {g.items.map((f) => (
                <FieldRow key={f.name} field={f} onChange={(kind, value) => void setField(f.name, kind, value)} />
              ))}
            </Group>
          ))
        ) : (
          <MockInspector />
        )}
      </div>

      <div className="flex items-center gap-2 h-9 px-4 border-t border-subtle">
        <LayersIcon className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="font-num text-2xs text-text-tertiary truncate">
          {active?.kind === 'view' ? active.name + '.ts' : 'SettingsPanel.ts'}
        </span>
        <span className={cn('ml-auto w-1.5 h-1.5 rounded-full', saving ? 'bg-warning' : 'bg-success')} />
      </div>
    </aside>
  );
}
