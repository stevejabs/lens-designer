'use client';

import { useEffect, useRef, useState } from 'react';
import { useDesignStore, findNode, findPath, isReservedBindingKey } from '@/lib/design-model';
import { resolveForState } from '@/lib/resolve-state';
import { useBridgeSend, useOtherComponentNames } from '@/lib/bridge-context';
import { useDefinitions, defRootNode } from '@/lib/definitions';
import {
  getManifest,
  type PropertyDescriptor,
  type DesignNode,
  type InteractionRole,
  type StatePropKey,
} from '@lens-designer/bridge/client';

type OverrideState = 'hover' | 'pinched' | 'disabled';

/** Manifest property key → per-state override prop key (replace-semantics only).
 *  `fillColor` is text color on a Text node, fill on a shape. Returns null for
 *  props handled elsewhere or base-only: position/scale get their own
 *  per-state Transform section (TransformOverrideRows); size/rotation/content
 *  are base-only. */
function overrideKeyFor(nodeType: string, propKey: string): StatePropKey | null {
  switch (propKey) {
    case 'fillColor':
      return nodeType === 'Text' ? 'textColor' : 'fillColor';
    case 'strokeColor':
      return 'strokeColor';
    case 'strokeWidth':
      return 'strokeWidth';
    case 'opacity':
      return 'opacity';
    default:
      return null;
  }
}
import { ColorPicker, type RgbaColor } from './ColorPicker';
import { NumberField } from './fields';
import {
  bridgeImageUrl,
  bridgeSystemFontUrl,
  ingestImageFile,
  ingestImageUrl,
  ingestFontFile,
} from '@/lib/bridge-http';

export function Inspector() {
  const tree = useDesignStore((s) => s.tree);
  const selectedIds = useDesignStore((s) => s.selectedIds);
  const updateProp = useDesignStore((s) => s.updateProp);
  const renameNode = useDesignStore((s) => s.renameNode);
  const editState = useDesignStore((s) => s.editState);
  const setStateOverride = useDesignStore((s) => s.setStateOverride);
  const clearStateOverride = useDesignStore((s) => s.clearStateOverride);
  // Recursive: a selected node may be nested inside a group.
  const node = selectedIds.length === 1 ? findNode(tree, selectedIds[0]!) : undefined;

  if (selectedIds.length > 1) {
    return (
      <div className="text-sm text-text-secondary">
        {selectedIds.length} nodes selected. Drag to move them together, or press
        Delete to remove. Select a single node to edit its properties.
      </div>
    );
  }

  if (!node) {
    return (
      <div className="text-sm text-text-secondary">
        Select a node on the canvas or in the layers panel to edit its properties.
      </div>
    );
  }

  // Shared-component instance: its own dedicated panel (no manifest — the
  // definition owns geometry/styling; the instance owns placement + slot
  // overrides + the parent-controller binding).
  if (node.instance) {
    return <InstanceInspector node={node} />;
  }

  const manifest = getManifest(node.type);
  if (!manifest) {
    return <div className="text-sm text-danger">Unknown primitive type: {node.type}</div>;
  }

  // Group by section.
  const sections = new Map<string, PropertyDescriptor[]>();
  for (const prop of manifest.properties) {
    const section = prop.section ?? 'Other';
    const list = sections.get(section) ?? [];
    list.push(prop);
    sections.set(section, list);
  }

  const overriding = editState !== 'default';
  const ostate = editState as OverrideState; // only read when `overriding`
  const display = overriding ? resolveForState(node, editState) : node;
  const ov = overriding ? node.stateOverrides?.[ostate] : undefined;

  const header = (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary"
        title={`id ${node.id.slice(0, 8)}…`}
      >
        {manifest.displayName}
      </span>
      <div className="flex-1 min-w-0">
        <NameField key={node.id} name={node.name} onRename={(n) => renameNode(node.id, n)} />
      </div>
    </div>
  );

  // --- Per-state override authoring (WB3) -----------------------------------
  if (overriding) {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded bg-accent-500/10 border border-accent-400/30 px-2 py-1.5 text-xs text-text-secondary">
          Editing <b className="text-text-primary capitalize">{editState}</b> state — changes apply only
          to this state. Switch to <b>Default</b> for layout, content, and structure.
        </div>
        <section className="space-y-1">
          <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            Visible in {editState}
          </header>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={ov?.visible !== false}
              onChange={(e) =>
                e.target.checked
                  ? clearStateOverride(node.id, ostate, 'visible')
                  : setStateOverride(node.id, ostate, 'visible', false)
              }
            />
            Shown in this state
          </label>
        </section>
        <TransformOverrideRows
          key={`tf-${node.id}-${editState}`}
          state={editState}
          scale={ov?.scale}
          position={ov?.position}
          onScale={(v) =>
            v
              ? setStateOverride(node.id, ostate, 'scale', v)
              : clearStateOverride(node.id, ostate, 'scale')
          }
          onPosition={(v) =>
            v
              ? setStateOverride(node.id, ostate, 'position', v)
              : clearStateOverride(node.id, ostate, 'position')
          }
        />
        {Array.from(sections.entries()).map(([section, props]) => {
          const overridable = props.filter((p) => overrideKeyFor(node.type, p.key) !== null);
          if (overridable.length === 0) return null;
          return (
            <section key={section} className="space-y-1">
              <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {section}
              </header>
              {overridable.map((prop) => {
                const key = overrideKeyFor(node.type, prop.key)!;
                const isSet = ov?.[key] !== undefined;
                return (
                  <PropertyRow
                    key={`${node.id}-${editState}-${prop.key}`}
                    prop={prop}
                    value={display.properties[prop.key]}
                    onChange={(v) => setStateOverride(node.id, ostate, key, v)}
                    overridden={isSet}
                    onReset={isSet ? () => clearStateOverride(node.id, ostate, key) : undefined}
                  />
                );
              })}
            </section>
          );
        })}
      </div>
    );
  }

  // --- Base authoring (Default state) ---------------------------------------
  return (
    <div className="space-y-3">
      {header}
      {Array.from(sections.entries()).map(([section, props]) => (
        <section key={section} className="space-y-1">
          <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{section}</header>
          {section === 'Corners' ? (
            // Re-keyed by node.id so the inner inputs reset their draft
            // state on selection change — otherwise an un-blurred field
            // commits its stale draft to the newly-selected node.
            <CornersGrid key={`corners-${node.id}`} props={props} node={node} onChange={updateProp} />
          ) : (
            props.map((prop) => (
              // Same reasoning: node.id in the key forces a remount when
              // the user switches selection mid-edit. Loses the in-flight
              // un-committed draft, which is the safer default vs.
              // accidentally writing it to the wrong node.
              <PropertyRow
                key={`${node.id}-${prop.key}`}
                prop={prop}
                value={node.properties[prop.key]}
                onChange={(v) => updateProp(node.id, prop.key, v)}
              />
            ))
          )}
        </section>
      ))}
      {node.type === 'Group' && <LayoutSection key={`layout-${node.id}`} node={node} />}
      <FillParentToggle key={`fill-${node.id}`} node={node} />
      <InteractionSection key={`ix-${node.id}`} node={node} />
      {node.type === 'Group' && <ViewSection key={`view-${node.id}`} node={node} />}
      <CodeBindingSection key={`bind-${node.id}`} node={node} />
    </div>
  );
}

/** A camelCase identifier seeded from a node name (for default keys/names). */
function slugIdent(name: string, fallback: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return fallback;
  const ident = parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p[0]!.toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
  return /^[a-zA-Z]/.test(ident) ? ident : fallback;
}

/** A PascalCase identifier for a component class name. Unlike slugIdent, this
 *  PRESERVES the author's internal capitalization — "BookInfo" → "BookInfo"
 *  (so the class is BookInfoView, not Bookinfo…) — and only ensures each word
 *  starts uppercase and the result is a valid identifier. */
function pascal(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'View';
  const id = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  return /^[a-zA-Z]/.test(id) ? id : 'View';
}

/** Lowercased class names of every component node in `nodes`, skipping the node
 *  with id `excludeId` (the one being edited). Used to detect a name collision
 *  within the current tree. */
function collectComponentNames(nodes: DesignNode[], excludeId: string): string[] {
  const out: string[] = [];
  const walk = (ns: DesignNode[]): void => {
    for (const n of ns) {
      if (n.id !== excludeId && n.view) out.push(n.view.name.toLowerCase());
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const LAYOUT_FIELD =
  'w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-sm text-text-primary';

/** Stack-lite hug layout (WB-L) — groups only. Content children flow on the
 *  axis; the group hugs them + padding; a child flagged "Fill parent" backs it. */
function LayoutSection({ node }: { node: DesignNode }) {
  const setLayout = useDesignStore((s) => s.setLayout);
  const layout = node.layout;
  const on = !!layout;
  const L = layout ?? { mode: 'row' as const, spacing: 0, padding: { x: 1, y: 0.5 }, hug: true };
  const update = (patch: Partial<typeof L>) => setLayout(node.id, { ...L, ...patch });
  return (
    <section className="space-y-1.5">
      <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Layout</header>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={on} onChange={(e) => setLayout(node.id, e.target.checked ? L : undefined)} />
        Auto-layout (stack + hug)
      </label>
      {on && (
        <div className="space-y-1.5 pl-1">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-text-secondary">Direction</span>
            {(['row', 'column'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update({ mode: m })}
                className={`px-2 py-1 text-xs rounded border ${L.mode === m ? 'border-accent-500 bg-accent-500/10 text-text-primary' : 'border-border-subtle text-text-secondary hover:bg-bg-3'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-text-secondary">Spacing</span>
            <div className="flex-1 min-w-0"><NumberField value={L.spacing} step={0.1} min={0} onChange={(n) => update({ spacing: n })} className={LAYOUT_FIELD} /></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-text-secondary">Padding</span>
            <div className="flex-1 min-w-0"><NumberField value={L.padding.x} step={0.1} min={0} onChange={(n) => update({ padding: { x: n, y: L.padding.y } })} className={LAYOUT_FIELD} /></div>
            <div className="flex-1 min-w-0"><NumberField value={L.padding.y} step={0.1} min={0} onChange={(n) => update({ padding: { x: L.padding.x, y: n } })} className={LAYOUT_FIELD} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={L.hug} onChange={(e) => update({ hug: e.target.checked })} />
            Hug contents (grow to fit)
          </label>
          <p className="text-xs text-text-tertiary">
            Content children flow + the group hugs them. Mark a child “Fill parent” to make it the background.
          </p>
        </div>
      )}
    </section>
  );
}

/** Mark a child as its hug-group's stretch-to-fit background (WB-L). */
function FillParentToggle({ node }: { node: DesignNode }) {
  const setFillParent = useDesignStore((s) => s.setFillParent);
  return (
    <section className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={!!node.fillParent} onChange={(e) => setFillParent(node.id, e.target.checked)} />
        Fill parent (background)
      </label>
      <span className="text-[11px] text-text-tertiary">
        Stretches to the parent group's hugged size — use for a pill background behind content.
      </span>
    </section>
  );
}

/** Component (View) marker — only shown for groups. A View becomes an
 *  instantiable, code-bindable component; codegen emits a controller for it. */
function ViewSection({ node }: { node: DesignNode }) {
  const setView = useDesignStore((s) => s.setView);
  const tree = useDesignStore((s) => s.tree);
  const otherViewNames = useOtherComponentNames();
  const isView = !!node.view;
  // A component is generated as one controller per view; a component nested
  // inside another component produces a view-inside-a-view that the codegen
  // can't express and the apply rejects ("unknown node"). Block creating that
  // here. (An already-nested node stays toggleable so a mistake can be undone.)
  const ancestorComponent = findPath(tree, node.id)
    .slice(0, -1)
    .find((p) => !!p.view);
  const blocked = !isView && !!ancestorComponent;

  // Every component name a new/renamed name would collide with: other saved
  // views (from the registry) + any other component node in THIS tree. Two
  // components can't share a class name (two controllers, same class). Lowercased
  // for case-insensitive comparison, matching the registry's findViewByName.
  const takenNames = new Set<string>(otherViewNames);
  collectComponentNames(tree, node.id).forEach((n) => takenNames.add(n));
  function isTaken(name: string): boolean {
    return takenNames.has(name.trim().toLowerCase());
  }
  // Seed the default name from the group name, preserving the author's casing
  // (BookInfo → BookInfoView, not Bookinfo…), then make it unique so checking
  // the box never lands on an existing name.
  function defaultName(): string {
    const base = `${pascal(node.name)}View`;
    if (!isTaken(base)) return base;
    for (let i = 2; i < 1000; i++) if (!isTaken(`${pascal(node.name)}${i}View`)) return `${pascal(node.name)}${i}View`;
    return base;
  }

  return (
    <section className="space-y-1.5">
      <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Component</header>
      <label
        className={`flex items-center gap-2 text-sm ${blocked ? 'text-text-tertiary' : 'text-text-secondary'}`}
      >
        <input
          type="checkbox"
          checked={isView}
          disabled={blocked}
          onChange={(e) =>
            setView(node.id, e.target.checked ? { name: defaultName() } : undefined)
          }
        />
        Make this a component
      </label>
      {blocked && (
        <p className="text-xs text-amber-400/90">
          Already inside the component “{ancestorComponent!.view!.name}”. A component can’t contain
          another component — bind these elements to code on that component instead. (Reusable nested
          components are coming later.)
        </p>
      )}
      {isView && (
        <label className="block">
          <span className="text-sm text-text-secondary">class name</span>
          <DraftField
            key={`vn-${node.id}`}
            value={node.view?.name ?? ''}
            placeholder="PoiCardView"
            validate={(v) => {
              const t = v.trim();
              if (!t) return null; // empty falls back to "View" on commit
              if (isTaken(t)) return `Another component is already named “${t}”. Pick a unique name.`;
              return null;
            }}
            onCommit={(v) => setView(node.id, { name: v.trim() || 'View' })}
          />
          <span className="text-xs text-text-tertiary">Generates a typed controller class with this name.</span>
        </label>
      )}
    </section>
  );
}

/** Bind-to-code — tags any node as a named slot on its View's controller. */
function CodeBindingSection({ node }: { node: DesignNode }) {
  const setBinding = useDesignStore((s) => s.setBinding);
  const bound = !!node.binding;
  const reserved = bound && isReservedBindingKey(node.binding!.key);
  return (
    <section className="space-y-1.5">
      <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Code</header>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={bound}
          onChange={(e) =>
            setBinding(node.id, e.target.checked ? { key: slugIdent(node.name, 'element') } : undefined)
          }
        />
        Bind to code
      </label>
      {bound && (
        <label className="block">
          <span className="text-sm text-text-secondary">key</span>
          <DraftField
            key={`bk-${node.id}`}
            value={node.binding?.key ?? ''}
            placeholder="e.g. title, hero"
            onCommit={(v) => setBinding(node.id, v.trim() ? { key: v.trim() } : undefined)}
          />
          {reserved ? (
            <span className="text-xs text-amber-400/90">
              “{node.binding!.key}” is reserved by Lens Studio (it’s a member of every
              component). Pick another key — e.g. {node.binding!.key === 'name' ? 'authorName' : `${node.binding!.key}Text`} —
              or the controller won’t compile.
            </span>
          ) : (
            <span className="text-xs text-text-tertiary">
              Exposes a typed handle (view.{node.binding?.key || 'key'}) with setters for this element.
            </span>
          )}
        </label>
      )}
    </section>
  );
}

const INTERACTION_ROLES: Array<{ value: InteractionRole | 'none'; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'button', label: 'Button' },
  { value: 'toggle', label: 'Toggle' },
  // 'draggable' deferred (owner, v1 = button + toggle).
];

/** Interaction section — assign a node/group an interaction role + action key.
 *  The applier attaches SIK Interactable + the role component on apply. Per-state
 *  appearance is authored via the canvas state switcher + per-element overrides
 *  (WB2/WB3), not here. */
function InteractionSection({ node }: { node: DesignNode }) {
  const setInteraction = useDesignStore((s) => s.setInteraction);
  const role: InteractionRole | 'none' = node.interaction?.role ?? 'none';

  function onRole(next: InteractionRole | 'none') {
    if (next === 'none') {
      setInteraction(node.id, undefined);
    } else {
      setInteraction(node.id, { role: next, actionKey: node.interaction?.actionKey ?? '' });
    }
  }

  return (
    <section className="space-y-1.5">
      <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Interaction</header>
      <div className="flex gap-1">
        {INTERACTION_ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onRole(r.value)}
            className={`flex-1 px-2 py-1 text-sm rounded border ${
              role === r.value
                ? 'bg-accent-500/20 border-accent-400 text-text-primary'
                : 'bg-bg-4 border-border-subtle text-text-secondary hover:text-text-primary'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {role !== 'none' && (
        <>
          <label className="block">
            <span className="text-sm text-text-secondary">action key</span>
            {/* Draft + commit on blur: typing must not re-apply per keystroke. */}
            <DraftField
              key={`ak-${node.id}`}
              value={node.interaction?.actionKey ?? ''}
              placeholder="e.g. close, primary"
              onCommit={(v) => setInteraction(node.id, { ...node.interaction, role, actionKey: v })}
            />
            <span className="text-xs text-text-tertiary">Runtime subscribes via onAction(actionKey, …).</span>
          </label>
          <span className="text-xs text-text-tertiary">
            Use the canvas state switcher (Hover / Pinched / Disabled) to author this element's
            per-state appearance.
          </span>
        </>
      )}
    </section>
  );
}

function DraftField({
  value,
  onCommit,
  placeholder,
  validate,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  /** Returns an error message when `v` may not be submitted, else null. While
   *  the draft is invalid the field shows the error and refuses to commit;
   *  blurring reverts to the last valid value. */
  validate?: (v: string) => string | null;
}) {
  const [draft, setDraft] = useState(value);
  const error = validate ? validate(draft) : null;
  return (
    <>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // Don't submit an invalid value — snap back to the last good one.
          if (error) {
            setDraft(value);
            return;
          }
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`w-full mt-0.5 bg-bg-4 border rounded px-2 py-1 text-base text-text-primary focus:outline-none ${
          error ? 'border-red-500 focus:border-red-500' : 'border-border-subtle focus:border-accent-500'
        }`}
      />
      {error && <span className="block text-xs text-red-400 mt-0.5">{error}</span>}
    </>
  );
}

/** Editable node title. Local draft so we only rename (and re-apply) on
 *  commit, not per keystroke. Remount via key={node.id} resets the draft when
 *  the selection changes. */
function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onRename(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') {
          setDraft(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full text-md font-medium bg-transparent border border-transparent hover:border-bg-4 focus:border-accent-400 rounded px-1 -mx-1 outline-none text-text-primary"
    />
  );
}

interface PropertyRowProps {
  prop: PropertyDescriptor;
  value: unknown;
  onChange: (v: unknown) => void;
  /** When authoring a non-default state: whether this prop has an override set. */
  overridden?: boolean | undefined;
  /** When set, renders a ↺ reset control that clears this state's override. */
  onReset?: (() => void) | undefined;
}

type Vec2 = { x: number; y: number };

/** Per-state transform override: scale (multiplier on base) + position (cm delta
 *  from base). This is the button-depress-on-pinch effect — first-class per the
 *  owner. Position/scale aren't manifest properties (they're transform, not on
 *  the per-section property list), so they get their own override section. */
function TransformOverrideRows({
  state,
  scale,
  position,
  onScale,
  onPosition,
}: {
  state: string;
  scale?: Vec2 | undefined;
  position?: Vec2 | undefined;
  onScale: (v: Vec2 | null) => void;
  onPosition: (v: Vec2 | null) => void;
}) {
  const sc = scale ?? { x: 1, y: 1 };
  const po = position ?? { x: 0, y: 0 };
  const fieldCls =
    'w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-sm text-text-primary';
  const resetBtn = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      title="Reset to default (clear this state's override)"
      className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-3"
    >
      ↺
    </button>
  );
  return (
    <section className="space-y-1">
      <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        Transform
      </header>
      <div className="flex items-center gap-2">
        <span
          className={`w-16 shrink-0 text-xs truncate ${scale ? 'text-accent-400 font-medium' : 'text-text-secondary'}`}
          title="Scale multiplier on the base scale (1 = no change)"
        >
          {scale ? '• ' : ''}Scale ×
        </span>
        <div className="flex-1 min-w-0">
          <NumberField value={sc.x} step={0.01} min={0.01} onChange={(n) => onScale({ x: n, y: sc.y })} className={fieldCls} />
        </div>
        <div className="flex-1 min-w-0">
          <NumberField value={sc.y} step={0.01} min={0.01} onChange={(n) => onScale({ x: sc.x, y: n })} className={fieldCls} />
        </div>
        {scale ? resetBtn(() => onScale(null)) : <span className="w-5 shrink-0" />}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`w-16 shrink-0 text-xs truncate ${position ? 'text-accent-400 font-medium' : 'text-text-secondary'}`}
          title="Position offset in cm from the base position"
        >
          {position ? '• ' : ''}Move Δcm
        </span>
        <div className="flex-1 min-w-0">
          <NumberField value={po.x} step={0.1} onChange={(n) => onPosition({ x: n, y: po.y })} className={fieldCls} />
        </div>
        <div className="flex-1 min-w-0">
          <NumberField value={po.y} step={0.1} onChange={(n) => onPosition({ x: po.x, y: n })} className={fieldCls} />
        </div>
        {position ? resetBtn(() => onPosition(null)) : <span className="w-5 shrink-0" />}
      </div>
      <p className="text-xs text-text-tertiary">
        Scale multiplies the base; Move offsets it (cm). Applied in <span className="capitalize">{state}</span>, restored on exit.
      </p>
    </section>
  );
}

function PropertyRow({ prop, value, onChange, overridden, onReset }: PropertyRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label
        className={`w-16 shrink-0 text-xs truncate ${overridden ? 'text-accent-400 font-medium' : 'text-text-secondary'}`}
        title={overridden ? `${prop.label} — overridden in this state` : prop.label}
      >
        {overridden ? '• ' : ''}{prop.label}
      </label>
      <div className="flex-1 min-w-0">
        <PropertyControl prop={prop} value={value} onChange={onChange} />
      </div>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to default (clear this state's override)"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-3"
        >
          ↺
        </button>
      )}
    </div>
  );
}

/** Corners as a compact 2×2 grid (TL TR / BL BR) instead of four full rows. */
function CornersGrid({
  props,
  node,
  onChange,
}: {
  props: PropertyDescriptor[];
  node: DesignNode;
  onChange: (id: string, key: string, v: unknown) => void;
}) {
  const byKey = (k: string) => props.find((p) => p.key === k);
  const cells: Array<[string, PropertyDescriptor | undefined]> = [
    ['TL', byKey('cornerTL')],
    ['TR', byKey('cornerTR')],
    ['BL', byKey('cornerBL')],
    ['BR', byKey('cornerBR')],
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {cells.map(([label, p]) =>
        p ? (
          <div key={p.key} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-[10px] text-text-tertiary">{label}</span>
            <NumberField
              value={typeof node.properties[p.key] === 'number' ? (node.properties[p.key] as number) : 0}
              min={p.min}
              max={p.max}
              step={p.step}
              onChange={(v) => onChange(node.id, p.key, v)}
              className={`flex-1 min-w-0 ${NUM_INPUT_CLS}`}
            />
          </div>
        ) : null,
      )}
    </div>
  );
}

function PropertyControl({ prop, value, onChange }: PropertyRowProps) {
  switch (prop.kind) {
    case 'number':
      return <NumberInput prop={prop} value={value} onChange={onChange} />;
    case 'string':
      return <StringInput prop={prop} value={value} onChange={onChange} />;
    case 'enum':
      return prop.style === 'toggle' ? (
        <EnumToggle prop={prop} value={value} onChange={onChange} />
      ) : (
        <EnumDropdown prop={prop} value={value} onChange={onChange} />
      );
    case 'vec2':
      return <Vec2Input value={value} onChange={onChange} />;
    case 'color':
      return <ColorInput value={value} onChange={onChange} />;
    case 'image':
      return <ImageInput value={value} onChange={onChange} />;
    case 'boolean':
      return <BooleanInput value={value} onChange={onChange} />;
    case 'font':
      return <FontInput prop={prop} value={value} onChange={onChange} />;
  }
}

function ImageInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const current = typeof value === 'string' ? value : '';
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(p: Promise<{ path: string }>): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const { path } = await p;
      onChange(path);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {current ? (
        <img
          src={bridgeImageUrl(current)}
          alt=""
          className="w-full h-16 object-contain rounded border border-border-subtle bg-bg-4"
        />
      ) : (
        <div className="w-full h-16 rounded border border-dashed border-border-subtle bg-bg-4 flex items-center justify-center text-xs text-text-tertiary">
          no image
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex-1 bg-bg-4 border border-border-subtle rounded px-2 py-1 text-sm text-text-primary hover:border-accent-500 disabled:opacity-50"
        >
          {busy ? '…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(ingestImageFile(f));
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={url}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && url) void run(ingestImageUrl(url)); }}
          className="flex-1 min-w-0 bg-bg-4 border border-border-subtle rounded px-2 py-1 text-sm font-num text-text-primary focus:border-accent-500 focus:outline-none"
          spellCheck={false}
        />
        <button
          type="button"
          disabled={busy || !url}
          onClick={() => void run(ingestImageUrl(url))}
          className="bg-bg-4 border border-border-subtle rounded px-2 py-1 text-sm text-text-primary hover:border-accent-500 disabled:opacity-50"
        >
          Load
        </button>
      </div>
      {err ? <div className="text-xs text-danger">{err}</div> : null}
    </div>
  );
}

function EnumToggle({ prop, value, onChange }: PropertyRowProps) {
  const v = typeof value === 'string' ? value : typeof prop.default === 'string' ? prop.default : '';
  const options = prop.options ?? [];
  return (
    <div className="flex gap-1 bg-bg-4 border border-border-subtle rounded p-0.5">
      {options.map((opt) => {
        const active = opt === v;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={
              'flex-1 px-2 py-0.5 text-xs rounded transition-colors ' +
              (active
                ? 'bg-accent-500 text-white'
                : 'text-text-secondary hover:bg-bg-3 hover:text-text-primary')
            }
            title={opt}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

const NUM_INPUT_CLS =
  'w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-base font-num text-text-primary focus:border-accent-500 focus:outline-none';

function NumberInput({ prop, value, onChange }: PropertyRowProps) {
  const n = typeof value === 'number' ? value : typeof prop.default === 'number' ? prop.default : 0;
  return (
    <NumberField value={n} onChange={(v) => onChange(v)} min={prop.min} max={prop.max} step={prop.step} className={NUM_INPUT_CLS} />
  );
}

function FontInput({ prop, value, onChange }: PropertyRowProps) {
  const customFonts = useDesignStore((s) => s.customFonts);
  const projectFontFiles = useDesignStore((s) => s.projectFontFiles);
  const addCustomFont = useDesignStore((s) => s.addCustomFont);
  const systemFonts = useDesignStore((s) => s.systemFonts);
  const send = useBridgeSend();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const builtins = prop.options ?? [];
  const v = typeof value === 'string' ? value : typeof prop.default === 'string' ? prop.default : '';

  // Available fonts = customFonts whose underlying file is confirmed
  // present in the LS project. Ghosts (file swept by GC, sandbox
  // changed) get dropped automatically — no more "I picked Impact but
  // nothing happened".
  const projectFileSet = new Set(projectFontFiles);
  const availableCustom = customFonts.filter((f) => {
    const base = f.path.split('/').pop();
    return base ? projectFileSet.has(base) : false;
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await ingestFontFile(file);
      const hash = r.path.match(/font_([a-z0-9]+)\./i)?.[1] ?? r.path.replace(/[^a-z0-9]/gi, '');
      const name = file.name.replace(/\.(ttf|otf)$/i, '');
      addCustomFont({ path: r.path, family: `ldfont-${hash}`, name });
      onChange(r.path);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function addFromSystem(font: { family: string; file: string }) {
    // Bridge ingests the file + replies `fonts.added`. useFontSync
    // catches that, adds to customFonts, refreshes the project list.
    // We optimistically select the new path once it lands; since
    // useFontSync writes to the store, the select will pick it up on
    // the next render after the round-trip. To make the selection
    // immediate, also subscribe here briefly:
    send({ type: 'fonts.add-from-system', systemPath: font.file, family: font.family });
    setPickerOpen(false);
    // Don't pre-select — useFontSync's `fonts.added` handler adds the
    // entry to customFonts under `name = msg.family`. We listen for
    // the matching custom-font appearance via a small effect:
    pendingSelectRef.current = font.family;
  }

  // Auto-select the freshly added font once it lands in customFonts.
  const pendingSelectRef = useRef<string | null>(null);
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    const match = customFonts.find((f) => f.name === pending);
    if (match) {
      onChange(match.path);
      pendingSelectRef.current = null;
    }
  }, [customFonts, onChange]);

  const cls =
    'w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-base text-text-primary focus:border-accent-500 focus:outline-none';
  return (
    <div className="space-y-1">
      <select value={v} onChange={(e) => onChange(e.target.value)} className={cls}>
        <optgroup label="Built-in">
          {builtins.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </optgroup>
        {availableCustom.length > 0 && (
          <optgroup label="In project">
            {availableCustom.map((f) => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy || systemFonts.length === 0}
          title={systemFonts.length === 0 ? 'No system fonts enumerated yet' : 'Browse fonts installed on this Mac'}
          className="flex-1 px-2 py-1 text-sm rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-3 disabled:opacity-50"
        >
          Add from system…
        </button>
        <input ref={fileRef} type="file" accept=".ttf,.otf" className="hidden" onChange={onFile} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Upload a .ttf or .otf file not installed on this Mac"
          className="px-2 py-1 text-sm rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-3 disabled:opacity-50"
        >
          {busy ? '…' : 'Upload'}
        </button>
      </div>
      {err && <div className="text-xs text-danger">{err}</div>}
      {pickerOpen && (
        <SystemFontPicker
          fonts={systemFonts}
          /** Skip fonts that are already added — distinguished by name
           *  match against the existing customFonts list. */
          excludeNames={new Set(availableCustom.map((f) => f.name))}
          onPick={addFromSystem}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

interface SystemFontPickerProps {
  fonts: Array<{ family: string; file: string; ext: 'ttf' | 'otf' }>;
  excludeNames: Set<string>;
  onPick: (font: { family: string; file: string }) => void;
  onClose: () => void;
}

/**
 * Map of system-font absolute path → registered CSS family name. Lives
 * at module scope (not state) so the same FontFace isn't registered
 * twice across picker opens. Once a font is added to `document.fonts`
 * it stays there for the document's lifetime.
 */
const loadedSystemFontFamilies = new Map<string, string>();

/** Stable CSS family name for a system font path. */
function systemFontCssFamily(absPath: string): string {
  // Hash the path so the CSS family name is filesystem-safe + collision-
  // free regardless of the original filename.
  let h = 0;
  for (let i = 0; i < absPath.length; i++) {
    h = ((h << 5) - h + absPath.charCodeAt(i)) | 0;
  }
  return `ldsysfont-${(h >>> 0).toString(36)}`;
}

function SystemFontPicker({ fonts, excludeNames, onPick, onClose }: SystemFontPickerProps) {
  const [query, setQuery] = useState('');
  // Bumped each time a new FontFace finishes loading, so the picker
  // re-renders the affected row with its real face.
  const [, setLoadedTick] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = fonts.filter((f) => {
    if (excludeNames.has(f.family)) return false;
    if (!q) return true;
    return f.family.toLowerCase().includes(q);
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add font from system"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-h-[70vh] bg-bg-2 border border-border-default rounded-lg shadow-2xl flex flex-col"
      >
        <div className="px-4 py-3 border-b border-border-subtle">
          <h2 className="m-0 mb-1 text-sm font-semibold text-text-primary">Add font from system</h2>
          <p className="m-0 text-[11px] text-text-secondary">
            {fonts.length} .ttf / .otf fonts found in your Mac's font directories. Picking one copies it into the Lens Studio project.
          </p>
        </div>
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          placeholder="Search…"
          className="mx-4 my-2 bg-bg-4 border border-border-subtle rounded px-2.5 py-1.5 text-[12px] text-text-primary focus:border-accent-500 focus:outline-none"
        />
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-text-tertiary">
              {q ? `No fonts match "${query}".` : 'All system fonts are already added.'}
            </div>
          ) : (
            filtered.map((f) => (
              <SystemFontRow
                key={f.file}
                font={f}
                onPick={() => onPick(f)}
                onLoaded={() => setLoadedTick((n) => n + 1)}
              />
            ))
          )}
        </div>
        <div className="px-4 py-3 border-t border-border-subtle flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-secondary border border-border-default rounded-md hover:bg-bg-3 hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface SystemFontRowProps {
  font: { family: string; file: string; ext: 'ttf' | 'otf' };
  onPick: () => void;
  onLoaded: () => void;
}

/**
 * One picker row. Lazy-registers a FontFace only when the row scrolls
 * into view — loading 243+ fonts eagerly would burn ~50MB of network
 * + decode work per picker open. IntersectionObserver fires once
 * per row, after which the FontFace is cached for the document
 * lifetime via `loadedSystemFontFamilies`.
 */
function SystemFontRow({ font, onPick, onLoaded }: SystemFontRowProps) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const cssFamily = systemFontCssFamily(font.file);
  const loaded = loadedSystemFontFamilies.has(font.file);

  useEffect(() => {
    if (loaded) return;
    const el = rowRef.current;
    if (!el) return;
    if (typeof document === 'undefined' || !document.fonts) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const face = new FontFace(cssFamily, `url(${bridgeSystemFontUrl(font.file)})`);
        face.load().then(
          () => {
            (document.fonts as unknown as { add: (f: FontFace) => void }).add(face);
            loadedSystemFontFamilies.set(font.file, cssFamily);
            onLoaded();
          },
          () => {
            // Font failed to load (bad file, permission, corrupted).
            // Mark as loaded-but-failed so we don't retry every render.
            loadedSystemFontFamilies.set(font.file, '');
            onLoaded();
          },
        );
      },
      { root: el.parentElement, rootMargin: '120px' }, // pre-fetch ~6 rows ahead
    );
    io.observe(el);
    return () => io.disconnect();
  }, [font.file, cssFamily, loaded, onLoaded]);

  const previewFamily = loaded ? loadedSystemFontFamilies.get(font.file) || undefined : undefined;
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onPick}
      className="w-full flex items-center justify-between text-left px-3 py-2 rounded hover:bg-bg-3 text-[15px] text-text-primary"
      style={previewFamily ? { fontFamily: `"${previewFamily}", system-ui, sans-serif` } : undefined}
    >
      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {font.family}
      </span>
      {/* Force the ext label back to the UI font so the row label is the
          only thing that previews in the actual face. */}
      <span
        className="ml-2 text-[10px] uppercase tracking-wider text-text-tertiary"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        {font.ext}
      </span>
    </button>
  );
}

function BooleanInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const checked = value === true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors ${
        checked ? 'bg-accent-500' : 'bg-bg-4 border border-border-subtle'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

function StringInput({ prop, value, onChange }: PropertyRowProps) {
  const s = typeof value === 'string' ? value : '';
  const cls =
    'w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-base text-text-primary focus:border-accent-500 focus:outline-none';
  if (prop.multiline) {
    return (
      <textarea
        value={s}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={`${cls} resize-y font-sans leading-snug`}
      />
    );
  }
  return (
    <input
      type="text"
      value={s}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  );
}

function EnumDropdown({ prop, value, onChange }: PropertyRowProps) {
  const v = typeof value === 'string' ? value : typeof prop.default === 'string' ? prop.default : '';
  const options = prop.options ?? [];
  return (
    <select
      value={v}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-base text-text-primary focus:border-accent-500 focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function Vec2Input({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const def = { x: 0, y: 0 };
  const v = typeof value === 'object' && value !== null
    ? { x: Number((value as { x?: number }).x ?? def.x), y: Number((value as { y?: number }).y ?? def.y) }
    : def;
  return (
    <div className="flex gap-2">
      <NumberField value={v.x} onChange={(x) => onChange({ ...v, x })} className={`w-1/2 ${NUM_INPUT_CLS}`} />
      <NumberField value={v.y} onChange={(y) => onChange({ ...v, y })} className={`w-1/2 ${NUM_INPUT_CLS}`} />
    </div>
  );
}

function ColorInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const def: RgbaColor = { r: 255, g: 255, b: 255, a: 100 };
  const c: RgbaColor = typeof value === 'object' && value !== null
    ? {
        r: Number((value as { r?: number }).r ?? def.r),
        g: Number((value as { g?: number }).g ?? def.g),
        b: Number((value as { b?: number }).b ?? def.b),
        a: Number((value as { a?: number }).a ?? def.a),
      }
    : def;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-bg-4 border border-border-subtle rounded px-2 py-1 text-base text-text-primary hover:border-accent-500 focus:border-accent-500 focus:outline-none"
      >
        <span
          className="w-4 h-4 rounded border border-border-subtle flex-shrink-0"
          style={
            c.a < 100
              ? {
                  backgroundImage: `linear-gradient(rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 100}), rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 100})), conic-gradient(#666 0 25%, #aaa 0 50%, #666 0 75%, #aaa 0)`,
                  backgroundSize: '100%, 6px 6px',
                }
              : { backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }
          }
          aria-hidden
        />
        <span className="font-num text-sm">
          #{c.r.toString(16).padStart(2, '0').toUpperCase()}
          {c.g.toString(16).padStart(2, '0').toUpperCase()}
          {c.b.toString(16).padStart(2, '0').toUpperCase()}
          {c.a < 100 ? ` · ${c.a}%` : ''}
        </span>
      </button>
      {open ? (
        <ColorPicker
          value={c}
          onChange={(next) => onChange(next)}
          onClose={() => setOpen(false)}
          anchorRef={buttonRef}
        />
      ) : null}
    </div>
  );
}


/** Inspector panel for a shared-component INSTANCE (design tab only). Shows
 *  placement, the definition's bound slots as per-instance overrides (clear a
 *  field to fall back to the definition's value), an actionKey override when
 *  the definition root is interactive, and the parent-controller binding. */
function InstanceInspector({ node }: { node: DesignNode }) {
  const renameNode = useDesignStore((s) => s.renameNode);
  const updateProp = useDesignStore((s) => s.updateProp);
  const setInstanceOverride = useDesignStore((s) => s.setInstanceOverride);
  const setInstanceActionKey = useDesignStore((s) => s.setInstanceActionKey);
  const defs = useDefinitions((s) => s.defs);
  const entry = node.instance ? defs[node.instance.of] : undefined;
  const defRoot = defRootNode(entry);
  const slots = node.instance?.overrides?.slots ?? {};

  // The definition's bound slots (Text + Image only — the v1 override set).
  const defSlots: Array<{ key: string; type: string; defValue: string }> = [];
  const collect = (nodes: DesignNode[]): void => {
    for (const n of nodes) {
      if (n.binding && (n.type === 'Text' || n.type === 'Image')) {
        const dv = n.type === 'Text' ? n.properties['text'] : n.properties['imageSource'];
        defSlots.push({ key: n.binding.key, type: n.type, defValue: typeof dv === 'string' ? dv : '' });
      }
      collect(n.children);
    }
  };
  if (defRoot) collect(defRoot.children);

  const pos = (node.properties['position'] as { x?: number; y?: number } | undefined) ?? {};
  const px = typeof pos.x === 'number' ? pos.x : 0;
  const py = typeof pos.y === 'number' ? pos.y : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent-400" title={`id ${node.id.slice(0, 8)}…`}>
          Component
        </span>
        <div className="flex-1 min-w-0">
          <NameField key={node.id} name={node.name} onRename={(n) => renameNode(node.id, n)} />
        </div>
      </div>

      <section className="space-y-1.5">
        <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Instance of</header>
        <p className="m-0 text-sm text-text-primary font-medium">{entry?.codeName ?? '(loading…)'}</p>
        <p className="m-0 text-xs text-text-tertiary">
          Edit the original view to change every instance. This panel only overrides
          this instance's content.
        </p>
      </section>

      <section className="space-y-1.5">
        <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Position</header>
        <div className="flex gap-2">
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis} className="flex-1">
              <span className="text-xs text-text-tertiary uppercase">{axis}</span>
              <input
                type="number"
                value={axis === 'x' ? px : py}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    updateProp(node.id, 'position', axis === 'x' ? { x: v, y: py } : { x: px, y: v });
                  }
                }}
                className="w-full mt-0.5 bg-bg-4 border border-border-subtle rounded px-2 py-1 text-base text-text-primary focus:border-accent-500 focus:outline-none"
              />
            </label>
          ))}
        </div>
      </section>

      {defSlots.length > 0 && (
        <section className="space-y-1.5">
          <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Slot overrides</header>
          {defSlots.map((sl) => {
            const overridden = Object.prototype.hasOwnProperty.call(slots, sl.key);
            const current = overridden ? String(slots[sl.key] ?? '') : '';
            return (
              <label key={sl.key} className="block">
                <span className="text-sm text-text-secondary">
                  {sl.key} <span className="text-text-tertiary text-xs">({sl.type})</span>
                </span>
                <DraftField
                  key={`io-${node.id}-${sl.key}-${overridden}`}
                  value={current}
                  placeholder={sl.defValue || '(definition value)'}
                  onCommit={(v) =>
                    setInstanceOverride(node.id, sl.key, v.trim() === '' ? undefined : v)
                  }
                />
              </label>
            );
          })}
          <span className="text-xs text-text-tertiary">
            Empty = use the definition's value. Image slots take a project image path.
          </span>
        </section>
      )}

      {defRoot?.interaction && (
        <section className="space-y-1.5">
          <header className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Interaction</header>
          <label className="block">
            <span className="text-sm text-text-secondary">action key override</span>
            <DraftField
              key={`ak-${node.id}`}
              value={node.instance?.overrides?.actionKey ?? ''}
              placeholder={defRoot.interaction.actionKey ?? '(definition value)'}
              onCommit={(v) => setInstanceActionKey(node.id, v.trim() === '' ? undefined : v.trim())}
            />
          </label>
        </section>
      )}

      <CodeBindingSection node={node} />
    </div>
  );
}
