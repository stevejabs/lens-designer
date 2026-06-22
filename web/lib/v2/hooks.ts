'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  getLd,
  type LDConnState,
  type LDAgentEvent,
  type LDScannedAsset,
  type LDScannedView,
  type LDViewField,
  type LDFieldKind,
} from './native';
import type { AgentMessage, AssetItem, DesignView } from './types';
import { MOCK_ASSETS, MOCK_VIEWS } from './mock-data';
import { useUiStore } from './ui-store';

function relTime(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toAssetItem(a: LDScannedAsset): AssetItem {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    status: 'ready',
    origin: a.origin,
    ...(a.prompt ? { prompt: a.prompt } : {}),
    updated: relTime(a.updatedMs),
    meta: { size: fmtSize(a.sizeBytes) },
    hasContext: a.hasContext,
  };
}

/** Real project assets in Electron; mock data in the browser. */
export function useAssets(): { assets: AssetItem[]; loading: boolean; refresh: () => void } {
  const [assets, setAssets] = useState<AssetItem[]>(() => (getLd() ? [] : MOCK_ASSETS));
  const [loading, setLoading] = useState(false);

  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const conn = useConnection();

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    setLoading(true);
    void ld.assets
      .list()
      .then((list) => setAssets(list.map(toAssetItem)))
      .finally(() => setLoading(false));
  }, []);

  // Re-scan on mount, after a run, and once the connection goes live (the
  // first mount usually precedes the LS connection being ready).
  useEffect(() => {
    if (conn.kind === 'connected') refresh();
  }, [refresh, artifactNonce, conn.kind]);

  return { assets, loading, refresh };
}

function toDesignView(v: LDScannedView): DesignView {
  return {
    id: v.id,
    name: v.name,
    module: v.module,
    origin: v.origin,
    updated: relTime(v.updatedMs),
  };
}

/** Real project views (UIKit modules) in Electron; mock in the browser. */
export function useViews(): { views: DesignView[]; refresh: () => void } {
  const [views, setViews] = useState<DesignView[]>(() => (getLd() ? [] : MOCK_VIEWS));
  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const conn = useConnection();

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    void ld.views.list().then((list) => setViews(list.map(toDesignView)));
  }, []);

  useEffect(() => {
    if (conn.kind === 'connected') refresh();
  }, [refresh, artifactNonce, conn.kind]);

  return { views, refresh };
}

/** Capture the live Lens Studio preview as an image data URL. */
export function usePreview(): { image: string | null; capturing: boolean; capture: () => void } {
  const [image, setImage] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const activeArtifact = useUiStore((s) => s.activeArtifact);
  const conn = useConnection();

  const capture = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    setCapturing(true);
    void ld.preview
      .capture()
      .then((img) => {
        if (img) setImage(img);
      })
      .finally(() => setCapturing(false));
  }, []);

  // Capture once connected, after edits (artifactNonce), and when the
  // selected view changes. Connected-trigger fixes the blank-on-open case.
  useEffect(() => {
    if (conn.kind === 'connected') capture();
  }, [capture, artifactNonce, conn.kind, activeArtifact?.path]);

  return { image, capturing, capture };
}

/** Editable design constants parsed from a view's source. */
export function useViewFields(path: string | null): {
  fields: LDViewField[];
  setField: (name: string, kind: LDFieldKind, value: number | number[] | string | boolean) => Promise<void>;
  saving: boolean;
} {
  const [fields, setFields] = useState<LDViewField[]>([]);
  const [saving, setSaving] = useState(false);
  const bumpArtifacts = useUiStore((s) => s.bumpArtifacts);

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld || !path) {
      setFields([]);
      return;
    }
    void ld.views.fields(path).then(setFields);
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setField = useCallback(
    async (name: string, kind: LDFieldKind, value: number | number[] | string | boolean) => {
      const ld = getLd();
      if (!ld || !path) return;
      // Optimistic local update.
      setFields((prev) => prev.map((f) => (f.name === name ? { ...f, value } : f)));
      setSaving(true);
      try {
        await ld.views.setField({ path, name, kind, value });
        bumpArtifacts(); // triggers a preview re-capture
      } finally {
        setSaving(false);
      }
    },
    [path, bumpArtifacts],
  );

  return { fields, setField, saving };
}

/** Returns [ref, inView] — true once the element scrolls near the viewport.
 *  Latches on so heavy content (3D thumbnails, media) loads lazily, once. */
export function useInView<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '150px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return [ref, inView];
}

/** Read a project media file (audio/glb/image) as a data URL for the viewers. */
export function useFileUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const ld = getLd();
    if (!ld || !path) {
      setUrl(null);
      return;
    }
    let alive = true;
    void ld.file.read(path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

/** Live LS connection state from the desktop shell (disconnected in browser). */
export function useConnection(): LDConnState {
  const [state, setState] = useState<LDConnState>({ kind: 'disconnected' });

  useEffect(() => {
    const ld = getLd();
    if (!ld) return;
    let alive = true;
    void ld.connection.get().then((s) => {
      if (alive) setState(s);
    });
    const off = ld.connection.onChange((s) => setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}

let msgSeq = 0;
const nextId = (): string => `m${++msgSeq}`;

/** An agent thread backed by the real `claude` CLI when running in Electron. */
export function useAgentThread(initial: AgentMessage[] = []) {
  const [messages, setMessages] = useState<AgentMessage[]>(initial);
  const [running, setRunning] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const electron = getLd() !== null;
  const activeArtifact = useUiStore((s) => s.activeArtifact);
  const artifactRef = useRef(activeArtifact);
  artifactRef.current = activeArtifact;
  // Holds the latest send() so the context-load effect can fire a queued
  // "Refine" prompt after the artifact's session is set (avoids ordering races).
  const sendRef = useRef<(p: string) => void>(() => {});

  const append = useCallback((m: AgentMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  // Load the selected artifact's saved conversation context (per-artifact
  // threads): seed prior prompts + the distilled summary, and target its
  // session for resume.
  const artifactPath = activeArtifact?.path ?? null;
  useEffect(() => {
    const ld = getLd();
    if (!ld || !artifactPath) return;
    // If a refine prompt is queued for this artifact, only resolve the session
    // (don't seed the prior thread) so the about-to-send message isn't clobbered.
    const skipSeed = useUiStore.getState().queuedPrompt != null;
    let alive = true;
    void ld.context.get(artifactPath).then((ctx) => {
      if (!alive) return;
      sessionRef.current = ctx?.sessionId ?? null;
      if (skipSeed) return;
      if (!ctx) {
        setMessages([]);
      } else {
        const seeded: AgentMessage[] = ctx.promptHistory.map((p, i) => ({
          id: `seed-${i}`,
          role: 'user' as const,
          text: p,
        }));
        if (ctx.distilledSummary) {
          seeded.push({ id: 'seed-summary', role: 'assistant', text: ctx.distilledSummary, status: 'done' });
        }
        setMessages(seeded);
      }
    });
    return () => {
      alive = false;
    };
  }, [artifactPath]);

  useEffect(() => {
    const ld = getLd();
    if (!ld) return;
    const off = ld.agent.onEvent((e: LDAgentEvent) => {
      switch (e.kind) {
        case 'session':
          sessionRef.current = e.sessionId;
          break;
        case 'assistant':
          append({ id: nextId(), role: 'assistant', text: e.text, status: 'done' });
          break;
        case 'tool':
          append({ id: nextId(), role: 'tool', text: `Running ${e.tool}`, tool: e.tool, status: 'running' });
          break;
        case 'tool-result':
          setMessages((prev) => {
            // Mark the most recent running tool row done.
            const idx = [...prev].reverse().findIndex((m) => m.role === 'tool' && m.status === 'running');
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const next = prev.slice();
            const target = next[realIdx];
            if (target) next[realIdx] = { ...target, status: e.ok ? 'done' : 'error' };
            return next;
          });
          break;
        case 'result':
          if (e.sessionId) sessionRef.current = e.sessionId;
          setRunning(false);
          break;
        case 'error':
          append({ id: nextId(), role: 'assistant', text: `⚠ ${e.message}`, status: 'error' });
          setRunning(false);
          break;
      }
    });
    return off;
  }, [append]);

  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      append({ id: nextId(), role: 'user', text: trimmed });
      const ld = getLd();
      if (!ld) {
        append({
          id: nextId(),
          role: 'assistant',
          text: 'Open Lens Designer in the desktop app to run this through your CLI + CLAD.',
          status: 'done',
        });
        return;
      }
      setRunning(true);
      const artifact = artifactRef.current;
      // Resolve the resumable session for this artifact if we don't have it
      // yet (e.g. refining an asset whose thread hasn't been opened this session).
      let resume = sessionRef.current;
      if (artifact && !resume) {
        const ctx = await ld.context.get(artifact.path);
        resume = ctx?.sessionId ?? null;
        sessionRef.current = resume;
      }
      try {
        await ld.agent.run({
          prompt: trimmed,
          ...(resume ? { resumeSessionId: resume } : {}),
          ...(artifact ? { artifactPath: artifact.path, artifactId: artifact.id } : {}),
        });
      } catch (err) {
        append({ id: nextId(), role: 'assistant', text: `⚠ ${(err as Error).message}`, status: 'error' });
        setRunning(false);
      }
    },
    [append],
  );
  sendRef.current = send;

  // Auto-send a queued "Refine" prompt. Works whether or not the artifact's
  // path changed (selecting an asset then refining it keeps the same path, so
  // this can't rely on the context-load effect).
  const queuedPrompt = useUiStore((s) => s.queuedPrompt);
  const clearQueuedPrompt = useUiStore((s) => s.clearQueuedPrompt);
  useEffect(() => {
    if (!queuedPrompt) return;
    clearQueuedPrompt();
    sendRef.current(queuedPrompt);
  }, [queuedPrompt, clearQueuedPrompt]);

  const cancel = useCallback(() => {
    void getLd()?.agent.cancel();
    setRunning(false);
  }, []);

  /** Start a fresh conversation: clear the thread + drop the resumable session. */
  const reset = useCallback(() => {
    void getLd()?.agent.cancel();
    sessionRef.current = null;
    setRunning(false);
    setMessages(getLd() ? [] : []);
  }, []);

  return { messages, running, send, cancel, reset, electron, sessionId: sessionRef.current };
}
