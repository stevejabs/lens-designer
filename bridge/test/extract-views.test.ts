// Binding extraction (B1 + runtime-attach) — View roots → structural manifests.

import { describe, expect, test } from 'vitest';
import { extractViews } from '../src/codegen/extract.ts';
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

describe('extractViews', () => {
  test('extracts slots + interactives with child-index paths', () => {
    const tree: DesignNode[] = [
      node({
        id: 'card',
        type: 'Group',
        view: { name: 'CardView' },
        children: [
          node({ id: 'bg', type: 'Rectangle' }),
          node({ id: 'title', type: 'Text', binding: { key: 'title' } }),
          node({
            id: 'closeBtn',
            type: 'Rectangle',
            interaction: { role: 'button', actionKey: 'close' },
            children: [node({ id: 'icon', type: 'Image', binding: { key: 'icon' } })],
          }),
        ],
      }),
    ];
    const views = extractViews(tree);
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.name).toBe('CardView');
    expect(v.slots).toEqual([
      { key: 'title', nodeType: 'Text', path: [1] },
      { key: 'icon', nodeType: 'Image', path: [2, 0] },
    ]);
    expect(v.interactives).toHaveLength(1);
    const i = v.interactives[0]!;
    expect(i.path).toEqual([2]);
    expect(i.role).toBe('button');
    expect(i.actionKey).toBe('close');
    // No stateOverrides anywhere → no override targets.
    expect(i.overrideTargets).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  test('builds a per-element override table (resolved writes + transform delta)', () => {
    const tree: DesignNode[] = [
      node({
        id: 'card',
        type: 'Group',
        view: { name: 'V' },
        interaction: { role: 'button' },
        children: [
          node({
            id: 'bg',
            type: 'Rectangle',
            properties: { size: { x: 8, y: 4 }, opacity: 100, fillColor: { r: 0, g: 0, b: 0, a: 100 } },
            stateOverrides: { hover: { fillColor: { r: 0, g: 0, b: 255, a: 100 } }, pinched: { scale: { x: 0.95, y: 0.95 } } },
          }),
          node({ id: 'badge', type: 'Rectangle', stateOverrides: { hover: { visible: false } } }),
        ],
      }),
    ];
    const i = extractViews(tree)[0]!.interactives[0]!;
    expect(i.path).toEqual([]);
    const bg = i.overrideTargets.find((t) => t.path.length === 1 && t.path[0] === 0)!;
    expect(bg.hover!.writes.find((w) => w.channel === 'fill')).toBeDefined();
    expect(bg.pinched!.scale).toEqual({ x: 0.95, y: 0.95 });
    const badge = i.overrideTargets.find((t) => t.path[0] === 1)!;
    expect(badge.hover!.writes).toEqual([{ channel: 'visible', valueType: 'boolean', value: false }]);
  });

  test('warns on duplicate binding keys and ignores the dup', () => {
    const tree: DesignNode[] = [
      node({
        id: 'v',
        type: 'Group',
        view: { name: 'V' },
        children: [
          node({ id: 'a', type: 'Text', binding: { key: 'label' } }),
          node({ id: 'b', type: 'Text', binding: { key: 'label' } }),
        ],
      }),
    ];
    const v = extractViews(tree)[0]!;
    expect(v.slots).toHaveLength(1);
    expect(v.warnings.some((w) => w.includes('duplicate binding key'))).toBe(true);
  });

  test('finds Views nested anywhere and treats a nested View as its own', () => {
    const tree: DesignNode[] = [
      node({
        id: 'outer',
        type: 'Group',
        view: { name: 'Outer' },
        children: [
          node({ id: 't', type: 'Text', binding: { key: 't' } }),
          node({
            id: 'inner',
            type: 'Group',
            view: { name: 'Inner' },
            children: [node({ id: 'x', type: 'Text', binding: { key: 'x' } })],
          }),
        ],
      }),
    ];
    const views = extractViews(tree);
    expect(views.map((v) => v.name).sort()).toEqual(['Inner', 'Outer']);
    expect(views.find((v) => v.name === 'Outer')!.slots.map((s) => s.key)).toEqual(['t']);
    expect(views.find((v) => v.name === 'Inner')!.slots.map((s) => s.key)).toEqual(['x']);
  });

  test('no Views → empty', () => {
    expect(extractViews([node({ id: 'plain', type: 'Rectangle' })])).toEqual([]);
  });
});
