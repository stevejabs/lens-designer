// Phase 1 — web design store reducers + localStorage rehydration.
// Plan steps B4, E1–E4, H3.

import { describe, test, expect, beforeEach } from 'vitest';
import { useDesignStore, findNode } from '@/lib/design-model';

const store = () => useDesignStore.getState();

describe('useDesignStore — reducers', () => {
  test.todo('initial state: tree = [], selectedId = null, previewRegion = default');
  test.todo('addNode(manifest, position) appends a node with manifest defaults');
  test.todo('addNode auto-selects the new node');
  test.todo('addNode places the node at the top of the layer list (front layer)');
  test.todo('selectNode(id) sets selectedId; selectNode(null) clears');
  test.todo('selectNode(invalid id) does nothing (does NOT throw)');
  test.todo('updateProp(id, "fillColor", value) writes only the targeted property');
  test.todo('updateProp on a nested path (e.g. "transform.position.x") writes deep');
  test.todo('moveLayer(id, "forward") decrements index toward 0');
  test.todo('moveLayer(id, "back") increments index toward end');
  test.todo('moveLayer at boundary is a no-op (front layer can\'t go more forward)');
  test.todo('removeNode(id) removes from tree');
  test.todo('removeNode clears selectedId if the removed node was selected');
  test.todo('setPreviewRegion(rect) replaces the previewRegion');
});

describe('useDesignStore — localStorage persistence', () => {
  test.todo('every state change writes to localStorage');
  test.todo('on init, hydrates from localStorage if present');
  test.todo('on init with malformed JSON in localStorage, falls back to defaults');
  test.todo('design tree, selectedId, and previewRegion all survive round-trip');
});

// WB1 — per-element per-state overrides (v1b). Real tests for the new reducers.
describe('useDesignStore — state overrides (WB1)', () => {
  beforeEach(() => store().reset());

  test('setStateOverride stores only the targeted prop, nested under the state', () => {
    const id = store().addNode('Rectangle')!;
    store().setStateOverride(id, 'hover', 'fillColor', { r: 1, g: 2, b: 3, a: 100 });
    const n = findNode(store().tree, id)!;
    expect(n.stateOverrides?.hover?.fillColor).toEqual({ r: 1, g: 2, b: 3, a: 100 });
    expect(Object.keys(n.stateOverrides!.hover!)).toEqual(['fillColor']);
    expect(n.stateOverrides?.pinched).toBeUndefined();
    expect(n.stateOverrides?.disabled).toBeUndefined();
  });

  test('multiple props + states accumulate independently', () => {
    const id = store().addNode('Rectangle')!;
    store().setStateOverride(id, 'hover', 'fillColor', { r: 0, g: 0, b: 0, a: 100 });
    store().setStateOverride(id, 'hover', 'opacity', 50);
    store().setStateOverride(id, 'pinched', 'scale', { x: 0.95, y: 0.95 });
    const n = findNode(store().tree, id)!;
    expect(Object.keys(n.stateOverrides!.hover!).sort()).toEqual(['fillColor', 'opacity']);
    expect(n.stateOverrides!.pinched!.scale).toEqual({ x: 0.95, y: 0.95 });
  });

  test('clearStateOverride removes the prop and prunes empty state + stateOverrides', () => {
    const id = store().addNode('Rectangle')!;
    store().setStateOverride(id, 'hover', 'fillColor', { r: 0, g: 0, b: 0, a: 100 });
    store().clearStateOverride(id, 'hover', 'fillColor');
    expect(findNode(store().tree, id)!.stateOverrides).toBeUndefined();
  });

  test('clearStateOverride leaves sibling props/states intact', () => {
    const id = store().addNode('Rectangle')!;
    store().setStateOverride(id, 'hover', 'fillColor', { r: 0, g: 0, b: 0, a: 100 });
    store().setStateOverride(id, 'hover', 'opacity', 40);
    store().setStateOverride(id, 'pinched', 'opacity', 80);
    store().clearStateOverride(id, 'hover', 'opacity');
    const n = findNode(store().tree, id)!;
    expect(n.stateOverrides!.hover!.fillColor).toBeDefined();
    expect(n.stateOverrides!.hover!.opacity).toBeUndefined();
    expect(n.stateOverrides!.pinched!.opacity).toBe(80);
  });

  test('overrides ride duplicate() with fresh ids (deep clone)', () => {
    const id = store().addNode('Rectangle')!;
    store().setStateOverride(id, 'hover', 'fillColor', { r: 9, g: 9, b: 9, a: 100 });
    store().selectNode(id);
    store().duplicate();
    const clone = store().tree.find((n) => n.id !== id)!;
    expect(clone.id).not.toBe(id);
    expect(clone.stateOverrides?.hover?.fillColor).toEqual({ r: 9, g: 9, b: 9, a: 100 });
  });

  test('undo reverts a setStateOverride', () => {
    const id = store().addNode('Rectangle')!;
    store().setStateOverride(id, 'hover', 'opacity', 30);
    store().undo();
    expect(findNode(store().tree, id)!.stateOverrides).toBeUndefined();
  });
});

describe('useDesignStore — layout reservation (TD-10)', () => {
  beforeEach(() => store().reset());

  test('setLayout sets and clears the layout spec', () => {
    const id = store().addNode('Rectangle')!;
    store().setLayout(id, { mode: 'row', spacing: 1, padding: { x: 0.5, y: 0.5 }, hug: true });
    expect(findNode(store().tree, id)!.layout?.mode).toBe('row');
    store().setLayout(id, undefined);
    expect(findNode(store().tree, id)!.layout).toBeUndefined();
  });
});
