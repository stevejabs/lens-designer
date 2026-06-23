// codex-runner.ts — Codex CLI adapter for the generative channel. Mirrors the
// Claude AgentRunner interface (AgentAdapter) so the orchestrator is CLI-
// agnostic. Spawns `codex exec` with JSON output and normalizes its events.
//
// Codex is CLI-first (no SDK). Output schema differs from Claude's stream-json,
// so we map its event types defensively. Verified to typecheck; runtime-verified
// when the `codex` binary is present.

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Readable } from 'node:stream';
import type { AgentAdapter, AgentEvent, AgentRunHandle, RunOptions } from './agent-runner.js';

function resolvedEnv(): NodeJS.ProcessEnv {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')];
  const path = process.env['PATH'] ?? '';
  return { ...process.env, PATH: [path, ...extra].filter(Boolean).join(delimiter) };
}

export class CodexRunner extends EventEmitter implements AgentAdapter {
  readonly cliName = 'codex';
  private readonly bin: string;

  constructor(bin?: string) {
    super();
    this.bin = bin ?? process.env['CODEX_BIN'] ?? 'codex';
  }

  run(opts: RunOptions): AgentRunHandle {
    // `codex exec` runs to completion non-interactively; --json emits events.
    // Resume targets a prior session id.
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (opts.resumeSessionId) args.push('--session', opts.resumeSessionId);
    args.push(opts.prompt);

    const emit = (e: AgentEvent): void => {
      opts.onEvent?.(e);
      this.emit('event', e);
    };

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(this.bin, args, {
        cwd: opts.cwd,
        env: resolvedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      emit({ kind: 'error', message: `failed to launch ${this.bin}: ${(err as Error).message}` });
      return { done: Promise.resolve({ sessionId: null, ok: false }), cancel: () => {} };
    }

    let sessionId: string | null = opts.resumeSessionId ?? null;
    let ok = false;
    let buffer = '';

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      const found = this.normalize(msg);
      if (found?.sessionId) sessionId = found.sessionId;
      for (const e of found?.events ?? []) {
        if (e.kind === 'result') ok = e.ok;
        emit(e);
      }
    };

    const done = new Promise<{ sessionId: string | null; ok: boolean }>((res) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const l of lines) handleLine(l);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (text) emit({ kind: 'error', message: text.slice(0, 400) });
      });
      child.on('error', (err) => {
        emit({ kind: 'error', message: `${this.bin}: ${err.message}` });
        res({ sessionId, ok: false });
      });
      child.on('close', () => {
        if (buffer.trim()) handleLine(buffer);
        res({ sessionId, ok });
      });
    });

    return { done, cancel: () => child.kill('SIGTERM') };
  }

  /** Map a Codex JSON event to the normalized AgentEvent shape. */
  private normalize(msg: Record<string, unknown>): { events: AgentEvent[]; sessionId?: string | undefined } | null {
    const type = (msg['type'] ?? msg['msg_type'] ?? '') as string;
    const sid = (msg['session_id'] ?? msg['conversation_id'] ?? msg['id']) as string | undefined;

    // Session / config announcement.
    if (/session|configured|thread\.started/.test(type)) {
      return { events: sid ? [{ kind: 'session', sessionId: sid }] : [], sessionId: sid };
    }
    // Assistant text.
    if (/assistant|agent_message|message/.test(type)) {
      const text = (msg['message'] ?? msg['text'] ?? msg['content']) as string | undefined;
      return { events: text ? [{ kind: 'assistant', text: String(text) }] : [], sessionId: sid };
    }
    // Tool / command execution.
    if (/tool|command|exec|function_call/.test(type)) {
      const name = (msg['name'] ?? msg['tool'] ?? msg['command']) as string | undefined;
      return { events: [{ kind: 'tool', tool: name ? String(name) : 'tool', status: 'running' }], sessionId: sid };
    }
    // Completion.
    if (/result|completed|turn\.completed|task_complete/.test(type)) {
      const text = (msg['message'] ?? msg['result'] ?? '') as string;
      return {
        events: [{ kind: 'result', ok: msg['error'] == null, text: String(text), costUsd: null, sessionId: sid ?? null }],
        sessionId: sid,
      };
    }
    if (/error/.test(type)) {
      return { events: [{ kind: 'error', message: String(msg['message'] ?? 'codex error') }], sessionId: sid };
    }
    return null;
  }
}
