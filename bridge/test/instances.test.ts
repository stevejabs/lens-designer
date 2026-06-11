// Shared-component instance expansion + codegen (backlog 13, scope doc
// 2026-06-09). Expansion is pure given a registry snapshot.

import { describe, expect, test } from 'vitest';
import {
  expandInstances,
  treeHasInstances,
  collectInstanceRefs,
} from '../src/instances.ts';
import { extractViews } from '../src/codegen/extract.ts';
import { generateController } from '../src/codegen/generate.ts';
import type { DesignNode } from '../src/protocol.ts';
import type { ViewRegistry, ViewRecord } from '../src/registry.ts';

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

function record(id: string, name: string, tree: DesignNode[]): ViewRecord {
  return { id, name, tree, createdAt: 1, updatedAt: 1, generated: null, scene: null };
}

function registry(...views: ViewRecord[]): ViewRegistry {
  return { registryVersion: 3, views };
}

/** A ButtonView definition: marked group with a bound label + a fill. */
const buttonDef = record('def-button', 'ButtonView', [
  node({
    id: 'btn-root',
    type: 'Group',
    view: { name: 'ButtonView' },
    interaction: { role: 'button', actionKey: 'press' },
    properties: { position: { x: 5, y: 5 }, rotation: 0 },
    children: [
      node({ id: 'btn-bg', type: 'Rectangle', properties: { size: { x: 10, y: 4 } } }),
      node({
        id: 'btn-label',
        type: 'Text',
        binding: { key: 'label' },
        properties: { text: 'Button' },
      }),
    ],
  }),
]);

function instanceNode(over?: { slots?: Record<string, unknown>; actionKey?: string }): DesignNode {
  return node({
    id: 'inst-1',
    type: 'Instance',
    name: 'ConfirmButton',
    instance: { of: 'def-button', ...(over ? { overrides: over } : {}) },
    properties: { position: { x: -3, y: 2 }, rotation: 15, size: { x: 10, y: 4 } },
  });
}

describe('expandInstances', () => {
  test('expands to the definition subtree, keeping instance id + placement', () => {
    const { tree, warnings } = expandInstances([instanceNode()], registry(buttonDef));
    expect(warnings).toEqual([]);
    const e = tree[0]!;
    expect(e.id).toBe('inst-1'); // stable for diff/material identity
    expect(e.type).toBe('Group');
    expect(e.view?.name).toBe('ButtonView'); // controller attaches at runtime
    expect(e.properties['position']).toEqual({ x: -3, y: 2 }); // instance placement
    expect(e.properties['rotation']).toBe(15);
    expect(e.children.map((c) => c.id)).toEqual(['inst-1::btn-bg', 'inst-1::btn-label']);
    expect(e.interaction?.actionKey).toBe('press'); // def's, no override
  });

  test('applies slot + actionKey overrides', () => {
    const { tree } = expandInstances(
      [instanceNode({ slots: { label: 'Confirm' }, actionKey: 'confirm' })],
      registry(buttonDef),
    );
    const e = tree[0]!;
    const label = e.children.find((c) => c.id.endsWith('btn-label'))!;
    expect(label.properties['text']).toBe('Confirm');
    expect(e.interaction?.actionKey).toBe('confirm');
  });

  test('two instances of one definition get distinct child ids', () => {
    const a = { ...instanceNode(), id: 'inst-a' };
    const b = { ...instanceNode(), id: 'inst-b' };
    const { tree } = expandInstances([a, b], registry(buttonDef));
    expect(tree[0]!.children[0]!.id).toBe('inst-a::btn-bg');
    expect(tree[1]!.children[0]!.id).toBe('inst-b::btn-bg');
  });

  test('missing definition collapses to a placeholder with a warning', () => {
    const { tree, warnings } = expandInstances([instanceNode()], registry());
    expect(tree[0]!.type).toBe('Group');
    expect(tree[0]!.children).toEqual([]);
    expect(warnings[0]).toMatch(/deleted view/);
  });

  test('cycles collapse instead of recursing forever', () => {
    // A's definition contains an instance of A.
    const selfRef = record('def-a', 'AView', [
      node({
        id: 'a-root',
        type: 'Group',
        view: { name: 'AView' },
        children: [
          node({ id: 'a-inner', type: 'Instance', instance: { of: 'def-a' } }),
        ],
      }),
    ]);
    const use = node({ id: 'u1', type: 'Instance', instance: { of: 'def-a' } });
    const { tree, warnings } = expandInstances([use], registry(selfRef));
    expect(warnings.some((w) => /cycle/.test(w))).toBe(true);
    // outer expanded; inner collapsed to placeholder
    expect(tree[0]!.view?.name).toBe('AView');
    expect(tree[0]!.children[0]!.children).toEqual([]);
  });

  test('expansion is deterministic (same registry → identical JSON)', () => {
    const a = expandInstances([instanceNode()], registry(buttonDef));
    const b = expandInstances([instanceNode()], registry(buttonDef));
    expect(JSON.stringify(a.tree)).toBe(JSON.stringify(b.tree));
  });

  test('helpers: treeHasInstances + collectInstanceRefs', () => {
    const t = [node({ id: 'g', type: 'Group', children: [instanceNode()] })];
    expect(treeHasInstances(t)).toBe(true);
    expect(treeHasInstances([node({ id: 'r', type: 'Rectangle' })])).toBe(false);
    expect([...collectInstanceRefs(t)]).toEqual(['def-button']);
  });
});

describe('instance slots in codegen', () => {
  const parent: DesignNode[] = [
    node({
      id: 'card',
      type: 'Group',
      view: { name: 'PoiCardView' },
      children: [
        node({ id: 't', type: 'Text', binding: { key: 'title' } }),
        node({
          id: 'i',
          type: 'Instance',
          binding: { key: 'confirmButton' },
          instance: { of: 'def-button' },
        }),
      ],
    }),
  ];

  test('extract produces a typed view slot at the instance path', () => {
    const [m] = extractViews(parent, new Map([['def-button', 'ButtonView']]));
    const slot = m!.slots.find((s) => s.key === 'confirmButton')!;
    expect(slot.nodeType).toBe('Instance');
    expect(slot.viewClass).toBe('ButtonView');
    expect(slot.path).toEqual([1]);
    expect(m!.warnings).toEqual([]);
  });

  test('unknown definition drops the slot with a warning', () => {
    const [m] = extractViews(parent, new Map());
    expect(m!.slots.some((s) => s.key === 'confirmButton')).toBe(false);
    expect(m!.warnings.some((w) => /unknown component/.test(w))).toBe(true);
  });

  test('generated controller imports the child class + emits a lazy getter', () => {
    const [m] = extractViews(parent, new Map([['def-button', 'ButtonView']]));
    const src = generateController(m!);
    expect(src).toContain(`import { ButtonView } from './ButtonView';`);
    expect(src).toContain('get confirmButton(): ButtonView | null {');
    expect(src).toContain('ButtonView.getTypeName()');
    // the instance slot must NOT be constructed as an LD handle in onAwake
    expect(src).not.toContain('this.confirmButton = new');
  });
});
