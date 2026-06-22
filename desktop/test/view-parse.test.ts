import { describe, it, expect } from 'vitest';
import { parseViewFields, setViewField } from '../src/services/view-parse.js';

const SAMPLE = `
import { Foo } from "bar";
const PANEL_W = 30;
const CORNER_RADIUS = 2.0;
const BORDER_SIZE = 0.35;
const BORDER_COLOR = new vec4(0.65, 0.90, 1.0, 0.9);
const TITLE = "Settings";
const SHOW_BORDER = true;
const lowercaseIgnored = 5;
@component
export class X {
  onAwake() { /* handler body — must never be touched */ }
}
`;

describe('parseViewFields', () => {
  it('extracts numbers, colors, strings, booleans (UPPER_SNAKE only)', () => {
    const fields = parseViewFields(SAMPLE);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName['PANEL_W']).toEqual({ name: 'PANEL_W', kind: 'number', value: 30 });
    expect(byName['CORNER_RADIUS']?.value).toBe(2.0);
    expect(byName['BORDER_COLOR']).toEqual({ name: 'BORDER_COLOR', kind: 'color', value: [0.65, 0.9, 1.0, 0.9] });
    expect(byName['TITLE']).toEqual({ name: 'TITLE', kind: 'string', value: 'Settings' });
    expect(byName['SHOW_BORDER']).toEqual({ name: 'SHOW_BORDER', kind: 'boolean', value: true });
    expect(byName['lowercaseIgnored']).toBeUndefined();
  });
});

describe('setViewField', () => {
  it('rewrites a number without touching the rest', () => {
    const next = setViewField(SAMPLE, 'CORNER_RADIUS', 'number', 4.5);
    expect(next).toContain('const CORNER_RADIUS = 4.5;');
    expect(next).toContain('const PANEL_W = 30;');
    expect(next).toContain('handler body — must never be touched');
  });

  it('rewrites a color to a vec4 literal', () => {
    const next = setViewField(SAMPLE, 'BORDER_COLOR', 'color', [1, 0, 0, 1]);
    expect(next).toContain('const BORDER_COLOR = new vec4(1, 0, 0, 1);');
  });

  it('round-trips: parse → set → parse reflects the new value', () => {
    const next = setViewField(SAMPLE, 'BORDER_SIZE', 'number', 0.75);
    const reparsed = parseViewFields(next);
    expect(reparsed.find((f) => f.name === 'BORDER_SIZE')?.value).toBe(0.75);
  });
});
