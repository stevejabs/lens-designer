// Phase 1 — atomic manifests for Rectangle and Text. Plan steps C1–C3.

import { describe, expect, test } from 'vitest';
import {
  EllipseManifest,
  ImageManifest,
  MANIFESTS,
  PrimitiveManifestSchema,
  RectangleManifest,
  TextManifest,
} from '../src/manifests/index.ts';

describe('PrimitiveManifest schema (zod)', () => {
  test('validates the Rectangle manifest', () => {
    expect(() => PrimitiveManifestSchema.parse(RectangleManifest)).not.toThrow();
  });

  test('validates the Ellipse manifest', () => {
    expect(() => PrimitiveManifestSchema.parse(EllipseManifest)).not.toThrow();
  });

  test('validates the Image manifest', () => {
    expect(() => PrimitiveManifestSchema.parse(ImageManifest)).not.toThrow();
  });

  test('validates the Text manifest', () => {
    expect(() => PrimitiveManifestSchema.parse(TextManifest)).not.toThrow();
  });

  test.todo('rejects a manifest with no type field');
  test.todo('rejects a manifest with unknown property `kind` value');
  test.todo('rejects a manifest with negative default size');
});

describe('Rectangle manifest (Phase 1 fallback shape)', () => {
  test('is registered under its declared type', () => {
    expect(MANIFESTS['Rectangle']).toBe(RectangleManifest);
  });

  test('declares the Phase 1.5 property surface (fill + stroke + per-corner)', () => {
    const keys = RectangleManifest.properties.map((p) => p.key).sort();
    expect(keys).toEqual([
      'cornerBL',
      'cornerBR',
      'cornerTL',
      'cornerTR',
      'fillColor',
      'opacity',
      'position',
      'rotation',
      'size',
      'strokeColor',
      'strokeWidth',
    ]);
  });

  test('size default is positive and fits in a 1280×800 viewport', () => {
    const sizeDefault = RectangleManifest.defaultProperties['size'] as { x: number; y: number };
    expect(sizeDefault.x).toBeGreaterThan(0);
    expect(sizeDefault.y).toBeGreaterThan(0);
    // At 10 px/cm (zoom 1), our 880×856 canvas fits ~88 cm wide × 85 cm tall.
    expect(sizeDefault.x).toBeLessThan(88);
    expect(sizeDefault.y).toBeLessThan(85);
  });

  test('uses LS Image as its rendered component (Phase 1 fallback)', () => {
    expect(RectangleManifest.sceneShape.componentKind).toBe('Image');
  });
});

describe('Ellipse manifest (Phase 1.5)', () => {
  test('is registered under its declared type', () => {
    expect(MANIFESTS['Ellipse']).toBe(EllipseManifest);
  });

  test('declares fill + stroke (no corner radii — ellipses have no corners)', () => {
    const keys = EllipseManifest.properties.map((p) => p.key).sort();
    expect(keys).toEqual([
      'fillColor',
      'opacity',
      'position',
      'rotation',
      'size',
      'strokeColor',
      'strokeWidth',
    ]);
  });

  test('default size is square (renders a circle by default)', () => {
    const s = EllipseManifest.defaultProperties['size'] as { x: number; y: number };
    expect(s.x).toBe(s.y);
    expect(s.x).toBeGreaterThan(0);
  });

  test('renders via a per-node ShaderGraph material template', () => {
    expect(EllipseManifest.sceneShape.componentKind).toBe('Image');
    expect(EllipseManifest.sceneShape.materialTemplatePath).toBe(
      'LensDesigner/LensDesignerEllipse.mat',
    );
  });
});

describe('Image manifest (Phase 1.5)', () => {
  test('is registered under its declared type', () => {
    expect(MANIFESTS['Image']).toBe(ImageManifest);
  });

  test('inherits stroke + per-corner radii and adds image controls', () => {
    const keys = ImageManifest.properties.map((p) => p.key).sort();
    expect(keys).toEqual([
      'alignment',
      'cornerBL',
      'cornerBR',
      'cornerTL',
      'cornerTR',
      'fitMode',
      'imageSource',
      'opacity',
      'position',
      'rotation',
      'size',
      'strokeColor',
      'strokeWidth',
    ]);
  });

  test('composes the shared RoundedRectCore via its own material', () => {
    expect(ImageManifest.sceneShape.materialTemplatePath).toBe(
      'LensDesigner/LensDesignerImage.mat',
    );
  });

  test('imageSource uses the image picker kind', () => {
    const src = ImageManifest.properties.find((p) => p.key === 'imageSource');
    expect(src?.kind).toBe('image');
  });
});

describe('Text manifest', () => {
  test('is registered under its declared type', () => {
    expect(MANIFESTS['Text']).toBe(TextManifest);
  });

  test('declares the box-model property surface (size=box, fontSize=glyph)', () => {
    const keys = TextManifest.properties.map((p) => p.key).sort();
    expect(keys).toEqual([
      'fillColor',
      'font',
      'fontSize',
      'horizontalAlignment',
      'horizontalOverflow',
      'letterSpacing',
      'lineSpacing',
      'opacity',
      'outlineColor',
      'outlineEnabled',
      'outlineSize',
      'position',
      'rotation',
      'size',
      'text',
      'verticalAlignment',
      'verticalOverflow',
    ]);
  });

  test('size is the text box (vec2) and maps to worldSpaceRect; fontSize is the glyph size', () => {
    const sizeProp = TextManifest.properties.find((p) => p.key === 'size');
    expect(sizeProp?.kind).toBe('vec2');
    const fontSizeProp = TextManifest.properties.find((p) => p.key === 'fontSize');
    expect(fontSizeProp?.kind).toBe('number');
    const rectMapping = TextManifest.sceneShape.componentMappings.find((m) => m.target === 'worldSpaceRect');
    expect(rectMapping?.source).toBe('size');
    const sizeMapping = TextManifest.sceneShape.componentMappings.find((m) => m.target === 'size');
    expect(sizeMapping?.source).toBe('fontSize');
  });

  test('font picker lists the built-ins (custom uploads append at runtime)', () => {
    const fontProp = TextManifest.properties.find((p) => p.key === 'font');
    expect(fontProp?.kind).toBe('font');
    expect(fontProp?.options?.length).toBeGreaterThan(0);
  });

  test('default text is non-empty', () => {
    expect(TextManifest.defaultProperties['text']).not.toBe('');
  });

  test('uses LS Text component', () => {
    expect(TextManifest.sceneShape.componentKind).toBe('Text');
  });
});
