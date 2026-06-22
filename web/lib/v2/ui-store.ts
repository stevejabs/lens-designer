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

  setMode: (mode: WorkspaceMode) => void;
  setPosture: (posture: Posture) => void;
  togglePosture: () => void;
  setConnection: (c: ConnectionState) => void;
  toggleAgent: () => void;
  setAgentOpen: (open: boolean) => void;
  toggleInspector: () => void;
  selectAsset: (id: string | null) => void;
  selectView: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: 'assets',
  posture: 'designing',
  connection: 'connected',
  agentOpen: true,
  inspectorOpen: true,
  selectedAssetId: 'a1',
  selectedViewId: 'v1',

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
}));
