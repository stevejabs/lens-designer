// Coord conversion between design units (cm) and canvas pixels.
//
// At 100% zoom: 1 cm = 10 px. Pan + zoom only affect the visual
// transform; the underlying design data stays in cm so the preview
// (which renders in LS world units) is always 1:1 with the canvas.

export const PX_PER_CM = 10;

export function cmToPx(cm: number, zoom: number = 1): number {
  return cm * PX_PER_CM * zoom;
}

export function pxToCm(px: number, zoom: number = 1): number {
  return px / (PX_PER_CM * zoom);
}

/**
 * 16-bit clamp for RGB channels. Designer color values are 0-255 ints;
 * this guards against the occasional float that sneaks in from a form.
 */
export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Vec4 (0-1 each channel) → CSS rgba string. */
export function rgbaToCss(c: { r: number; g: number; b: number; a: number }): string {
  // c.r/g/b are 0–255 ints; a is 0–100 percent.
  const r = clampByte(c.r);
  const g = clampByte(c.g);
  const b = clampByte(c.b);
  const a = Math.max(0, Math.min(1, c.a / 100));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Hex string "#RRGGBB" parsed into an {r,g,b} record (alpha untouched). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace(/^#/, '');
  if (cleaned.length !== 6) return null;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

export function rgbToHex(c: { r: number; g: number; b: number }): string {
  const hex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}
