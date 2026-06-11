// Group — a container node (no visual of its own) that holds child nodes.
//
// On the LS side a Group is a bare SceneObject; its children are parented
// under it so their transforms compose (move/rotate the group → children
// follow). `position` is the group origin; children carry positions relative
// to it. Created via ⌘G on a multi-selection (not from the palette), so its
// category is `container` — the palette only lists `atomic` primitives.

import type { PrimitiveManifest } from './types.ts';

export const GroupManifest: PrimitiveManifest = {
  type: 'Group',
  category: 'container',
  displayName: 'Group',
  glyph: '▣',
  defaultProperties: {
    position: { x: 0, y: 0 },
    rotation: 0,
  },
  properties: [
    { key: 'position', label: 'x, y', kind: 'vec2', default: { x: 0, y: 0 }, unit: 'cm', section: 'Position' },
    { key: 'rotation', label: 'rotation', kind: 'number', default: 0, unit: 'deg', step: 1, section: 'Transform' },
  ],
  sceneShape: {
    componentKind: 'SceneObject', // bare SO, no rendered component / material
    materialRef: null,
    materialPreset: null,
    materialTemplatePath: null,
    transformMappings: [
      { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' },
      { source: 'rotation', target: 'localTransform.rotation', valueType: 'vec3', transform: 'deg-to-rad' },
    ],
    // Children come from the DesignNode tree at runtime, not the manifest;
    // the applier recurses on node.children.
    componentMappings: [],
    children: [],
  },
};
