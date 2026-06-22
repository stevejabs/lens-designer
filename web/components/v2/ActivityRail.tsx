'use client';

import { LayoutGrid, Frame, Settings, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { cn } from '@/lib/v2/cn';
import type { WorkspaceMode } from '@/lib/v2/types';

const NAV: { mode: WorkspaceMode; label: string; icon: LucideIcon }[] = [
  { mode: 'design', label: 'Designer', icon: Frame },
  { mode: 'assets', label: 'Assets', icon: LayoutGrid },
];

function RailButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active?: boolean;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'group relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150 ease-spring',
        active ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-2',
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full accent-bg shadow-[0_0_10px_var(--accent-glow)]" />
      )}
      <span
        className={cn(
          'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150',
          active && 'bg-[rgba(34,211,238,0.1)] border border-[rgba(34,211,238,0.2)]',
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
    </button>
  );
}

export function ActivityRail() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);

  return (
    <nav className="z-10 flex flex-col items-center justify-between w-14 py-3 border-r border-subtle bg-bg-0">
      <div className="flex flex-col items-center gap-1.5">
        {NAV.map((n) => (
          <RailButton
            key={n.mode}
            active={mode === n.mode}
            label={n.label}
            icon={n.icon}
            onClick={() => setMode(n.mode)}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <RailButton label="Help" icon={HelpCircle} />
        <RailButton label="Settings" icon={Settings} />
      </div>
    </nav>
  );
}
