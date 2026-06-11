'use client';

// Shared form fields with a draft-while-editing model. The previous inputs were
// controlled directly off the parsed value, so any intermediate keystroke
// (empty, "-", "1.", a partial hex) was immediately reverted — making backspace,
// negatives, and hand-typed hex impossible. These keep a local draft string
// while focused, commit valid values live, and normalize on blur.

import { useEffect, useState } from 'react';

interface NumberFieldProps {
  value: number;
  onChange: (n: number) => void;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  className?: string | undefined;
  placeholder?: string | undefined;
}

export function NumberField({ value, onChange, min, max, step, className, placeholder }: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [editing, setEditing] = useState(false);

  // Reflect external changes (drag on canvas, undo, etc.) when not typing here.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const clamp = (n: number): number => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  // text + inputMode avoids the native number input's quirks (forced empty→0,
  // locale parsing, spinners that fight typing) while keeping a numeric keypad.
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const t = raw.trim();
        if (t === '' || t === '-' || t === '.' || t === '-.') return; // intermediate
        const n = Number(t);
        if (Number.isFinite(n)) onChange(clamp(n));
      }}
      onBlur={() => {
        setEditing(false);
        const n = Number(draft.trim());
        if (draft.trim() === '' || !Number.isFinite(n)) {
          setDraft(String(value)); // revert to last committed
        } else {
          const c = clamp(n);
          onChange(c);
          setDraft(String(c));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(String(value));
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const cur = Number(draft.trim());
          if (!Number.isFinite(cur)) return;
          const s = step ?? 1;
          const next = clamp(cur + (e.key === 'ArrowUp' ? s : -s));
          setDraft(String(next));
          onChange(next);
        }
      }}
      className={className}
    />
  );
}

interface HexFieldProps {
  /** Current hex string, e.g. "#0E1733". */
  value: string;
  /** Called with a normalized "#rrggbb" / "#rgb" when the draft is valid. */
  onChange: (hex: string) => void;
  className?: string;
}

export function HexField({ value, onChange, className }: HexFieldProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  return (
    <input
      type="text"
      spellCheck={false}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const norm = raw.startsWith('#') ? raw : `#${raw}`;
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(norm)) onChange(norm);
      }}
      onBlur={() => {
        setEditing(false);
        setDraft(value); // snap back to the canonical hex of the committed color
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}
