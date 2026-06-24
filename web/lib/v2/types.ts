// Shared domain types for the v2 cockpit UI.

export type WorkspaceMode = 'design' | 'assets';

export type Posture = 'designing' | 'running';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export type AssetKind = 'mesh' | 'music' | 'sfx';

export type AssetStatus = 'ready' | 'generating' | 'failed';

export type AssetBackend = 'glb' | 'script' | 'audio';

export interface AssetItem {
  id: string;
  name: string;
  kind: AssetKind;
  /** How a mesh is realized: baked GLB vs. code-authored TS script. */
  backend: AssetBackend;
  status: AssetStatus;
  /** Short human summary of how it was made (from the distilled context). */
  origin: 'prompt' | 'import';
  prompt?: string;
  /** ISO-ish display string; mock data only. */
  updated: string;
  /** Mesh-only display metadata. */
  meta?: Record<string, string>;
  /** Whether this asset carries a resumable agentic thread. */
  hasContext: boolean;
}

export interface DesignView {
  id: string;
  name: string;
  /** Emitted controller module path, when published. */
  module?: string;
  /** Born from a CLAD prompt vs. drawn by hand. */
  origin: 'prompt' | 'wysiwyg';
  updated: string;
}

export type AgentRole = 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  id: string;
  role: AgentRole;
  text: string;
  /** For tool rows: the CLAD skill / MCP tool invoked. */
  tool?: string;
  status?: 'running' | 'done' | 'error';
}
