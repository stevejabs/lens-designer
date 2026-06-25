import { describe, it, expect } from 'vitest';
import { UIKIT_CATALOG, specForType, deriveType, UIKIT_TYPES } from '@/lib/v2/uikit/catalog';

describe('UIKit catalog', () => {
  it('covers the core UIKit component set', () => {
    const want = [
      'Frame', 'BackPlate', 'Button', 'Switch', 'Toggle', 'Slider', 'ProgressBar',
      'Text', 'Image', 'FlexLayout', 'FlexItem', 'GridLayout', 'TextInputField',
      'TextInputArea', 'Dropdown', 'ScrollBar', 'RoundedRectangle',
    ];
    for (const t of want) expect(UIKIT_TYPES, `missing ${t}`).toContain(t);
  });

  it('every component has at least one editable property', () => {
    for (const c of UIKIT_CATALOG) expect(c.props.length, c.type).toBeGreaterThan(0);
  });

  it('corner-capable components expose a corner property', () => {
    for (const t of ['Frame', 'RoundedRectangle', 'Button', 'BackPlate']) {
      const spec = specForType(t)!;
      expect(spec.props.some((p) => p.category === 'corner'), t).toBe(true);
    }
  });

  it('derives the most-specific type from runtime componentTypes', () => {
    // A Switch node also carries RoundedRectangle/Interactable — it IS a Switch.
    expect(
      deriveType(['RenderMeshVisual', 'ScriptComponent', 'Switch', 'RoundedRectangle', 'Interactable']),
    ).toBe('Switch');
    // A bare visual stays a RoundedRectangle.
    expect(deriveType(['RenderMeshVisual', 'ScriptComponent', 'RoundedRectangle'])).toBe('RoundedRectangle');
    // Text wins over nothing.
    expect(deriveType(['Text', 'ScriptComponent', 'FlexItem'])).toBe('Text');
    // Structural-only node → null.
    expect(deriveType(['ScriptComponent'])).toBeNull();
  });

  it('every property type/category is valid', () => {
    const types = new Set(['number', 'boolean', 'string', 'color', 'vec2', 'vec3', 'enum']);
    const cats = new Set(['size', 'color', 'corner', 'border', 'text', 'layout', 'state', 'behavior', 'visual']);
    for (const c of UIKIT_CATALOG)
      for (const p of c.props) {
        expect(types.has(p.type), `${c.type}.${p.key} type`).toBe(true);
        expect(cats.has(p.category), `${c.type}.${p.key} category`).toBe(true);
      }
  });
});
