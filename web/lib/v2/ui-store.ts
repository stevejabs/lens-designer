import { create } from 'zustand';
import type { WorkspaceMode, Posture, ConnectionState } from './types';

// Cockpit shell UI state. Deliberately separate from any design-document or
// agent-thread store — this is chrome/navigation/selection state. Agent
// threads live in agent-store.ts.
interface UiState {
  mode: WorkspaceMode;
  posture: Posture;
  connection: ConnectionState;
  agentOpen: boolean;
  inspectorOpen: boolean;
  selectedAssetId: string | null;
  selectedViewId: string | null;
  /** Bumps when a job finishes, so asset/view/preview lists refresh. */
  artifactNonce: number;
  /** The artifact (view/asset) the workspace + preview are scoped to. */
  activeArtifact: { path: string; id: string; name: string; kind: 'view' | 'asset' } | null;
  /** The selected UIKit element in the Designer's live element tree. */
  selectedElement: { id: string; name: string; type: string | null } | null;

  setMode: (mode: WorkspaceMode) => void;
  setPosture: (posture: Posture) => void;
  togglePosture: () => void;
  setConnection: (c: ConnectionState) => void;
  toggleAgent: () => void;
  setAgentOpen: (open: boolean) => void;
  toggleInspector: () => void;
  selectAsset: (id: string | null) => void;
  selectView: (id: string | null) => void;
  /** Signal that project artifacts likely changed (a job finished). */
  bumpArtifacts: () => void;
  setActiveArtifact: (a: UiState['activeArtifact']) => void;
  setSelectedElement: (e: UiState['selectedElement']) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: 'assets',
  posture: 'designing',
  connection: 'connected',
  agentOpen: true,
  inspectorOpen: true,
  selectedAssetId: 'a1',
  selectedViewId: 'v1',
  artifactNonce: 0,
  activeArtifact: null,
  selectedElement: null,

  setMode: (mode) => set({ mode }),
  setPosture: (posture) => set({ posture }),
  togglePosture: () => set((s) => ({ posture: s.posture === 'designing' ? 'running' : 'designing' })),
  setConnection: (connection) => set({ connection }),
  toggleAgent: () => set((s) => ({ agentOpen: !s.agentOpen })),
  setAgentOpen: (agentOpen) => set({ agentOpen }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),
  selectView: (selectedViewId) => set({ selectedViewId }),
  bumpArtifacts: () => set((s) => ({ artifactNonce: s.artifactNonce + 1 })),
  setActiveArtifact: (activeArtifact) => set({ activeArtifact, selectedElement: null }),
  setSelectedElement: (selectedElement) => set({ selectedElement }),
}));
