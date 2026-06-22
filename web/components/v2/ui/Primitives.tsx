'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/v2/cn';

/* ─────────────────────────  Button  ───────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'text-text-inverse bg-accent shadow-[0_2px_12px_-2px_var(--accent-glow)] hover:brightness-110 active:brightness-95 font-semibold',
  secondary:
    'text-text-primary bg-bg-3 border border-default hover:bg-bg-4 hover:border-strong',
  ghost:
    'text-text-secondary hover:text-text-primary hover:bg-bg-3',
  danger:
    'text-danger bg-transparent border border-[rgba(248,113,113,0.3)] hover:bg-[rgba(248,113,113,0.1)]',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'no-drag inline-flex items-center justify-center whitespace-nowrap',
        'transition-all duration-150 ease-spring select-none',
        'disabled:opacity-40 disabled:pointer-events-none',
        SIZE[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon && <span className="shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
      {children}
    </button>
  );
});

/* ─────────────────────────  IconButton  ───────────────────────── */

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      className={cn(
        'no-drag inline-flex items-center justify-center rounded-md transition-all duration-150 ease-spring',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        '[&>svg]:w-[18px] [&>svg]:h-[18px]',
        active
          ? 'text-accent-300 bg-[rgba(34,211,238,0.12)]'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-3',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ─────────────────────────  Pill / Badge  ───────────────────────── */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'violet';

const TONE: Record<Tone, string> = {
  neutral: 'text-text-secondary bg-bg-3 border-default',
  accent: 'text-accent-300 bg-[rgba(34,211,238,0.1)] border-[rgba(34,211,238,0.25)]',
  success: 'text-success bg-[rgba(52,211,153,0.1)] border-[rgba(52,211,153,0.25)]',
  warning: 'text-warning bg-[rgba(251,191,36,0.1)] border-[rgba(251,191,36,0.25)]',
  danger: 'text-danger bg-[rgba(248,113,113,0.1)] border-[rgba(248,113,113,0.25)]',
  violet: 'text-violet-400 bg-[rgba(139,92,246,0.1)] border-[rgba(139,92,246,0.25)]',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-5 px-2 rounded-full border text-2xs font-medium tracking-wide',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────  Segmented control  ───────────────────────── */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="no-drag inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-2 border border-subtle">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-all duration-150 ease-spring',
              '[&>svg]:w-3.5 [&>svg]:h-3.5',
              active
                ? 'bg-bg-4 text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────  Section label  ───────────────────────── */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-2xs font-semibold uppercase tracking-[0.08em] text-text-tertiary',
        className,
      )}
    >
      {children}
    </div>
  );
}
