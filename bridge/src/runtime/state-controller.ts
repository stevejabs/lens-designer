// The Lens Designer runtime state controller, shipped as a Lens Studio
// TypeScript asset. The bridge writes LD_STATE_CONTROLLER_SRC verbatim into the
// sandbox (and, later, export bundles) so LS imports it as a TypeScriptAsset
// the applier can attach by name ('LDStateController').
//
// It is stored as a string (not real TS in src/) because the body uses LS
// ambient globals (@component, vec4, BaseScriptComponent, Image, SceneObject)
// that the bridge's own tsc can't resolve. LS owns its compile pipeline; we
// validate the body via the LS MCP compile, not the bridge's tsc.
//
// Patterns are copied from verified in-repo lens scripts:
//   - SIK import path: `SpectaclesInteractionKit.lspkg/Components/...`
//   - Interactable acquisition: getComponent(Interactable.getTypeName())
//   - defer-bind on UpdateEvent (events aren't ready on frame 1)
//   - visual lookup: getComponent('Component.Image') → mainPass.baseColor

export const LD_STATE_CONTROLLER_FILENAME = 'LDStateController.ts';

export const LD_STATE_CONTROLLER_SRC = `import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';

// Lens Designer state controller (generated — do not edit by hand).
// Drives per-state appearance for an interactable node: recolors fill targets
// and toggles child visibility based on SIK Interactable hover/pinch/disable
// events. States: default | hover | pinched | disabled.
@component
export class LDStateController extends BaseScriptComponent {
  @input('bool')
  enableColor: boolean = false;
  @input('vec4', '{1,1,1,1}')
  @widget(new ColorWidget())
  defaultColor: vec4 = new vec4(1, 1, 1, 1);
  @input('vec4', '{1,1,1,1}')
  @widget(new ColorWidget())
  hoverColor: vec4 = new vec4(1, 1, 1, 1);
  @input('vec4', '{1,1,1,1}')
  @widget(new ColorWidget())
  pinchedColor: vec4 = new vec4(1, 1, 1, 1);
  @input('vec4', '{1,1,1,1}')
  @widget(new ColorWidget())
  disabledColor: vec4 = new vec4(1, 1, 1, 1);

  // SceneObjects whose Image fill is recolored per state.
  @input
  colorTargets: SceneObject[] = [];

  // Child SceneObjects toggled per state, plus a parallel JSON array of the
  // state names each is visible in, e.g. '[["hover"],["default","pinched"]]'.
  @input
  stateChildren: SceneObject[] = [];
  @input('string')
  stateChildMasksJson: string = '[]';

  private interactable: Interactable | null = null;
  private masks: string[][] = [];

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.init());
  }

  private init(): void {
    try {
      this.masks = JSON.parse(this.stateChildMasksJson) as string[][];
    } catch (e) {
      this.masks = [];
    }
    this.interactable =
      (this.getSceneObject().getComponent(Interactable.getTypeName()) as unknown as Interactable | null) ?? null;
    this.applyState('default');
    this.bindWhenReady();
  }

  // SIK Interactable events aren't always bound on the first frame; retry on
  // UpdateEvent for up to 30 frames, then give up (same pattern as PoiSpawner).
  private bindWhenReady(): void {
    let bound = false;
    let attempts = 0;
    const ev = this.createEvent('UpdateEvent');
    ev.bind(() => {
      attempts++;
      if (bound) {
        ev.enabled = false;
        return;
      }
      const it = this.interactable;
      if (it && it.onHoverEnter && it.onTriggerStart) {
        it.onHoverEnter.add((e) => this.applyState(e.interactor.isTriggering ? 'pinched' : 'hover'));
        it.onHoverExit.add(() => this.applyState('default'));
        it.onTriggerStart.add(() => this.applyState('pinched'));
        it.onTriggerEnd.add(() => this.applyState('hover'));
        it.onTriggerEndOutside.add(() => this.applyState('default'));
        it.onTriggerCanceled.add(() => this.applyState('default'));
        bound = true;
        ev.enabled = false;
      } else if (attempts > 30) {
        ev.enabled = false;
      }
    });
    this.createEvent('OnEnableEvent').bind(() => this.applyState('default'));
    this.createEvent('OnDisableEvent').bind(() => this.applyState('disabled'));
  }

  private colorForState(state: string): vec4 {
    if (state === 'hover') return this.hoverColor;
    if (state === 'pinched') return this.pinchedColor;
    if (state === 'disabled') return this.disabledColor;
    return this.defaultColor;
  }

  private applyState(state: string): void {
    if (this.enableColor) {
      const c = this.colorForState(state);
      for (let i = 0; i < this.colorTargets.length; i++) {
        const img = this.colorTargets[i].getComponent('Component.Image') as unknown as Image | null;
        if (img && img.mainPass) {
          img.mainPass.baseColor = c;
        }
      }
    }
    for (let i = 0; i < this.stateChildren.length; i++) {
      const mask = this.masks[i];
      this.stateChildren[i].enabled = mask ? mask.indexOf(state) !== -1 : true;
    }
  }
}
`;
