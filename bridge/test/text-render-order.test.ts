// Text renderOrder ranks from layer order (backlog 5) + the view-node retag
// used by true rename (backlog 4). Both are pure tree walks.

import { describe, expect, test } from 'vitest';
import { computeTextRenderOrders, TEXT_RENDER_ORDER } from '../src/applier.ts';
import { retagViewNode, viewNodeName } from '../src/publish.ts';
import type { DesignNode } from '../src/protocol.ts';

function node(partial: Partial<DesignNode> & { id: string; type: string }): DesignNode {
  return {
    name: partial.id,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    properties: {},
    children: [],
    ...partial,
  };
}

describe('computeTextRenderOrders', () => {
  test('front-most text (tree index 0) draws last (highest renderOrder)', () => {
    const tree: DesignNode[] = [
      node({ id: 'front', type: 'Text' }),
      node({ id: 'mid', type: 'Text' }),
      node({ id: 'back', type: 'Text' }),
    ];
    const o = computeTextRenderOrders(tree);
    expect(o.get('front')).toBe(TEXT_RENDER_ORDER + 2);
    expect(o.get('mid')).toBe(TEXT_RENDER_ORDER + 1);
    expect(o.get('back')).toBe(TEXT_RENDER_ORDER);
  });

  test('all ranks stay at or above TEXT_RENDER_ORDER (above the opaque fills)', () => {
    const tree: DesignNode[] = [
      node({ id: 'a', type: 'Text' }),
      node({ id: 'r', type: 'Rectangle' }),
      node({ id: 'b', type: 'Text' }),
    ];
    const o = computeTextRenderOrders(tree);
    for (const v of o.values()) expect(v).toBeGreaterThanOrEqual(TEXT_RENDER_ORDER);
    expect(o.has('r')).toBe(false); // non-text untouched
  });

  test('walks nested groups in document order', () => {
    const tree: DesignNode[] = [
      node({
        id: 'g',
        type: 'Group',
        children: [node({ id: 'inner', type: 'Text' })],
      }),
      node({ id: 'outer', type: 'Text' }),
    ];
    const o = computeTextRenderOrders(tree);
    // 'inner' is visited first (front-most) → higher than 'outer'.
    expect(o.get('inner')).toBe(TEXT_RENDER_ORDER + 1);
    expect(o.get('outer')).toBe(TEXT_RENDER_ORDER);
  });

  test('no text → empty map', () => {
    expect(computeTextRenderOrders([node({ id: 'r', type: 'Rectangle' })]).size).toBe(0);
  });
});

describe('retagViewNode', () => {
  test('renames the first view-bearing node and nothing else', () => {
    const tree: DesignNode[] = [
      node({
        id: 'root',
        type: 'Group',
        view: { name: 'OldView' },
        children: [node({ id: 'label', type: 'Text', binding: { key: 'title' } })],
      }),
    ];
    const out = retagViewNode(tree, 'NewView');
    expect(viewNodeName(out)).toBe('NewView');
    expect(out[0]!.children[0]!.binding?.key).toBe('title');
    // immutability: the input tree is untouched
    expect(viewNodeName(tree)).toBe('OldView');
  });

  test('renames only the FIRST view node (matches viewNodeName)', () => {
    const tree: DesignNode[] = [
      node({ id: 'a', type: 'Group', view: { name: 'A' } }),
      node({ id: 'b', type: 'Group', view: { name: 'B' } }),
    ];
    const out = retagViewNode(tree, 'Renamed');
    expect(out[0]!.view?.name).toBe('Renamed');
    expect(out[1]!.view?.name).toBe('B');
  });

  test('finds a nested view node', () => {
    const tree: DesignNode[] = [
      node({
        id: 'wrap',
        type: 'Group',
        children: [node({ id: 'v', type: 'Group', view: { name: 'Deep' } })],
      }),
    ];
    expect(viewNodeName(retagViewNode(tree, 'Shallow'))).toBe('Shallow');
  });

  test('no view node → tree unchanged structurally', () => {
    const tree: DesignNode[] = [node({ id: 'r', type: 'Rectangle' })];
    const out = retagViewNode(tree, 'Whatever');
    expect(viewNodeName(out)).toBeNull();
  });
});
