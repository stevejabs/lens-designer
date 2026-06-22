'use client';

import { ChevronDown, Sparkles, PanelRight, Cable } from 'lucide-react';
import { useUiStore } from '@/lib/v2/ui-store';
import { cn } from '@/lib/v2/cn';
import { Logo } from './ui/Logo';
import { IconButton, Pill } from './ui/Primitives';
import type { ConnectionState } from '@/lib/v2/types';

const CONN_LABEL: Record<ConnectionState, string> = {
  connected: 'Lens Studio 5.22',
  connecting: 'Connecting…',
  disconnected: 'Not connected',
};

function ConnectionChip() {
  const connection = useUiStore((s) => s.connection);
  const dot =
    connection === 'connected'
      ? 'bg-success'
      : connection === 'connecting'
        ? 'bg-warning'
        : 'bg-text-tertiary';
  return (
    <button className="no-drag group flex items-center gap-2 h-7 pl-2 pr-2.5 rounded-md border border-subtle bg-bg-2 hover:bg-bg-3 hover:border-default transition-colors">
      <Cable className="w-3.5 h-3.5 text-text-tertiary" />
      <span className="flex items-center gap-1.5">
        <span className={cn('w-1.5 h-1.5 rounded-full', dot)} style={{ animation: connection === 'connecting' ? 'pulse-dot 1.2s ease-in-out infinite' : undefined }} />
        <span className="text-xs text-text-secondary">{CONN_LABEL[connection]}</span>
      </span>
      <span className="font-num text-2xs text-text-tertiary">:50040</span>
    </button>
  );
}

function PostureToggle() {
  const posture = useUiStore((s) => s.posture);
  const togglePosture = useUiStore((s) => s.togglePosture);
  return (
    <div className="no-drag flex items-center p-0.5 rounded-lg bg-bg-2 border border-subtle">
      {(['designing', 'running'] as const).map((p) => {
        const active = posture === p;
        return (
          <button
            key={p}
            onClick={() => posture !== p && togglePosture()}
            className={cn(
              'h-6 px-2.5 rounded-md text-2xs font-semibold uppercase tracking-wide transition-all duration-150 ease-spring',
              active && p === 'designing' && 'bg-accent text-text-inverse',
              active && p === 'running' && 'bg-success text-text-inverse',
              !active && 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            {p === 'designing' ? 'Design' : 'Run'}
          </button>
        );
      })}
    </div>
  );
}

export function TitleBar() {
  const toggleAgent = useUiStore((s) => s.toggleAgent);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const agentOpen = useUiStore((s) => s.agentOpen);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);

  return (
    <header className="drag-region relative z-20 flex items-center h-11 pl-20 pr-3 gap-3 border-b border-subtle bg-bg-0/80 glass">
      {/* Brand + project */}
      <div className="flex items-center gap-2.5">
        <Logo size={22} />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-text-primary tracking-tight">Lens Designer</span>
          <Pill tone="violet" className="ml-0.5">SPECS</Pill>
        </div>
      </div>

      <div className="w-px h-5 bg-border-subtle" />

      <button className="no-drag flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-bg-3 transition-colors text-text-secondary">
        <span className="text-sm font-medium text-text-primary">ld-specs-test</span>
        <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
      </button>

      {/* Center */}
      <div className="flex-1 flex items-center justify-center">
        <PostureToggle />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <ConnectionChip />
        <div className="w-px h-5 bg-border-subtle" />
        <IconButton label="Toggle agent" active={agentOpen} onClick={toggleAgent}>
          <Sparkles />
        </IconButton>
        <IconButton label="Toggle inspector" active={inspectorOpen} onClick={toggleInspector}>
          <PanelRight />
        </IconButton>
      </div>
    </header>
  );
}
