// agent-store.ts — many concurrent agent threads, one per job, monitorable
// side-by-side. This is what lets the user fire off a mesh, an SFX and a UI
// build at once and watch all three.
//
// A single global subscription to `ld.agent.onEvent` / `onJobMeta` demuxes
// streamed events by jobId into the thread that owns that job. Each thread is
// an independent conversation with its own session, status, and draft.

import { create } from 'zustand';
import { getLd, type LDAgentEvent, type LDJobMeta, type LDJobKind, type LDBuildStepKind } from './native';
import { useUiStore } from './ui-store';
import type { AgentMessage, AssetItem } from './types';

export type BuildPhase = 'idle' | 'planning' | 'building' | 'done' | 'error';
export interface BuildSession {
  phase: BuildPhase;
  prompt: string;
  summary: string;
  /** Threads (one per manifest step) whose statuses drive the progress UI. */
  stepThreadIds: string[];
  error?: string;
}

export type ThreadMode = 'create' | 'refine' | 'chat';
export type ThreadStatus = 'idle' | 'running' | 'done' | 'error';

export interface Thread {
  id: string;
  title: string;
  kind: LDJobKind;
  mode: ThreadMode;
  /** Canonical artifact this thread is scoped to (refine/created asset). */
  artifactPath: string | null;
  sessionId: string | null;
  /** The job currently streaming into this thread (for event demux). */
  currentJobId: string | null;
  hasRun: boolean;
  status: ThreadStatus;
  note: string | null;
  draft: string;
  messages: AgentMessage[];
}

let threadSeq = 0;
const nextThreadId = (): string => `t${++threadSeq}`;
let msgSeq = 0;
const nextMsgId = (): string => `am${++msgSeq}`;

const KIND_LABEL: Record<LDJobKind, string> = {
  mesh: '3D asset',
  music: 'music',
  sfx: 'SFX',
  ui: 'UI view',
  code: 'code',
};

function blankThread(partial: Partial<Thread> = {}): Thread {
  return {
    id: nextThreadId(),
    title: 'Chat',
    kind: 'code',
    mode: 'chat',
    artifactPath: null,
    sessionId: null,
    currentJobId: null,
    hasRun: false,
    status: 'idle',
    note: null,
    draft: '',
    messages: [],
    ...partial,
  };
}

interface AgentState {
  threads: Thread[];
  activeId: string | null;
  build: BuildSession;

  setActive: (id: string) => void;
  newChat: () => string;
  /** Open a generation thread for `kind` (asset/ui), optionally prefilled. */
  openCreate: (kind: LDJobKind, draft?: string) => string;
  closeThread: (id: string) => void;
  setDraft: (id: string, draft: string) => void;
  /** Send the active thread's draft (or `text`) — routes create vs. chat. */
  send: (id: string, text?: string) => void;
  /** Start a refine thread for an asset and immediately run it. */
  refineAsset: (asset: AssetItem, text: string) => void;
  /** Apply a WYSIWYG element edit by routing it to the agent (edits the view
   *  source + recompiles). Makes every element property live-editable. */
  editElement: (req: {
    viewPath: string;
    elementName: string;
    elementType: string | null;
    changes: { label: string; value: string }[];
  }) => void;
  cancel: (id: string) => void;

  /** Orchestrate a whole-experience build: plan a manifest, then fire one
   *  tracked job per step. Progress is read off the per-step threads. */
  startBuild: (prompt: string) => Promise<void>;
  dismissBuild: () => void;

  // internal
  _patch: (id: string, fn: (t: Thread) => Thread) => void;
  _byJob: (jobId: string) => Thread | undefined;
  _failThread: (id: string, err: Error) => void;
  _checkBuildDone: () => void;
  _onEvent: (e: LDAgentEvent) => void;
  _onMeta: (m: LDJobMeta) => void;
}

const IDLE_BUILD: BuildSession = { phase: 'idle', prompt: '', summary: '', stepThreadIds: [] };

export const useAgentStore = create<AgentState>((set, get) => ({
  threads: [blankThread()],
  activeId: null,
  build: IDLE_BUILD,

  setActive: (id) => set({ activeId: id }),

  newChat: () => {
    const t = blankThread();
    set((s) => ({ threads: [...s.threads, t], activeId: t.id }));
    return t.id;
  },

  openCreate: (kind, draft = '') => {
    const t = blankThread({
      kind,
      mode: 'create',
      title: `New ${KIND_LABEL[kind]}`,
      draft,
    });
    set((s) => ({ threads: [...s.threads, t], activeId: t.id }));
    return t.id;
  },

  closeThread: (id) =>
    set((s) => {
      const threads = s.threads.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? (threads[threads.length - 1]?.id ?? null) : s.activeId;
      return { threads: threads.length ? threads : [blankThread()], activeId };
    }),

  setDraft: (id, draft) => get()._patch(id, (t) => ({ ...t, draft })),

  send: (id, text) => {
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    const body = (text ?? thread.draft).trim();
    if (!body || thread.status === 'running') return;

    get()._patch(id, (t) => ({
      ...t,
      draft: '',
      status: 'running',
      messages: [...t.messages, { id: nextMsgId(), role: 'user', text: body }],
    }));

    const ld = getLd();
    if (!ld) {
      get()._patch(id, (t) => ({
        ...t,
        status: 'done',
        messages: [
          ...t.messages,
          {
            id: nextMsgId(),
            role: 'assistant',
            text: 'Open Lens Designer in the desktop app to run this through your CLI + CLAD.',
            status: 'done',
          },
        ],
      }));
      return;
    }

    const firstCreate = thread.mode === 'create' && !thread.hasRun;
    const isAssetKind =
      thread.kind === 'mesh' || thread.kind === 'music' || thread.kind === 'sfx';

    const track = (jobId: string): void =>
      get()._patch(id, (t) => ({ ...t, currentJobId: jobId, hasRun: true }));

    if (firstCreate && isAssetKind) {
      void ld.asset
        .create({ kind: thread.kind as 'mesh' | 'music' | 'sfx', userText: body })
        .then((r) => track(r.jobId))
        .catch((err) => get()._failThread(id, err));
    } else if (firstCreate) {
      void ld.agent
        .run({ prompt: body, kind: thread.kind, mode: 'create', title: thread.title })
        .then((r) => track(r.jobId))
        .catch((err) => get()._failThread(id, err));
    } else {
      void ld.agent
        .run({
          prompt: body,
          kind: thread.kind,
          mode: 'chat',
          ...(thread.sessionId ? { resumeSessionId: thread.sessionId } : {}),
          ...(thread.artifactPath
            ? { artifactPath: thread.artifactPath, artifactId: thread.artifactPath }
            : {}),
        })
        .then((r) => track(r.jobId))
        .catch((err) => get()._failThread(id, err));
    }
  },

  refineAsset: (asset, text) => {
    // Reuse an open thread already scoped to this asset; else make one.
    const existing = get().threads.find((t) => t.artifactPath === asset.id);
    const id = existing?.id ?? nextThreadId();
    if (!existing) {
      const t = blankThread({
        id,
        kind: asset.kind,
        mode: 'refine',
        title: `Refine ${asset.name}`,
        artifactPath: asset.id,
      });
      set((s) => ({ threads: [...s.threads, t], activeId: id }));
    } else {
      set({ activeId: id });
    }

    get()._patch(id, (t) => ({
      ...t,
      status: 'running',
      hasRun: true,
      messages: [...t.messages, { id: nextMsgId(), role: 'user', text }],
    }));

    const ld = getLd();
    if (!ld) {
      get()._failThread(id, new Error('desktop app required'));
      return;
    }
    void ld.asset
      .refine({ artifactPath: asset.id, userText: text })
      .then((r) => get()._patch(id, (t) => ({ ...t, currentJobId: r.jobId })))
      .catch((err) => get()._failThread(id, err));
  },

  editElement: ({ viewPath, elementName, elementType, changes }) => {
    const summary = changes.map((c) => `${c.label} → ${c.value}`).join(', ');
    const prompt =
      `In the SpectaclesUIKit view at this exact file path: ${viewPath}\n` +
      `Modify the element named "${elementName}"${elementType ? ` (a ${elementType})` : ''}: ` +
      changes.map((c) => `set its ${c.label} to ${c.value}`).join('; ') +
      `.\nEdit the view's TypeScript source to apply this, then recompile so Lens Studio re-renders it. ` +
      `Keep every other element unchanged.`;

    // Reuse a thread scoped to this view; else open one.
    const existing = get().threads.find((t) => t.artifactPath === viewPath && t.kind === 'ui');
    const id = existing?.id ?? nextThreadId();
    if (!existing) {
      const t = blankThread({ id, kind: 'ui', mode: 'chat', title: `Edit ${elementName}`, artifactPath: viewPath });
      set((s) => ({ threads: [...s.threads, t], activeId: id }));
    } else {
      set({ activeId: id });
    }
    get()._patch(id, (t) => ({
      ...t,
      status: 'running',
      hasRun: true,
      messages: [...t.messages, { id: nextMsgId(), role: 'user', text: `${elementName}: ${summary}` }],
    }));

    const ld = getLd();
    if (!ld) {
      get()._failThread(id, new Error('Open the desktop app to edit.'));
      return;
    }
    void ld.agent
      .run({
        prompt,
        kind: 'ui',
        mode: 'chat',
        title: `Edit ${elementName}`,
        artifactPath: viewPath,
        artifactId: viewPath,
        ...(existing?.sessionId ? { resumeSessionId: existing.sessionId } : {}),
      })
      .then((r) => get()._patch(id, (t) => ({ ...t, currentJobId: r.jobId })))
      .catch((err) => get()._failThread(id, err));
  },

  cancel: (id) => {
    const t = get().threads.find((x) => x.id === id);
    if (t?.currentJobId) void getLd()?.agent.cancel(t.currentJobId);
    get()._patch(id, (x) => ({ ...x, status: 'idle' }));
  },

  startBuild: async (prompt) => {
    set({ build: { phase: 'planning', prompt, summary: '', stepThreadIds: [] } });
    const ld = getLd();
    if (!ld) {
      set({ build: { phase: 'error', prompt, summary: '', stepThreadIds: [], error: 'Open the desktop app to build.' } });
      return;
    }
    let manifest;
    try {
      manifest = await ld.build.plan({ prompt });
    } catch (err) {
      set({ build: { phase: 'error', prompt, summary: '', stepThreadIds: [], error: (err as Error).message } });
      return;
    }
    if (!manifest.steps.length) {
      set({ build: { phase: 'error', prompt, summary: '', stepThreadIds: [], error: 'The planner returned no steps. Try a more specific prompt.' } });
      return;
    }
    // One tracked thread + create job per manifest step. They run concurrently
    // (asset jobs free; UI jobs serialize on the scene lease in the bridge).
    const ids: string[] = [];
    for (const step of manifest.steps) {
      const t = blankThread({
        kind: step.kind as LDJobKind,
        mode: 'create',
        title: step.name,
      });
      set((s) => ({ threads: [...s.threads, t] }));
      ids.push(t.id);
      get().send(t.id, step.description);
    }
    set({ build: { phase: 'building', prompt, summary: manifest.summary, stepThreadIds: ids } });
  },

  dismissBuild: () => set({ build: IDLE_BUILD }),

  _patch: (id, fn) =>
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? fn(t) : t)) })),

  _byJob: (jobId) => get().threads.find((t) => t.currentJobId === jobId),

  _checkBuildDone: () => {
    const { build, threads } = get();
    if (build.phase !== 'building') return;
    const steps = build.stepThreadIds
      .map((id) => threads.find((t) => t.id === id))
      .filter((t): t is Thread => t !== undefined);
    if (steps.length > 0 && steps.every((t) => t.status === 'done' || t.status === 'error')) {
      set({ build: { ...build, phase: 'done' } });
    }
  },

  _failThread: (id, err) =>
    get()._patch(id, (t) => ({
      ...t,
      status: 'error',
      messages: [
        ...t.messages,
        { id: nextMsgId(), role: 'assistant', text: `⚠ ${err.message}`, status: 'error' },
      ],
    })),

  _onEvent: (e) => {
    const thread = get()._byJob(e.jobId);
    if (!thread) return;
    const id = thread.id;
    switch (e.kind) {
      case 'session':
        get()._patch(id, (t) => ({ ...t, sessionId: e.sessionId }));
        break;
      case 'assistant':
        get()._patch(id, (t) => ({
          ...t,
          messages: [...t.messages, { id: nextMsgId(), role: 'assistant', text: e.text, status: 'done' }],
        }));
        break;
      case 'tool':
        get()._patch(id, (t) => ({
          ...t,
          messages: [
            ...t.messages,
            { id: nextMsgId(), role: 'tool', text: `Running ${e.tool}`, tool: e.tool, status: 'running' },
          ],
        }));
        break;
      case 'tool-result':
        get()._patch(id, (t) => {
          const msgs = t.messages.slice();
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m && m.role === 'tool' && m.status === 'running') {
              msgs[i] = { ...m, status: e.ok ? 'done' : 'error' };
              break;
            }
          }
          return { ...t, messages: msgs };
        });
        break;
      case 'result':
        get()._patch(id, (t) => ({
          ...t,
          status: e.ok ? 'done' : 'error',
          ...(e.sessionId ? { sessionId: e.sessionId } : {}),
        }));
        break;
      case 'error':
        get()._patch(id, (t) => ({
          ...t,
          status: 'error',
          messages: [...t.messages, { id: nextMsgId(), role: 'assistant', text: `⚠ ${e.message}`, status: 'error' }],
        }));
        break;
    }
  },

  _onMeta: (m) => {
    const thread = get()._byJob(m.jobId);
    if (thread) {
      const status: ThreadStatus = m.status === 'cancelled' ? 'idle' : m.status;
      get()._patch(thread.id, (t) => ({
        ...t,
        status,
        note: m.note,
        ...(m.artifactPath ? { artifactPath: m.artifactPath } : {}),
      }));
    }
    // A job touched the project — refresh asset/view lists and, for a created
    // asset, surface it in the cockpit.
    useUiStore.getState().bumpArtifacts();
    if (m.artifactPath) {
      const ui = useUiStore.getState();
      const t = thread;
      // Don't yank selection around mid-build (many assets land); only jump to
      // a created asset for a standalone create.
      if (t?.mode === 'create' && get().build.phase !== 'building') {
        ui.selectAsset(m.artifactPath);
        ui.setActiveArtifact({ path: m.artifactPath, id: m.artifactPath, name: m.artifactPath.split('/').pop() ?? '', kind: 'asset' });
      }
    }
    get()._checkBuildDone();
  },
}));

let bridged = false;
/** Wire the global event → thread demux once. Call from the app shell. */
export function initAgentBridge(): () => void {
  const ld = getLd();
  if (!ld || bridged) return () => {};
  bridged = true;
  const offEvent = ld.agent.onEvent((e) => useAgentStore.getState()._onEvent(e));
  const offMeta = ld.agent.onJobMeta((m) => useAgentStore.getState()._onMeta(m));
  return () => {
    offEvent();
    offMeta();
    bridged = false;
  };
}
