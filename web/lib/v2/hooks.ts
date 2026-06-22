'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLd, type LDConnState, type LDAgentEvent } from './native';
import type { AgentMessage } from './types';

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
