// Controller codegen — renders a ViewManifest into a Lens Studio TypeScript
// component the lens author codes against (v1b: handle-based API, TD-2/TD-3).
//
// Conventions mirror the platform (so there's nothing new to learn):
//   - visual values are PROPERTIES (item.title.text =, item.bg.fill.color =)
//   - async ops are METHODS (item.cover.setImageUrl(url))
//   - interaction is SIK-style .add() events (item.onPinch.add(cb)), with the
//     30-frame deferred-bind absorbed (events aren't ready on frame 1)
//   - item.disabled is the only code-driven state; hover/pinch auto-apply
//
// Interactivity is attached at RUNTIME (createComponent), so the exported prefab
// carries no SIK UUID refs and works with any compatible SIK install (see
// reference_runtime_attach_sik_version_agnostic). Per-state appearance is baked
// from the resolveLSWrites override table (shared with the applier — TD-8) and
// applied per SIK state. Per-instance recolor CLONES the node's material on
// awake (`img.mainMaterial = img.mainMaterial.clone()`) and writes
// `mainMaterial.mainPass.<prop>` — there is no auto-created `mainPassOverrides`
// on LS 5.15.4 (verified against the runtime API 2026-05-30: you must own a
// material, or build a PassPropertyOverrides; cloning gives both the per-instance
// isolation TD-9 needs and a live mainPass). applyState writes the effective
// (override-or-captured-base) value per channel so state transitions reverse.
//
// Output is LS-flavored TS validated by the LS compile, not the bridge's tsc.

import type { ViewManifest, InteractiveRef, OverrideTarget, StateWrites, HugGroupRef } from './extract.ts';
import type { InteractionRole } from '../protocol.ts';
import type { LSWrite, Vec2Like } from '../resolve-writes.ts';

const ROLE_IMPORT: Record<InteractionRole, { cls: string; path: string }> = {
  button: { cls: 'PinchButton', path: 'SpectaclesInteractionKit.lspkg/Components/UI/PinchButton/PinchButton' },
  toggle: { cls: 'ToggleButton', path: 'SpectaclesInteractionKit.lspkg/Components/UI/ToggleButton/ToggleButton' },
  draggable: {
    cls: 'InteractableManipulation',
    path: 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation',
  },
};

/** View name → TS class identifier (dashes → PascalCase segments). */
export function viewClassName(name: string): string {
  if (!name.includes('-')) return name;
  return name
    .split('-')
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function pathLit(path: number[]): string {
  return `[${path.join(', ')}]`;
}

function vec4Lit(v: unknown): string {
  const c = v as { x: number; y: number; z: number; w: number };
  const f = (n: number) => Number(n.toFixed(4));
  return `new vec4(${f(c.x)}, ${f(c.y)}, ${f(c.z)}, ${f(c.w)})`;
}

function vec2Lit(v: Vec2Like): string {
  const f = (n: number) => Number(n.toFixed(4));
  return `new vec2(${f(v.x)}, ${f(v.y)})`;
}

/** The handle class name for a slot's primitive type. */
function handleType(nodeType: string): string {
  switch (nodeType) {
    case 'Text':
      return 'LDTextHandle';
    case 'Image':
      return 'LDImageHandle';
    case 'Rectangle':
    case 'Ellipse':
    case 'Polygon':
      return 'LDShapeHandle';
    default:
      return 'LDNodeHandle';
  }
}

/** Render one StateWrites into a JS object literal the runtime applier reads. */
function stateWritesLit(s: StateWrites): string {
  const writes = s.writes
    .map((w: LSWrite) => {
      const val = w.valueType === 'vec4' ? vec4Lit(w.value) : JSON.stringify(w.value);
      return `{ channel: '${w.channel}', value: ${val} }`;
    })
    .join(', ');
  const parts = [`writes: [${writes}]`];
  if (s.position) parts.push(`position: ${vec2Lit(s.position)}`);
  if (s.scale) parts.push(`scale: ${vec2Lit(s.scale)}`);
  return `{ ${parts.join(', ')} }`;
}

/** Render one override target into a literal: { path, states: { hover, … } }. */
function overrideTargetLit(t: OverrideTarget): string {
  const states: string[] = [];
  if (t.hover) states.push(`hover: ${stateWritesLit(t.hover)}`);
  if (t.pinched) states.push(`pinched: ${stateWritesLit(t.pinched)}`);
  if (t.disabled) states.push(`disabled: ${stateWritesLit(t.disabled)}`);
  return `{ path: ${pathLit(t.path)}, states: { ${states.join(', ')} } }`;
}

/** The View root, if it's interactive (the common case — events on the controller). */
function rootInteractive(view: ViewManifest): InteractiveRef | undefined {
  return view.interactives.find((i) => i.path.length === 0);
}

/** Human-readable notes for the class doc-comment (states aren't "magic"). */
function describeTarget(t: OverrideTarget): string[] {
  const out: string[] = [];
  const at = `[${t.path.join('.')}]`;
  for (const state of ['hover', 'pinched', 'disabled'] as const) {
    const s = t[state];
    if (!s) continue;
    const bits: string[] = s.writes.map((w) => w.channel);
    if (s.position) bits.push('move');
    if (s.scale) bits.push('scale');
    if (bits.length > 0) out.push(`${state}: ${at} → ${bits.join(', ')}`);
  }
  return out;
}

/** Render a hug group into the runtime spec literal LDLayout consumes. */
function hugSpecLit(g: HugGroupRef): string {
  const kids = g.children
    .map((c) => `{ path: ${pathLit(c.path)}, fill: ${c.fill}, isText: ${c.isText} }`)
    .join(', ');
  return `{ path: ${pathLit(g.path)}, mode: '${g.mode}', spacing: ${g.spacing}, padX: ${g.padding.x}, padY: ${g.padding.y}, children: [${kids}] }`;
}

/** Render one View's controller class to LS TypeScript source. */
export function generateController(view: ViewManifest): string {
  const L: string[] = [];
  const root = rootInteractive(view);
  const usedRoles = new Set<InteractionRole>(view.interactives.map((i) => i.role));
  const className = viewClassName(view.name);
  const hasInteractive = view.interactives.length > 0;
  // Shared-component instance slots become typed child-controller getters;
  // everything else stays a constructed LD*Handle.
  const handleSlots = view.slots.filter((s) => s.nodeType !== 'Instance');
  const instanceSlots = view.slots.filter(
    (s): s is typeof s & { viewClass: string } => s.nodeType === 'Instance' && !!s.viewClass,
  );
  const hasImage = handleSlots.some((s) => s.nodeType === 'Image');
  const hasHug = view.hugGroups.length > 0;

  L.push('// Generated by Lens Designer — do not edit by hand. Regenerated on export.');
  // The interaction runtime (LDInteractive) is ALWAYS emitted and references
  // Interactable, so import it unconditionally — a display-only view (no
  // interactions) would otherwise reference Interactable with no import (TS2304).
  // Role components (PinchButton, …) are only wired when an interaction uses them,
  // so those imports stay conditional.
  L.push(`import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';`);
  if (hasInteractive) {
    for (const role of usedRoles) {
      const r = ROLE_IMPORT[role];
      L.push(`import { ${r.cls} } from '${r.path}';`);
    }
  }
  // Shared-component child controllers live in the same generated folder.
  for (const cls of [...new Set(instanceSlots.map((s) => s.viewClass))]) {
    if (cls !== className) L.push(`import { ${cls} } from './${cls}';`);
  }
  L.push('');

  const overrideNotes = view.interactives.flatMap((i) => i.overrideTargets).flatMap(describeTarget);
  if (overrideNotes.length > 0) {
    L.push('/**');
    L.push(` * ${className} — generated controller. Authored per-state behavior:`);
    for (const n of overrideNotes) L.push(` *   ${n}`);
    L.push(' */');
  }
  L.push('@component');
  L.push(`export class ${className} extends BaseScriptComponent {`);

  for (const s of handleSlots) {
    L.push(`  // slot: ${s.key} (${s.nodeType})`);
    L.push(`  ${s.key}!: ${handleType(s.nodeType)};`);
  }
  for (const s of instanceSlots) {
    L.push(`  // slot: ${s.key} (component instance of ${s.viewClass})`);
    L.push(`  // Lazy: the child controller awakens on its own a frame or two after`);
    L.push(`  // spawn — null until then (use LensDesigner.whenReady to gate).`);
    L.push(`  get ${s.key}(): ${s.viewClass} | null {`);
    L.push(`    const so = getChildByPath(this.getSceneObject(), ${pathLit(s.path)});`);
    L.push(`    if (!so) return null;`);
    L.push(`    return so.getComponent(${s.viewClass}.getTypeName() as any) as unknown as ${s.viewClass} | null;`);
    L.push('  }');
  }
  if (hasImage) {
    L.push('  private _im: unknown = null;');
    L.push('  private _rmm: unknown = null;');
    L.push('  // Provide the InternetModule + RemoteMediaModule before calling setImageUrl().');
    L.push('  init(internetModule: unknown, remoteMediaModule: unknown): void {');
    L.push('    this._im = internetModule; this._rmm = remoteMediaModule;');
    L.push('  }');
  }
  if (root) {
    L.push('  private _root: LDInteractive = new LDInteractive();');
    L.push('  get onPinch() { return this._root.onPinch; }');
    L.push('  get onPinchEnd() { return this._root.onPinchEnd; }');
    L.push('  get onPinchCancel() { return this._root.onPinchCancel; }');
    L.push('  get onPinchEndOutside() { return this._root.onPinchEndOutside; }');
    L.push('  get onHoverEnter() { return this._root.onHoverEnter; }');
    L.push('  get onHoverExit() { return this._root.onHoverExit; }');
    if (root.role === 'toggle') L.push('  get onToggle() { return this._root.onToggle; }');
    L.push('  set disabled(v: boolean) { this._root.setDisabled(v); }');
  }
  if (hasHug) {
    L.push('  private _layout: LDLayout | null = null;');
    L.push('  // Re-flow hug groups when content changes (text setters call this).');
    L.push('  private _reflow(): void { if (this._layout) this._layout.relayout(); }');
  }
  L.push('');

  L.push('  onAwake(): void {');
  L.push('    const root = this.getSceneObject();');
  for (const s of handleSlots) {
    // Text slots take a reflow callback so setting text re-hugs the pill.
    const extra =
      s.nodeType === 'Image'
        ? ', () => this._im, () => this._rmm'
        : s.nodeType === 'Text' && hasHug
          ? ', () => this._reflow()'
          : '';
    L.push(`    this.${s.key} = new ${handleType(s.nodeType)}(getChildByPath(root, ${pathLit(s.path)})${extra});`);
  }
  let tmp = 0;
  for (const i of view.interactives) {
    const objVar = `_o${tmp++}`;
    L.push(`    const ${objVar} = getChildByPath(root, ${pathLit(i.path)});`);
    L.push(`    if (${objVar}) {`);
    const overridesLit = `[${i.overrideTargets.map(overrideTargetLit).join(', ')}]`;
    const owner = i.path.length === 0 ? 'this._root' : 'new LDInteractive()';
    const r = ROLE_IMPORT[i.role];
    // Base Interactable FIRST — SIK role components (PinchButton/ToggleButton)
    // require an Interactable on the same SceneObject and validate for it on
    // awake. Then the role component, then wire (which reads the Interactable's
    // events).
    // Reuse SIK if it's already on the object (the designer attaches preview
    // Interactable/role for the live edit surface) so we don't double up at
    // runtime; create it only when absent (clean exported prefab).
    // SIK resolves an Interactable's collider EAGERLY on awake; with none in
    // the hierarchy it spawns a tiny temporary collider and the hit area
    // collapses to a child (e.g. just the text). Create a correctly-sized box
    // collider FIRST so SIK adopts it.
    L.push(`      ensureHitCollider(${objVar});`);
    L.push(`      if (!${objVar}.getComponent(Interactable.getTypeName())) ${objVar}.createComponent(Interactable.getTypeName());`);
    L.push(`      if (!${objVar}.getComponent(${r.cls}.getTypeName())) ${objVar}.createComponent(${r.cls}.getTypeName());`);
    L.push(`      ${owner}.wire(this, ${objVar}, root, ${overridesLit});`);
    L.push('    }');
  }
  if (hasHug) {
    const specs = view.hugGroups.map(hugSpecLit).join(', ');
    L.push(`    this._layout = new LDLayout(this, root, [${specs}]);`);
  }
  L.push('  }');
  L.push('}');
  L.push('');
  L.push(runtimePreamble(hasImage, hasHug));
  return L.join('\n');
}

/** The runtime helpers, emitted once per controller (inlined so the export
 *  bundle needs no extra asset). LS-flavored TS. */
function runtimePreamble(hasImage: boolean, hasHug: boolean): string {
  return `function getChildByPath(root: SceneObject, path: number[]): SceneObject | null {
  let cur: SceneObject | null = root;
  for (let i = 0; i < path.length; i++) {
    if (!cur || path[i] >= cur.getChildrenCount()) return null;
    cur = cur.getChild(path[i]);
  }
  return cur;
}

// Give an interactive object a hit collider sized to its content. SIK resolves
// an Interactable's collider eagerly on awake and, finding none, makes a tiny
// temporary one (hit area collapses to a child). We size a box to the union of
// the object's children's bounds (or its own scale if it's a leaf), centered at
// the object origin, with a few cm of depth so the pinch ray has volume to hit.
// Idempotent + runtime-only, so re-instantiation and reconcile never duplicate.
function ensureHitCollider(o: SceneObject): void {
  if (o.getComponent('Physics.ColliderComponent')) return;
  let halfW = 0; let halfH = 0;
  const n = o.getChildrenCount();
  if (n === 0) {
    const s = o.getTransform().getLocalScale();
    halfW = Math.abs(s.x) / 2; halfH = Math.abs(s.y) / 2;
  } else {
    for (let i = 0; i < n; i++) {
      const tr = o.getChild(i).getTransform();
      const s = tr.getLocalScale(); const p = tr.getLocalPosition();
      halfW = Math.max(halfW, Math.abs(p.x) + Math.abs(s.x) / 2);
      halfH = Math.max(halfH, Math.abs(p.y) + Math.abs(s.y) / 2);
    }
  }
  if (halfW <= 0) halfW = 1;
  if (halfH <= 0) halfH = 1;
  const col: any = o.createComponent('Physics.ColliderComponent');
  const box = Shape.createBoxShape();
  box.size = new vec3(halfW * 2, halfH * 2, 2);
  col.shape = box;
}

// Minimal SIK-shaped event (.add → unsubscribe), queuing callbacks added before
// the underlying SIK event binds.
class LDEvent<T> {
  private cbs: ((a: T) => void)[] = [];
  add(cb: (a: T) => void): () => void { this.cbs.push(cb); return () => this.remove(cb); }
  remove(cb: (a: T) => void): void { const i = this.cbs.indexOf(cb); if (i >= 0) this.cbs.splice(i, 1); }
  fire(a: T): void { for (let i = 0; i < this.cbs.length; i++) this.cbs[i](a); }
}

interface LDStateWrite { channel: string; value: unknown; }
interface LDStateProps { writes: LDStateWrite[]; position?: vec2; scale?: vec2; }
interface LDTarget { path: number[]; states: { hover?: LDStateProps; pinched?: LDStateProps; disabled?: LDStateProps }; }

function ldImage(o: SceneObject): any { return o.getComponent('Component.Image'); }
function ldText(o: SceneObject): any { return o.getComponent('Component.Text'); }
function ldVec4(c: any): vec4 { return new vec4(c.x, c.y, c.z, c.w); }

// Clone a visual's material in place so per-instance pass writes don't leak to
// other clones sharing the asset (TD-9), AND so mainPass.<prop> writes take at
// all (there is no auto-created mainPassOverrides on LS 5.15.4 — you must own the
// material). IDEMPOTENT per object: a node that is both a bound slot (its handle)
// and a state target must share ONE clone, or the second clone wins as the
// assigned material and the first's writes (e.g. a code-set fill color) go to an
// orphan. Cached by SceneObject. Returns the cloned material (live mainPass) or null.
const ldMatCache: any = new Map();
function ldOwnMaterial(o: SceneObject | null): any {
  if (!o) return null;
  const cached = ldMatCache.get(o);
  if (cached) return cached;
  const img = ldImage(o);
  if (!img || !img.mainMaterial) return null;
  const m = img.mainMaterial.clone();
  img.mainMaterial = m;
  ldMatCache.set(o, m);
  return m;
}

// A resolved per-element state target. Shares the object's cloned material with
// its slot handle (ldOwnMaterial is idempotent), so a code-set fill/stroke and a
// state override land on the same material. The "base" each override reverts to
// is the LIVE value when the override begins (snapshotted on enter, restored on
// exit) — NOT an onAwake snapshot — so a value set from code (e.g.
// item.background.fill.color = ...) survives hover/pinch instead of being reset.
// Only the channels/transforms some state actually overrides are managed; channels
// (and position/scale) no state touches are left entirely to code/scene.
class LDStateTarget {
  private o: SceneObject;
  private mat: any = null;
  private states: LDTarget['states'];
  private chans: string[] = [];
  private usesPos = false;
  private usesScale = false;
  private inOverride = false;
  private saved: { [ch: string]: unknown } = {};
  private savedPos: vec3 | null = null;
  private savedScale: vec3 | null = null;

  constructor(o: SceneObject, t: LDTarget) {
    this.o = o;
    this.states = t.states;
    const seen: { [ch: string]: boolean } = {};
    let needsMat = false;
    const all = [t.states.hover, t.states.pinched, t.states.disabled];
    for (let i = 0; i < all.length; i++) {
      const sp = all[i];
      if (!sp) continue;
      if (sp.position) this.usesPos = true;
      if (sp.scale) this.usesScale = true;
      for (let j = 0; j < sp.writes.length; j++) {
        const ch = sp.writes[j].channel;
        if (!seen[ch]) { seen[ch] = true; this.chans.push(ch); }
        if (ch === 'fill' || ch === 'stroke' || ch === 'strokeThickness') needsMat = true;
      }
    }
    if (needsMat) this.mat = ldOwnMaterial(o);
  }

  private capture(ch: string): unknown {
    if (ch === 'visible') return this.o.enabled;
    if (ch === 'textColor') { const t = ldText(this.o); return t ? ldVec4(t.textFill.color) : null; }
    if (this.mat) {
      if (ch === 'fill') return ldVec4(this.mat.mainPass.baseColor);
      if (ch === 'stroke') return ldVec4(this.mat.mainPass.strokeColor);
      if (ch === 'strokeThickness') return this.mat.mainPass.strokeThickness;
    }
    return null;
  }

  private write(ch: string, value: unknown): void {
    if (value === null || value === undefined) return;
    if (ch === 'visible') { this.o.enabled = value as boolean; return; }
    if (ch === 'textColor') { const t = ldText(this.o); if (t) t.textFill.color = value as vec4; return; }
    if (!this.mat) return;
    if (ch === 'fill') this.mat.mainPass.baseColor = value as vec4;
    else if (ch === 'stroke') this.mat.mainPass.strokeColor = value as vec4;
    else if (ch === 'strokeThickness') this.mat.mainPass.strokeThickness = value as number;
  }

  // Snapshot the live values (whatever code/scene last set) as the base to
  // restore when the override ends.
  private saveCurrent(): void {
    for (let i = 0; i < this.chans.length; i++) this.saved[this.chans[i]] = this.capture(this.chans[i]);
    const tr = this.o.getTransform();
    if (this.usesPos) this.savedPos = tr.getLocalPosition();
    if (this.usesScale) this.savedScale = tr.getLocalScale();
  }

  apply(state: string): void {
    const sp = state === 'hover' ? this.states.hover
      : state === 'pinched' ? this.states.pinched
      : state === 'disabled' ? this.states.disabled
      : undefined;
    if (sp) {
      if (!this.inOverride) { this.saveCurrent(); this.inOverride = true; }
      const ov: { [ch: string]: unknown } = {};
      for (let j = 0; j < sp.writes.length; j++) ov[sp.writes[j].channel] = sp.writes[j].value;
      for (let i = 0; i < this.chans.length; i++) {
        const ch = this.chans[i];
        this.write(ch, (ch in ov) ? ov[ch] : this.saved[ch]);
      }
      const tr = this.o.getTransform();
      if (this.usesPos && this.savedPos) tr.setLocalPosition(sp.position ? new vec3(this.savedPos.x + sp.position.x, this.savedPos.y + sp.position.y, this.savedPos.z) : this.savedPos);
      if (this.usesScale && this.savedScale) tr.setLocalScale(sp.scale ? new vec3(this.savedScale.x * sp.scale.x, this.savedScale.y * sp.scale.y, this.savedScale.z) : this.savedScale);
    } else if (this.inOverride) {
      // Returning to default: restore the snapshot taken when the override began.
      // If we were never in an override, leave everything as code/scene set it.
      for (let i = 0; i < this.chans.length; i++) this.write(this.chans[i], this.saved[this.chans[i]]);
      const tr = this.o.getTransform();
      if (this.usesPos && this.savedPos) tr.setLocalPosition(this.savedPos);
      if (this.usesScale && this.savedScale) tr.setLocalScale(this.savedScale);
      this.inOverride = false;
    }
  }
}

// Per-element interactivity + state apply. Builds reversible state targets, then
// binds SIK events once the Interactable is live (deferred up to 30 frames).
class LDInteractive {
  onPinch = new LDEvent<void>();
  onPinchEnd = new LDEvent<void>();
  onPinchCancel = new LDEvent<void>();
  onPinchEndOutside = new LDEvent<void>();
  onHoverEnter = new LDEvent<void>();
  onHoverExit = new LDEvent<void>();
  onToggle = new LDEvent<boolean>();

  private targets: LDStateTarget[] = [];
  private disabled = false;
  private it: any = null;

  wire(owner: BaseScriptComponent, obj: SceneObject, root: SceneObject, overrides: LDTarget[]): void {
    for (let i = 0; i < overrides.length; i++) {
      const t = overrides[i];
      const o = getChildByPath(root, t.path);
      if (!o) continue;
      this.targets.push(new LDStateTarget(o, t));
    }
    this.applyState('default');
    let attempts = 0;
    const ev = owner.createEvent('UpdateEvent');
    ev.bind(() => {
      attempts++;
      const it = obj.getComponent(Interactable.getTypeName()) as any;
      if (it && it.onHoverEnter && it.onTriggerStart) {
        this.it = it;
        if (this.disabled) it.enabled = false; // disabled() may have run before bind

        it.onHoverEnter.add((e: any) => { this.onHoverEnter.fire(); if (!this.disabled) this.applyState(e.interactor && e.interactor.isTriggering ? 'pinched' : 'hover'); });
        it.onHoverExit.add(() => { this.onHoverExit.fire(); if (!this.disabled) this.applyState('default'); });
        it.onTriggerStart.add(() => { this.onPinch.fire(); if (!this.disabled) this.applyState('pinched'); });
        it.onTriggerEnd.add(() => { this.onPinchEnd.fire(); if (!this.disabled) this.applyState('hover'); });
        it.onTriggerCanceled.add(() => { this.onPinchCancel.fire(); if (!this.disabled) this.applyState('default'); });
        it.onTriggerEndOutside.add(() => { this.onPinchEndOutside.fire(); if (!this.disabled) this.applyState('default'); });
        ev.enabled = false;
      } else if (attempts > 30) {
        ev.enabled = false;
      }
    });
  }

  setDisabled(v: boolean): void {
    this.disabled = v;
    if (this.it) this.it.enabled = !v; // a disabled button is non-interactive, not just dimmed
    this.applyState(v ? 'disabled' : 'default');
  }

  private applyState(state: string): void {
    for (let i = 0; i < this.targets.length; i++) this.targets[i].apply(state);
  }
}

// --- Slot handles (visual values are properties; matches LS component idioms) ---
class LDNodeHandle {
  constructor(protected o: SceneObject | null) {}
  set visible(v: boolean) { if (this.o) this.o.enabled = v; }
  get visible(): boolean { return this.o ? this.o.enabled : false; }
}
class LDTextHandle extends LDNodeHandle {
  constructor(o: SceneObject | null, private onChange?: () => void) { super(o); }
  set text(s: string) { if (this.o) { const t = ldText(this.o); if (t) t.text = s; } if (this.onChange) this.onChange(); }
  get text(): string { if (this.o) { const t = ldText(this.o); if (t) return t.text; } return ''; }
  set color(c: vec4) { if (this.o) { const t = ldText(this.o); if (t) t.textFill.color = c; } }
}
class LDFill { constructor(private mat: any) {} set color(c: vec4) { if (this.mat) this.mat.mainPass.baseColor = c; } }
class LDStroke {
  constructor(private mat: any) {}
  set color(c: vec4) { if (this.mat) this.mat.mainPass.strokeColor = c; }
  set thickness(n: number) { if (this.mat) this.mat.mainPass.strokeThickness = n; }
}
class LDShapeHandle extends LDNodeHandle {
  readonly fill: LDFill;
  readonly stroke: LDStroke;
  // Clone once; fill + stroke share the owned material (cloning per-sub-handle
  // would leave fill writing to an orphan clone that's never assigned back).
  constructor(o: SceneObject | null) { super(o); const mat = ldOwnMaterial(o); this.fill = new LDFill(mat); this.stroke = new LDStroke(mat); }
}${hasImage ? '\n' + IMAGE_LOADER : ''}${hasHug ? '\n' + HUG_RUNTIME : ''}`;
}

// Runtime hug re-layout (WB-L). Mirrors the bridge's computeHugLayout solver,
// inlined so the exported controller needs no import. On content change (a Text
// setter), re-measures content children via Text.getBoundingBox (deferred-
// measure gotcha: the box reads 0 the frame after text=, so retry up to 4
// frames) + re-flows: content children to their positions, a fill child to the
// hugged size.
const HUG_RUNTIME = `interface LDHugChild { path: number[]; fill: boolean; isText: boolean; }
interface LDHugSpec { path: number[]; mode: string; spacing: number; padX: number; padY: number; children: LDHugChild[]; }

class LDLayout {
  private owner: BaseScriptComponent;
  private root: SceneObject;
  private specs: LDHugSpec[];
  constructor(owner: BaseScriptComponent, root: SceneObject, specs: LDHugSpec[]) {
    this.owner = owner; this.root = root; this.specs = specs;
    this.relayout();
  }
  relayout(): void {
    let attempts = 0;
    const ev = this.owner.createEvent('DelayedCallbackEvent');
    ev.bind(() => {
      attempts++;
      let allMeasured = true;
      for (let i = 0; i < this.specs.length; i++) { if (!this.flow(this.specs[i])) allMeasured = false; }
      if (!allMeasured && attempts < 4) ev.reset(0);
    });
    ev.reset(0);
  }
  private flow(spec: LDHugSpec): boolean {
    const sos: (SceneObject | null)[] = [];
    const ws: number[] = []; const hs: number[] = [];
    let measured = true;
    for (let i = 0; i < spec.children.length; i++) {
      const c = spec.children[i];
      const so = getChildByPath(this.root, c.path);
      sos.push(so);
      if (c.fill || !so) { ws.push(0); hs.push(0); continue; }
      if (c.isText) {
        const t = so.getComponent('Component.Text') as any;
        if (t && t.getBoundingBox) {
          const bb = t.getBoundingBox();
          const w = bb.right - bb.left; const h = bb.top - bb.bottom;
          ws.push(w); hs.push(h);
          if (w <= 0) measured = false;
          continue;
        }
      }
      const s = so.getTransform().getLocalScale();
      ws.push(s.x); hs.push(s.y);
    }
    const isRow = spec.mode === 'row';
    let along = 0; let cross = 0; let n = 0;
    for (let i = 0; i < spec.children.length; i++) {
      if (spec.children[i].fill) continue;
      const a = isRow ? ws[i] : hs[i]; const cr = isRow ? hs[i] : ws[i];
      if (n > 0) along += spec.spacing;
      along += a; if (cr > cross) cross = cr; n++;
    }
    const groupW = (isRow ? along : cross) + 2 * spec.padX;
    const groupH = (isRow ? cross : along) + 2 * spec.padY;
    let cursor = -along / 2;
    for (let i = 0; i < spec.children.length; i++) {
      const so = sos[i]; if (!so) continue;
      const tr = so.getTransform(); const p = tr.getLocalPosition();
      if (spec.children[i].fill) {
        tr.setLocalPosition(new vec3(0, 0, p.z));
        tr.setLocalScale(new vec3(groupW, groupH, 1));
        // Match the RoundedRect SDF box to the new size so corners don't stretch.
        const img = ldImage(so);
        if (img && img.mainMaterial && img.mainMaterial.mainPass) {
          img.mainMaterial.mainPass.boxSize = new vec2(groupW, groupH);
        }
        continue;
      }
      const a = isRow ? ws[i] : hs[i];
      const centerAlong = cursor + a / 2;
      cursor += a + spec.spacing;
      if (isRow) tr.setLocalPosition(new vec3(centerAlong, p.y, p.z));
      else tr.setLocalPosition(new vec3(p.x, -centerAlong, p.z));
    }
    return measured;
  }
}`;

const IMAGE_LOADER = `class LDImageHandle extends LDNodeHandle {
  private mat: any;
  constructor(o: SceneObject | null, private im: () => any, private rmm: () => any) { super(o); this.mat = ldOwnMaterial(o); }
  // The LD_Image material's texture uniform is baseTexture (matches the
  // applier's passInfos.0.baseTexture). The cloned material inherits the
  // template's texScale/texOffset (1,1)/(1,1), which maps UV to [1,2] and
  // samples off the edge (black). Reset to a straight stretch (uv -> uv) so
  // the texture fills the box. (Per-fit cropping is a future refinement.)
  set texture(tex: any) {
    if (this.mat && this.mat.mainPass) {
      this.mat.mainPass.baseTexture = tex;
      this.mat.mainPass.texScale = new vec2(1, 1);
      this.mat.mainPass.texOffset = new vec2(0, 0);
    }
  }
  setImageTexture(tex: any): void { this.texture = tex; }
  setImageUrl(url: string): void {
    const o = this.o; const im = this.im(); const rmm = this.rmm();
    if (!o || !im || !rmm || !im.makeResourceFromUrl) return;
    let resource: any;
    try { resource = im.makeResourceFromUrl(url); } catch (e) { return; }
    rmm.loadResourceAsImageTexture(resource, (tex: any) => { this.setImageTexture(tex); }, (_err: string) => {});
  }
}`;
