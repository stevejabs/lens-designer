'use client';

import { Move, Maximize, Square, Type, Layers as LayersIcon, Sparkles } from 'lucide-react';
import { Group, Row, NumField, Swatch, Slider, Toggle, StateTabs } from './InspectorFields';
import { Pill } from '../ui/Primitives';

// The inspector that finally gives UIKit's code-only visual surface a UI:
// layout, fill (incl. gradient), corner radius, border, per-state visuals.
export function Inspector() {
  return (
    <aside className="flex flex-col w-[280px] shrink-0 border-l border-subtle bg-bg-0">
      {/* selection header */}
      <div className="flex items-center gap-2.5 h-11 px-4 border-b border-subtle">
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-bg-2 border border-subtle">
          <Square className="w-3.5 h-3.5 text-accent-400" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">BackPlate</div>
          <div className="text-2xs text-text-tertiary">SpectaclesUIKit</div>
        </div>
        <Pill tone="accent">UIKit</Pill>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Group title="Layout">
          <Row label="Position">
            <NumField value="0" suffix="cm" icon={<Move />} />
            <NumField value="0" suffix="cm" />
          </Row>
          <Row label="Size">
            <NumField value="30" suffix="cm" icon={<Maximize />} />
            <NumField value="34" suffix="cm" />
          </Row>
          <Row label="Padding">
            <NumField value="2.0" suffix="cm" />
            <NumField value="2.0" suffix="cm" />
          </Row>
          <Row label="Gap">
            <NumField value="1.6" suffix="cm" />
          </Row>
        </Group>

        <Group title="Appearance">
          <Row label="Fill">
            <Swatch color="var(--accent-grad)" label="Gradient" />
          </Row>
          <Row label="From">
            <Swatch color="#28218f" label="#28218F" />
          </Row>
          <Row label="To">
            <Swatch color="#26b8d9" label="#26B8D9" />
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
          <Row label="Color">
            <Swatch color="#a6e6ff" label="#A6E6FF" />
          </Row>
        </Group>

        <Group title="States" right={<Sparkles className="w-3 h-3 text-violet-400" />}>
          <StateTabs />
          <p className="text-2xs text-text-tertiary pt-1">
            Per-state fill, border, scale & position — the 7 UIKit visual states, editable here.
          </p>
        </Group>

        <Group title="Text" defaultOpen={false}>
          <Row label="Font">
            <div className="flex items-center gap-2 h-7 px-2 flex-1 rounded-md bg-bg-2 border border-subtle">
              <Type className="w-3 h-3 text-text-tertiary" />
              <span className="text-xs text-text-secondary">Inter</span>
            </div>
          </Row>
          <Row label="Role">
            <div className="flex items-center h-7 px-2 flex-1 rounded-md bg-bg-2 border border-subtle text-xs text-text-secondary">
              Title2 · 93 / Bold
            </div>
          </Row>
        </Group>
      </div>

      {/* footer: emitted module */}
      <div className="flex items-center gap-2 h-9 px-4 border-t border-subtle">
        <LayersIcon className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="font-num text-2xs text-text-tertiary truncate">SettingsPanel.ts</span>
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success" title="compiled" />
      </div>
    </aside>
  );
}
