import { create } from 'zustand';
import type { WorkspaceMode, Posture, ConnectionState } from './types';

// Cockpit shell UI state. Deliberately separate from any design-document
// store — this is chrome/navigation state, not project data.
interface UiState {
  mode: WorkspaceMode;
  posture: Posture;
  connection: ConnectionState;
  agentOpen: boolean;
  inspectorOpen: boolean;
  selectedAssetId: string | null;
  selectedViewId: string | null;
  /** One-shot prompt text pushed into the Agent composer (e.g. New Asset). */
  agentPrefill: string | null;
  /** Bumps to signal the Agent panel to start a fresh conversation. */
  agentResetNonce: number;
  /** Bumps when an agent run completes, so asset/view lists refresh. */
  artifactNonce: number;

  setMode: (mode: WorkspaceMode) => void;
  setPosture: (posture: Posture) => void;
  togglePosture: () => void;
  setConnection: (c: ConnectionState) => void;
  toggleAgent: () => void;
  setAgentOpen: (open: boolean) => void;
  toggleInspector: () => void;
  selectAsset: (id: string | null) => void;
  selectView: (id: string | null) => void;
  /** Open the agent panel and seed the composer with `text`. `fresh` starts a new thread. */
  promptAgent: (text: string, fresh?: boolean) => void;
  clearAgentPrefill: () => void;
  /** Start a fresh agent conversation (clears thread + session). */
  newAgentThread: () => void;
  /** Signal that project artifacts likely changed (agent run finished). */
  bumpArtifacts: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: 'assets',
  posture: 'designing',
  connection: 'connected',
  agentOpen: true,
  inspectorOpen: true,
  selectedAssetId: 'a1',
  selectedViewId: 'v1',
  agentPrefill: null,
  agentResetNonce: 0,
  artifactNonce: 0,

  setMode: (mode) => set({ mode }),
  setPosture: (posture) => set({ posture }),
  togglePosture: () =>
    set((s) => ({ posture: s.posture === 'designing' ? 'running' : 'designing' })),
  setConnection: (connection) => set({ connection }),
  toggleAgent: () => set((s) => ({ agentOpen: !s.agentOpen })),
  setAgentOpen: (agentOpen) => set({ agentOpen }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),
  selectView: (selectedViewId) => set({ selectedViewId }),
  promptAgent: (text, fresh) =>
    set((s) => ({
      agentPrefill: text,
      agentOpen: true,
      ...(fresh ? { agentResetNonce: s.agentResetNonce + 1 } : {}),
    })),
  clearAgentPrefill: () => set({ agentPrefill: null }),
  newAgentThread: () =>
    set((s) => ({ agentResetNonce: s.agentResetNonce + 1, agentOpen: true })),
  bumpArtifacts: () => set((s) => ({ artifactNonce: s.artifactNonce + 1 })),
}));
