// Placeholder content so the cockpit reads as a real, populated tool while
// the Phase 0 plumbing (direct MCP + agent SDK) is wired underneath. Every
// value here is display-only and will be replaced by live project state.
import type { AssetItem, DesignView, AgentMessage } from './types';

export const MOCK_ASSETS: AssetItem[] = [
  {
    id: 'a1',
    name: 'Treasure Chest',
    kind: 'mesh',
    status: 'ready',
    origin: 'prompt',
    prompt: 'low-poly wooden treasure chest with a brass lock',
    updated: '2m ago',
    meta: { tris: '1.4k', size: '18 × 12 × 11 cm', backend: 'SPECS Text-to-3D' },
    hasContext: true,
  },
  {
    id: 'a2',
    name: 'Ambient Pad',
    kind: 'music',
    status: 'ready',
    origin: 'prompt',
    prompt: 'warm evolving ambient pad in C minor, 24s loop',
    updated: '14m ago',
    meta: { length: '0:24', key: 'C minor', bpm: '70' },
    hasContext: true,
  },
  {
    id: 'a3',
    name: 'UI Tap',
    kind: 'sfx',
    status: 'ready',
    origin: 'prompt',
    prompt: 'soft confirmation tap, short and clean',
    updated: '14m ago',
    meta: { length: '0:00.3', backend: 'algorithmic' },
    hasContext: true,
  },
  {
    id: 'a4',
    name: 'Crystal Cluster',
    kind: 'mesh',
    status: 'generating',
    origin: 'prompt',
    prompt: 'faceted glowing crystal cluster, emissive cyan',
    updated: 'now',
    hasContext: true,
  },
  {
    id: 'a5',
    name: 'Door Whoosh',
    kind: 'sfx',
    status: 'ready',
    origin: 'import',
    updated: '1h ago',
    meta: { length: '0:01.1' },
    hasContext: false,
  },
  {
    id: 'a6',
    name: 'Coin Pickup',
    kind: 'sfx',
    status: 'ready',
    origin: 'prompt',
    prompt: 'bright retro coin pickup, 8-bit',
    updated: '1h ago',
    meta: { length: '0:00.4' },
    hasContext: true,
  },
];

export const MOCK_VIEWS: DesignView[] = [
  { id: 'v1', name: 'Settings Panel', module: 'SettingsPanel.ts', origin: 'prompt', updated: '5m ago' },
  { id: 'v2', name: 'Status HUD', module: 'StatusHUD.ts', origin: 'wysiwyg', updated: '32m ago' },
  { id: 'v3', name: 'Media Player', module: 'MediaPlayer.ts', origin: 'prompt', updated: '2h ago' },
];

export const MOCK_THREAD: AgentMessage[] = [
  { id: 'm1', role: 'user', text: 'Make me a settings panel with two toggles and a volume slider.' },
  { id: 'm2', role: 'tool', text: 'Composing UIKit layout', tool: '/specs-build-ui', status: 'done' },
  { id: 'm3', role: 'tool', text: 'Recompiling TypeScript', tool: 'RecompileTypeScript', status: 'done' },
  {
    id: 'm4',
    role: 'assistant',
    text: 'Built SettingsPanel — a BackPlate column with Notifications and Spatial Audio toggles and a Volume slider, rendered in preview. Imported it onto the canvas so you can drag-adjust or keep prompting.',
    status: 'done',
  },
];
