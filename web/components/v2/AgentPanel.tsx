'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Wrench, Check, Loader2, Terminal, Plus, Square } from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { MOCK_THREAD } from '@/lib/v2/mock-data';
import { useAgentThread } from '@/lib/v2/hooks';
import { useUiStore } from '@/lib/v2/ui-store';
import { getLd } from '@/lib/v2/native';
import type { AgentMessage } from '@/lib/v2/types';
import { Pill } from './ui/Primitives';

function ToolRow({ msg }: { msg: AgentMessage }) {
  return (
    <div className="flex items-center gap-2 pl-1 py-1 text-xs text-text-tertiary">
      <span className="flex items-center justify-center w-5 h-5 rounded-md bg-bg-2 border border-subtle">
        {msg.status === 'running' ? (
          <Loader2 className="w-3 h-3 animate-spin text-accent-400" />
        ) : msg.status === 'error' ? (
          <Wrench className="w-3 h-3 text-danger" />
        ) : (
          <Check className="w-3 h-3 text-success" />
        )}
      </span>
      <span className="text-text-secondary">{msg.text}</span>
      {msg.tool && (
        <code className="font-num text-2xs text-accent-300/80 px-1.5 py-0.5 rounded bg-[rgba(34,211,238,0.07)]">
          {msg.tool}
        </code>
      )}
    </div>
  );
}

function MessageRow({ msg }: { msg: AgentMessage }) {
  if (msg.role === 'tool') return <ToolRow msg={msg} />;

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] px-3 py-2 rounded-lg rounded-br-sm bg-bg-3 text-text-primary text-sm border border-default">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 animate-fade-in">
      <span className="shrink-0 mt-0.5 flex items-center justify-center w-6 h-6 rounded-md accent-bg shadow-[0_0_12px_-2px_var(--accent-glow)]">
        <Sparkles className="w-3.5 h-3.5 text-text-inverse" />
      </span>
      <div className="text-sm text-text-secondary leading-relaxed pt-0.5">{msg.text}</div>
    </div>
  );
}

const SUGGESTIONS = [
  'Generate a low-poly treasure chest',
  'Build a settings panel with a volume slider',
  'Make a warm ambient loop',
];

export function AgentPanel() {
  const [draft, setDraft] = useState('');
  const { messages, running, send, cancel, reset, electron } = useAgentThread(MOCK_THREAD);
  const cliConnected = electron;

  // Which CLI the generative channel uses (Claude Code / Codex).
  const [cliName, setCliName] = useState('Claude Code');
  useEffect(() => {
    void getLd()
      ?.agent.cli()
      .then((n) => setCliName(n === 'codex' ? 'Codex' : 'Claude Code'));
  }, []);

  // Consume a one-shot prefill pushed from elsewhere (e.g. New Asset → prompt).
  const agentPrefill = useUiStore((s) => s.agentPrefill);
  const clearAgentPrefill = useUiStore((s) => s.clearAgentPrefill);
  useEffect(() => {
    if (agentPrefill) {
      setDraft(agentPrefill);
      clearAgentPrefill();
    }
  }, [agentPrefill, clearAgentPrefill]);

  // Start a fresh conversation when something bumps the reset nonce
  // (New Asset, the + button). Skip the initial mount value.
  const resetNonce = useUiStore((s) => s.agentResetNonce);
  const newAgentThread = useUiStore((s) => s.newAgentThread);
  const bumpArtifacts = useUiStore((s) => s.bumpArtifacts);
  const seenNonce = useRef(resetNonce);
  useEffect(() => {
    if (resetNonce !== seenNonce.current) {
      seenNonce.current = resetNonce;
      reset();
    }
  }, [resetNonce, reset]);

  // When a run finishes (running true → false), the agent may have created or
  // changed assets/views in the project — refresh those lists.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) bumpArtifacts();
    wasRunning.current = running;
  }, [running, bumpArtifacts]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft('');
    void send(text);
  };

  // Sticky auto-scroll: follow new messages, but don't yank the view if the
  // user has scrolled up to read earlier in the thread.
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const onThreadScroll = (): void => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  return (
    <aside className="flex flex-col w-[340px] shrink-0 border-l border-subtle bg-bg-0">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-subtle">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-400" />
          <span className="text-sm font-semibold text-text-primary">Agent</span>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={cliConnected ? 'success' : 'neutral'}>
            <Terminal className="w-3 h-3" />
            {cliName}
          </Pill>
          <button
            onClick={() => newAgentThread()}
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
            title="New thread"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thread */}
      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
            Settings Panel
          </span>
          <span className="text-2xs text-text-tertiary">· context saved</span>
        </div>
        {messages.map((m) => (
          <MessageRow key={m.id} msg={m} />
        ))}
        {running && (
          <div className="flex items-center gap-2 pl-1 text-xs text-text-tertiary">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-400" />
            Working…
            <button
              onClick={cancel}
              className="ml-1 flex items-center gap-1 px-1.5 h-5 rounded text-2xs text-danger border border-[rgba(248,113,113,0.3)] hover:bg-[rgba(248,113,113,0.1)] transition-colors"
            >
              <Square className="w-2.5 h-2.5 fill-current" /> Stop
            </button>
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setDraft(s)}
            className="text-2xs text-text-secondary px-2 py-1 rounded-full border border-subtle bg-bg-2 hover:bg-bg-3 hover:border-default hover:text-text-primary transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div className="p-3 border-t border-subtle">
        <div
          className={cn(
            'rounded-lg border bg-bg-1 transition-all duration-150',
            draft ? 'border-strong glow-ring' : 'border-default',
          )}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Describe what to build or change…"
            className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-text-primary placeholder:text-text-tertiary outline-none"
          />
          <div className="flex items-center justify-between px-2.5 pb-2">
            <span className="text-2xs text-text-tertiary">
              {cliConnected ? 'Routes to CLAD via your CLI · ⌘↵' : 'Open in the desktop app to run'}
            </span>
            {running ? (
              <button
                onClick={cancel}
                title="Stop the agent"
                className="flex items-center justify-center w-7 h-7 rounded-md bg-danger text-white hover:brightness-110 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150 ease-spring',
                  draft.trim()
                    ? 'accent-bg text-text-inverse hover:brightness-110'
                    : 'bg-bg-3 text-text-tertiary',
                )}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
