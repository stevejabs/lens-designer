'use client';

import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/v2/cn';

/** A textarea that grows with its content (word-wrapping onto new lines) up to
 *  a max height, then scrolls. Enter submits; Shift+Enter inserts a newline —
 *  the convention in most AI chat UIs. */
export function AutoTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  className,
  disabled,
  maxRows = 8,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxRows?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Reflow to fit content on every value change.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const maxH = lineH * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [value, maxRows]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      autoFocus={autoFocus}
      className={cn('resize-none outline-none', className)}
    />
  );
}
