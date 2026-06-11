// Visual color picker popover. SV square + hue slider + alpha slider +
// RGBA numeric inputs + hex field. Mounted under the swatch in the
// Inspector. Closes on outside click or ESC.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampByte, hexToRgb, rgbToHex } from '@/lib/coord';
import { NumberField, HexField } from './fields';

const CHANNEL_INPUT_CLS =
  'w-full bg-bg-4 border border-border-subtle rounded px-1 py-0.5 text-xs font-num text-text-primary focus:border-accent-500 focus:outline-none text-center';

export interface RgbaColor {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
  a: number; // 0–100 percent
}

interface ColorPickerProps {
  value: RgbaColor;
  onChange: (next: RgbaColor) => void;
  onClose: () => void;
  /** Anchor button — popover positions relative to its bounding rect. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

// ---- HSV ↔ RGB conversion ----
//
// HSV is the natural space for an SV-square color picker. The SV square
// scales horizontally with saturation (0–1, left to right) and vertically
// with value (1–0, top to bottom). The hue is a separate slider below.

interface HsvColor {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rN) h = ((gN - bN) / d) % 6;
    else if (max === gN) h = (bN - rN) / d + 2;
    else h = (rN - gN) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb({ h, s, v }: HsvColor): { r: number; g: number; b: number } {
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let rN = 0;
  let gN = 0;
  let bN = 0;
  if (hh >= 0 && hh < 1) { rN = c; gN = x; }
  else if (hh < 2) { rN = x; gN = c; }
  else if (hh < 3) { gN = c; bN = x; }
  else if (hh < 4) { gN = x; bN = c; }
  else if (hh < 5) { rN = x; bN = c; }
  else { rN = c; bN = x; }
  const m = v - c;
  return {
    r: clampByte((rN + m) * 255),
    g: clampByte((gN + m) * 255),
    b: clampByte((bN + m) * 255),
  };
}

// ---- Drag helper ----
//
// Used by the SV square + the two sliders. Captures pointermove until
// pointerup, regardless of whether the cursor leaves the element.

function useDrag(
  elRef: React.RefObject<HTMLDivElement | null>,
  onMove: (e: PointerEvent | React.PointerEvent) => void,
): { onPointerDown: (e: React.PointerEvent) => void } {
  const dragging = useRef(false);

  useEffect(() => {
    function handleMove(e: PointerEvent) {
      if (!dragging.current) return;
      e.preventDefault(); // don't let the drag select page text
      onMove(e);
    }
    function handleUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = '';
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.userSelect = '';
    };
  }, [onMove]);

  return {
    onPointerDown: (e) => {
      dragging.current = true;
      // Suppress text selection across the whole page for the drag's duration.
      document.body.style.userSelect = 'none';
      onMove(e);
    },
  };
}

export function ColorPicker({ value, onChange, onClose, anchorRef }: ColorPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Compute fixed-position coords relative to the anchor button. Recompute
  // on scroll/resize so the popover tracks if the user moves the page.
  useEffect(() => {
    function recompute() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const popoverWidth = 256;
      const popoverHeightEst = 340;
      // Default: below the anchor, right-aligned.
      let top = rect.bottom + 8;
      let left = rect.right - popoverWidth;
      // Flip above if not enough room below.
      if (top + popoverHeightEst > window.innerHeight - 8) {
        top = Math.max(8, rect.top - popoverHeightEst - 8);
      }
      // Keep within viewport horizontally.
      if (left < 8) left = 8;
      if (left + popoverWidth > window.innerWidth - 8) {
        left = window.innerWidth - popoverWidth - 8;
      }
      setPos({ top, left });
    }
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [anchorRef]);

  // Track HSV locally so dragging in the SV square at value=0 still
  // remembers hue. We re-derive HSV from incoming RGB on first mount,
  // then keep hue stable across re-renders.
  const [hue, setHue] = useState(() => rgbToHsv(value.r, value.g, value.b).h);

  const hsv = rgbToHsv(value.r, value.g, value.b);
  // Preserve hue when saturation = 0 (color is grayscale and hue would
  // otherwise snap to 0).
  const effectiveHue = hsv.s === 0 ? hue : hsv.h;

  const updateRGB = useCallback(
    (next: { r: number; g: number; b: number }) => {
      onChange({ ...value, ...next });
    },
    [onChange, value],
  );

  const updateFromHsv = useCallback(
    (h: number, s: number, v: number) => {
      const rgb = hsvToRgb({ h, s, v });
      setHue(h);
      updateRGB(rgb);
    },
    [updateRGB],
  );

  const svDrag = useDrag(svRef, (e) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const s = x / rect.width;
    const v = 1 - y / rect.height;
    updateFromHsv(effectiveHue, s, v);
  });

  const hueDrag = useDrag(hueRef, (e) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const h = (x / rect.width) * 360;
    updateFromHsv(h, hsv.s || 1, hsv.v || 1);
  });

  const alphaDrag = useDrag(alphaRef, (e) => {
    const el = alphaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const a = Math.round((x / rect.width) * 100);
    onChange({ ...value, a });
  });

  // Close on Esc + outside click. Outside = not inside the popover AND
  // not the anchor button itself (clicking the button is "toggle off").
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handlePointer(e: PointerEvent) {
      if (!(e.target instanceof Node)) return;
      if (containerRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    }
    window.addEventListener('keydown', handleKey);
    // Defer the outside-click handler so the click that opened the popover
    // doesn't immediately close it.
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handlePointer);
    }, 0);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointerdown', handlePointer);
      clearTimeout(timer);
    };
  }, [onClose, anchorRef]);

  const hex = rgbToHex(value);
  const pureHue = `hsl(${effectiveHue}, 100%, 50%)`;

  if (!mounted || !pos) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-50 w-64 rounded-lg border border-border-subtle bg-bg-3 shadow-xl p-3 space-y-3"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* SV square */}
      <div
        ref={svRef}
        onPointerDown={svDrag.onPointerDown}
        className="relative h-40 rounded select-none cursor-crosshair overflow-hidden"
        style={{ background: pureHue }}
        role="slider"
        aria-label="Saturation/Value"
      >
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, #fff, transparent)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, #000, transparent)' }}
        />
        <div
          className="absolute w-3 h-3 -ml-[6px] -mt-[6px] rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
          }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        onPointerDown={hueDrag.onPointerDown}
        className="relative h-3 rounded select-none cursor-pointer"
        style={{
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
        role="slider"
        aria-label="Hue"
      >
        <div
          className="absolute top-1/2 w-3 h-4 -ml-[6px] -mt-2 rounded border-2 border-white shadow-md pointer-events-none"
          style={{ left: `${(effectiveHue / 360) * 100}%` }}
        />
      </div>

      {/* Alpha slider */}
      <div
        ref={alphaRef}
        onPointerDown={alphaDrag.onPointerDown}
        className="relative h-3 rounded select-none cursor-pointer overflow-hidden"
        role="slider"
        aria-label="Alpha"
      >
        {/* checkerboard backdrop for transparency */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'conic-gradient(#666 0 25%, #aaa 0 50%, #666 0 75%, #aaa 0) 0 0 / 8px 8px',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, transparent, rgb(${value.r}, ${value.g}, ${value.b}))`,
          }}
        />
        <div
          className="absolute top-1/2 w-3 h-4 -ml-[6px] -mt-2 rounded border-2 border-white shadow-md pointer-events-none"
          style={{ left: `${value.a}%` }}
        />
      </div>

      {/* Numeric inputs: R G B A and hex */}
      <div className="grid grid-cols-4 gap-1.5">
        {(['r', 'g', 'b'] as const).map((channel) => (
          <div key={channel} className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-text-tertiary text-center">
              {channel}
            </div>
            <NumberField
              value={value[channel]}
              min={0}
              max={255}
              onChange={(n) => onChange({ ...value, [channel]: clampByte(n) })}
              className={CHANNEL_INPUT_CLS}
            />
          </div>
        ))}
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-text-tertiary text-center">a%</div>
          <NumberField
            value={value.a}
            min={0}
            max={100}
            onChange={(n) => onChange({ ...value, a: Math.round(n) })}
            className={CHANNEL_INPUT_CLS}
          />
        </div>
      </div>

      {/* Hex */}
      <HexField
        value={hex}
        onChange={(h) => {
          const next = hexToRgb(h);
          if (next) onChange({ ...value, ...next });
        }}
        className="w-full bg-bg-4 border border-border-subtle rounded px-2 py-1 text-sm font-num text-text-primary focus:border-accent-500 focus:outline-none text-center uppercase"
      />
    </div>,
    document.body,
  );
}
