'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/v2/cn';

export function Group({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-subtle">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full h-9 px-4 group"
      >
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {title}
        </span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-text-tertiary transition-transform duration-150',
              !open && '-rotate-90',
            )}
          />
        </span>
      </button>
      {open && <div className="px-4 pb-3 space-y-2 animate-fade-in">{children}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-text-tertiary">{label}</span>
      <div className="flex-1 flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function NumField({
  value,
  suffix,
  icon,
}: {
  value: string | number;
  suffix?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 h-7 px-2 flex-1 rounded-md bg-bg-2 border border-subtle hover:border-default focus-within:border-strong transition-colors">
      {icon && <span className="text-text-tertiary [&>svg]:w-3 [&>svg]:h-3">{icon}</span>}
      <input
        defaultValue={value}
        className="w-full bg-transparent font-num text-xs text-text-primary outline-none"
      />
      {suffix && <span className="text-2xs text-text-tertiary">{suffix}</span>}
    </div>
  );
}

export function Swatch({ color, label }: { color: string; label?: string }) {
  return (
    <div className="flex items-center gap-2 h-7 px-2 flex-1 rounded-md bg-bg-2 border border-subtle hover:border-default transition-colors cursor-pointer">
      <span
        className="w-4 h-4 rounded shrink-0 border border-strong"
        style={{ background: color }}
      />
      <span className="font-num text-xs text-text-secondary uppercase">{label ?? color}</span>
    </div>
  );
}

export function Slider({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="relative flex-1 h-1 rounded-full bg-bg-3">
        <div className="absolute left-0 top-0 h-full rounded-full accent-bg" style={{ width: `${value}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-text-primary shadow-md border border-strong"
          style={{ left: `${value}%` }}
        />
      </div>
      <span className="font-num text-2xs text-text-tertiary w-7 text-right">{value}%</span>
    </div>
  );
}

export function Toggle({ on }: { on: boolean }) {
  const [v, setV] = useState(on);
  return (
    <button
      onClick={() => setV((x) => !x)}
      className={cn(
        'relative w-8 h-[18px] rounded-full transition-colors duration-150',
        v ? 'accent-bg' : 'bg-bg-3',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-150 ease-spring',
          v ? 'left-[16px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

export function StateTabs() {
  const states = ['Default', 'Hover', 'Pressed', 'Disabled'];
  const [active, setActive] = useState('Default');
  return (
    <div className="flex items-center gap-1 p-0.5 rounded-md bg-bg-2 border border-subtle">
      {states.map((s) => (
        <button
          key={s}
          onClick={() => setActive(s)}
          className={cn(
            'flex-1 h-6 rounded text-2xs font-medium transition-colors',
            active === s ? 'bg-bg-4 text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
