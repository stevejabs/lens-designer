// view-parse.ts — extract editable design constants from a view module and
// rewrite them in place. This is the pragmatic round-trip: a view's visual
// spec lives in named module-scope `const`s (numbers, vec4 colors, strings,
// booleans), so the inspector reads them and writes edits back without touching
// control flow or hand-edited handler bodies.

export type FieldKind = 'number' | 'color' | 'string' | 'boolean';

export interface ViewField {
  name: string;
  kind: FieldKind;
  /** number → number; color → [r,g,b,a]; string → string; boolean → boolean */
  value: number | number[] | string | boolean;
}

const NUM = /^[-+]?\d*\.?\d+$/;

/** Parse top-level `const NAME = value` design constants. */
export function parseViewFields(source: string): ViewField[] {
  const fields: ViewField[] = [];
  const re = /^const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(.+?);?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    const raw = (m[2] ?? '').trim();
    if (!name) continue;

    const vec = raw.match(/^new\s+vec4\(\s*([-+0-9.\s,]+)\)$/);
    if (vec && vec[1]) {
      const parts = vec[1].split(',').map((s) => Number.parseFloat(s.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        fields.push({ name, kind: 'color', value: parts });
        continue;
      }
    }
    if (NUM.test(raw)) {
      fields.push({ name, kind: 'number', value: Number.parseFloat(raw) });
      continue;
    }
    if (raw === 'true' || raw === 'false') {
      fields.push({ name, kind: 'boolean', value: raw === 'true' });
      continue;
    }
    const str = raw.match(/^["'`](.*)["'`]$/);
    if (str) {
      fields.push({ name, kind: 'string', value: str[1] ?? '' });
      continue;
    }
  }
  return fields;
}

function literalFor(kind: FieldKind, value: number | number[] | string | boolean): string {
  switch (kind) {
    case 'number':
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'color': {
      const v = value as number[];
      return `new vec4(${v.map((n) => (Number.isInteger(n) ? n : Number(n.toFixed(3)))).join(', ')})`;
    }
    case 'string':
      return JSON.stringify(value);
  }
}

/** Rewrite a single design constant's value in the source; returns new source. */
export function setViewField(
  source: string,
  name: string,
  kind: FieldKind,
  value: number | number[] | string | boolean,
): string {
  const re = new RegExp(`^(const\\s+${name}\\s*(?::[^=]+)?=\\s*)(.+?)(;?\\s*)$`, 'm');
  return source.replace(re, (_full, head: string, _old: string, tail: string) => {
    return `${head}${literalFor(kind, value)}${tail}`;
  });
}
