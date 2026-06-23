'use client';

import { useEffect } from 'react';
import { useUiStore } from '@/lib/v2/ui-store';
import { initAgentBridge } from '@/lib/v2/agent-store';
import { TitleBar } from './TitleBar';
import { ActivityRail } from './ActivityRail';
import { AgentPanel } from './AgentPanel';
import { AssetCockpit } from './cockpit/AssetCockpit';
import { Designer } from './designer/Designer';

export function AppShell() {
  const mode = useUiStore((s) => s.mode);
  const agentOpen = useUiStore((s) => s.agentOpen);

  // Wire the global agent event → thread demux once for the whole app.
  useEffect(() => initAgentBridge(), []);

  return (
    <div className="app-aurora flex flex-col h-screen w-screen overflow-hidden text-text-primary">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <ActivityRail />
        <main className="flex flex-1 min-h-0">
          {mode === 'assets' ? <AssetCockpit /> : <Designer />}
        </main>
        {agentOpen && <AgentPanel />}
      </div>
    </div>
  );
}
