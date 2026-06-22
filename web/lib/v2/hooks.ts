'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLd, type LDConnState, type LDAgentEvent, type LDScannedAsset } from './native';
import type { AgentMessage, AssetItem } from './types';
import { MOCK_ASSETS } from './mock-data';

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

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    setLoading(true);
    void ld.assets
      .list()
      .then((list) => setAssets(list.map(toAssetItem)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { assets, loading, refresh };
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

  const append = useCallback((m: AgentMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

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
      try {
        await ld.agent.run({
          prompt: trimmed,
          ...(sessionRef.current ? { resumeSessionId: sessionRef.current } : {}),
        });
      } catch (err) {
        append({ id: nextId(), role: 'assistant', text: `⚠ ${(err as Error).message}`, status: 'error' });
        setRunning(false);
      }
    },
    [append],
  );

  const cancel = useCallback(() => {
    void getLd()?.agent.cancel();
    setRunning(false);
  }, []);

  return { messages, running, send, cancel, electron, sessionId: sessionRef.current };
}
