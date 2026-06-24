'use client';

import { useEffect } from 'react';
import { useUiStore } from '@/lib/v2/ui-store';
import { initAgentBridge, useAgentStore } from '@/lib/v2/agent-store';
import { TitleBar } from './TitleBar';
import { ActivityRail } from './ActivityRail';
import { AgentPanel } from './AgentPanel';
import { AssetCockpit } from './cockpit/AssetCockpit';
import { Designer } from './designer/Designer';
import { OnboardingModal } from './OnboardingModal';

export function AppShell() {
  const mode = useUiStore((s) => s.mode);
  const agentOpen = useUiStore((s) => s.agentOpen);
  const anyRunning = useAgentStore((s) => s.threads.some((t) => t.status === 'running'));
  const bumpArtifacts = useUiStore((s) => s.bumpArtifacts);

  // Wire the global agent event → thread demux once for the whole app.
  useEffect(() => initAgentBridge(), []);

  // Import-as-it-works: while any agent job runs, re-scan periodically so newly
  // created assets/views surface in the cockpit before the job even finishes.
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => bumpArtifacts(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, bumpArtifacts]);

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
      <OnboardingModal />
    </div>
  );
}
