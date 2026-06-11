import { describe, expect, test } from 'vitest';
import { computeHugLayout } from '../src/layout.ts';

const pad = { x: 1, y: 0.5 };

describe('computeHugLayout — hug solver', () => {
  test('single content text: group hugs text + padding, text centered', () => {
    const r = computeHugLayout([{ w: 10, h: 4, fill: false }], { mode: 'row', spacing: 0, padding: pad });
    expect(r.group).toEqual({ w: 12, h: 5 }); // 10+2*1, 4+2*0.5
    expect(r.boxes[0]).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });

  test('fill background + content text: bg gets group size at center, text keeps its size', () => {
    const r = computeHugLayout(
      [{ w: 0, h: 0, fill: true }, { w: 10, h: 4, fill: false }],
      { mode: 'row', spacing: 0, padding: pad },
    );
    expect(r.group).toEqual({ w: 12, h: 5 });
    expect(r.boxes[0]).toEqual({ x: 0, y: 0, w: 12, h: 5 }); // bg fills hug
    expect(r.boxes[1]).toEqual({ x: 0, y: 0, w: 10, h: 4 }); // single content centered
  });

  test('row: two content items flow left→right, centered as a block', () => {
    const r = computeHugLayout(
      [{ w: 4, h: 4, fill: false }, { w: 6, h: 2, fill: false }],
      { mode: 'row', spacing: 2, padding: { x: 0, y: 0 } },
    );
    // along = 4 + 2 + 6 = 12; block centered → starts at -6
    expect(r.group).toEqual({ w: 12, h: 4 }); // cross = max(4,2)=4
    expect(r.boxes[0]!.x).toBe(-6 + 2); // -6 + 4/2
    expect(r.boxes[1]!.x).toBe(-6 + 4 + 2 + 3); // after first(4)+spacing(2), +6/2
    expect(r.boxes[0]!.y).toBe(0);
  });

  test('column: items flow top→down (−y), centered', () => {
    const r = computeHugLayout(
      [{ w: 6, h: 4, fill: false }, { w: 4, h: 4, fill: false }],
      { mode: 'column', spacing: 0, padding: { x: 0, y: 0 } },
    );
    expect(r.group).toEqual({ w: 6, h: 8 }); // cross = max width 6; along = 4+4
    expect(r.boxes[0]!.y).toBe(2);  // top item: −(−2) ... block starts at -4 → first center along=-2 → y=+2
    expect(r.boxes[1]!.y).toBe(-2);
  });
});
