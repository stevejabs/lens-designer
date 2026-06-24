'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Wrench, Check, Loader2, Terminal, Plus, Square, X } from 'lucide-react';
import { cn } from '@/lib/v2/cn';
import { useAgentStore, type Thread, type ThreadStatus } from '@/lib/v2/agent-store';
import { getLd } from '@/lib/v2/native';
import type { AgentMessage } from '@/lib/v2/types';
import { Pill } from './ui/Primitives';
import { AutoTextarea } from './ui/AutoTextarea';
import { Markdown } from './ui/Markdown';

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
      <Markdown className="min-w-0 flex-1 pt-0.5">{msg.text}</Markdown>
    </div>
  );
}

const SUGGESTIONS = [
  'Generate a low-poly treasure chest',
  'Build a settings panel with a volume slider',
  'Make a warm ambient loop',
];

const STATUS_DOT: Record<ThreadStatus, string> = {
  idle: 'bg-text-tertiary',
  running: 'bg-accent-400',
  done: 'bg-success',
  error: 'bg-danger',
};

function ThreadTab({
  thread,
  active,
  onSelect,
  onClose,
  closable,
}: {
  thread: Thread;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  closable: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md text-xs whitespace-nowrap transition-colors shrink-0 max-w-[140px]',
        active ? 'bg-bg-3 text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-2',
      )}
      title={thread.title}
    >
      {thread.status === 'running' ? (
        <Loader2 className="w-3 h-3 animate-spin text-accent-400 shrink-0" />
      ) : (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[thread.status])} />
      )}
      <span className="truncate">{thread.title}</span>
      {closable && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover:opacity-100 hover:bg-bg-1 transition-opacity"
        >
          <X className="w-3 h-3" />
        </span>
      )}
    </button>
  );
}

export function AgentPanel() {
  const threads = useAgentStore((s) => s.threads);
  const activeId = useAgentStore((s) => s.activeId);
  const setActive = useAgentStore((s) => s.setActive);
  const newChat = useAgentStore((s) => s.newChat);
  const closeThread = useAgentStore((s) => s.closeThread);
  const setDraft = useAgentStore((s) => s.setDraft);
  const send = useAgentStore((s) => s.send);
  const cancel = useAgentStore((s) => s.cancel);

  const active = threads.find((t) => t.id === activeId) ?? threads[0];
  const cliConnected = getLd() !== null;
  const runningCount = threads.filter((t) => t.status === 'running').length;

  // Which CLI the generative channel uses (Claude Code / Codex).
  const [cliName, setCliName] = useState('Claude Code');
  useEffect(() => {
    void getLd()
      ?.agent.cli()
      .then((n) => setCliName(n === 'codex' ? 'Codex' : 'Claude Code'));
  }, []);

  const submit = (): void => {
    if (active) send(active.id);
  };

  // Sticky auto-scroll: follow new messages unless the user scrolled up.
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
  }, [active?.messages, active?.status]);
  // Snap to bottom when switching tabs.
  useEffect(() => {
    stickRef.current = true;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId]);

  if (!active) return null;
  const running = active.status === 'running';

  return (
    <aside className="flex flex-col w-[340px] shrink-0 border-l border-subtle bg-bg-0">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-subtle">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-400" />
          <span className="text-sm font-semibold text-text-primary">Agents</span>
          {runningCount > 0 && (
            <span className="font-num text-2xs text-accent-300 px-1.5 py-0.5 rounded-full bg-[rgba(34,211,238,0.1)]">
              {runningCount} running
            </span>
          )}
        </div>
        <Pill tone={cliConnected ? 'success' : 'neutral'}>
          <Terminal className="w-3 h-3" />
          {cliName}
        </Pill>
      </div>

      {/* Thread tabs — one per concurrent job */}
      <div className="flex items-center gap-1 px-2 h-9 border-b border-subtle overflow-x-auto scrollbar-thin">
        {threads.map((t) => (
          <ThreadTab
            key={t.id}
            thread={t}
            active={t.id === active.id}
            onSelect={() => setActive(t.id)}
            onClose={() => closeThread(t.id)}
            closable={threads.length > 1}
          />
        ))}
        <button
          onClick={() => newChat()}
          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
          title="New thread"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Thread */}
      <div ref={threadRef} onScroll={onThreadScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
            {active.title}
          </span>
          {active.artifactPath && <span className="text-2xs text-text-tertiary">· context saved</span>}
          {active.note && <span className="text-2xs text-success">· {active.note}</span>}
        </div>
        {active.messages.length === 0 && (
          <p className="text-xs text-text-tertiary pt-2">
            {active.mode === 'create'
              ? `Describe the ${active.kind} to generate, then send.`
              : 'Describe what to build or change.'}
          </p>
        )}
        {active.messages.map((m) => (
          <MessageRow key={m.id} msg={m} />
        ))}
        {running && (
          <div className="flex items-center gap-2 pl-1 text-xs text-text-tertiary">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-400" />
            Working…
            <button
              onClick={() => cancel(active.id)}
              className="ml-1 flex items-center gap-1 px-1.5 h-5 rounded text-2xs text-danger border border-[rgba(248,113,113,0.3)] hover:bg-[rgba(248,113,113,0.1)] transition-colors"
            >
              <Square className="w-2.5 h-2.5 fill-current" /> Stop
            </button>
          </div>
        )}
      </div>

      {/* Suggestions (only on an empty fresh thread) */}
      {active.messages.length === 0 && active.mode === 'chat' && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setDraft(active.id, s)}
              className="text-2xs text-text-secondary px-2 py-1 rounded-full border border-subtle bg-bg-2 hover:bg-bg-3 hover:border-default hover:text-text-primary transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t border-subtle">
        <div
          className={cn(
            'rounded-lg border bg-bg-1 transition-all duration-150',
            active.draft ? 'border-strong glow-ring' : 'border-default',
          )}
        >
          <AutoTextarea
            value={active.draft}
            onChange={(v) => setDraft(active.id, v)}
            onSubmit={submit}
            placeholder={active.mode === 'create' ? `Describe the ${active.kind}…` : 'Describe what to build or change…'}
            className="w-full bg-transparent px-3 pt-2.5 pb-1 text-sm text-text-primary placeholder:text-text-tertiary"
          />
          <div className="flex items-center justify-between px-2.5 pb-2">
            <span className="text-2xs text-text-tertiary">
              {cliConnected ? 'Routes to CLAD via your CLI · ↵ to send' : 'Open in the desktop app to run'}
            </span>
            {running ? (
              <button
                onClick={() => cancel(active.id)}
                title="Stop the agent"
                className="flex items-center justify-center w-7 h-7 rounded-md bg-danger text-white hover:brightness-110 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!active.draft.trim()}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150 ease-spring',
                  active.draft.trim()
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
