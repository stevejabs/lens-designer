// agent-runner.ts — orchestrates a headless Claude Code session for the
// generative channel. Spawns the user's `claude` CLI with stream-json output,
// normalizes its events for the UI, captures the session id, and supports
// resume. This is the CLI-agnostic seam: a Codex adapter implements the same
// AgentRunner interface later.

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Readable } from 'node:stream';

/** Normalized agent events streamed to the UI. */
export type AgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; tool: string; status: 'running' }
  | { kind: 'tool-result'; tool: string; ok: boolean }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number | null; sessionId: string | null }
  | { kind: 'error'; message: string };

export interface RunOptions {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  /** Permission posture for the unattended run. */
  permissionMode?: 'acceptEdits' | 'plan' | 'default';
  allowedTools?: string[];
  maxTurns?: number;
}

export interface AgentRunHandle {
  /** Resolves when the run completes (success or failure). */
  done: Promise<{ sessionId: string | null; ok: boolean }>;
  cancel(): void;
}

/** CLI-agnostic agent interface — Claude and Codex adapters both implement it. */
export interface AgentAdapter {
  run(opts: RunOptions): AgentRunHandle;
  on(event: 'event', listener: (e: AgentEvent) => void): this;
  off(event: 'event', listener: (e: AgentEvent) => void): this;
  readonly cliName: string;
}

export interface AgentRunnerEvents {
  event: (e: AgentEvent) => void;
}

const DEFAULT_ALLOWED = [
  'mcp__lens-studio__*',
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
];

/** Resolve the `claude` binary, augmenting PATH for the common install dirs
 *  that a GUI-launched process (limited PATH) would otherwise miss. */
function resolvedEnv(): NodeJS.ProcessEnv {
  const extra = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
  ];
  const path = process.env['PATH'] ?? '';
  const merged = [path, ...extra].filter(Boolean).join(delimiter);
  return { ...process.env, PATH: merged };
}

export class AgentRunner extends EventEmitter implements AgentAdapter {
  readonly cliName = 'claude';
  private readonly bin: string;

  constructor(bin?: string) {
    super();
    this.bin = bin ?? process.env['CLAUDE_BIN'] ?? 'claude';
  }

  run(opts: RunOptions): AgentRunHandle {
    const args = [
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      opts.permissionMode ?? 'acceptEdits',
      '--allowedTools',
      (opts.allowedTools ?? DEFAULT_ALLOWED).join(' '),
    ];
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(this.bin, args, {
        cwd: opts.cwd,
        env: resolvedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.emit('event', { kind: 'error', message: `failed to launch ${this.bin}: ${(err as Error).message}` });
      return { done: Promise.resolve({ sessionId: null, ok: false }), cancel: () => {} };
    }

    let sessionId: string | null = opts.resumeSessionId ?? null;
    let ok = false;
    let buffer = '';

    const done = new Promise<{ sessionId: string | null; ok: boolean }>((res) => {
      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return; // non-JSON noise
        }
        const found = this.normalize(msg);
        if (found?.sessionId) sessionId = found.sessionId;
        for (const e of found?.events ?? []) {
          if (e.kind === 'result') ok = e.ok;
          this.emit('event', e);
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const l of lines) handleLine(l);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (text) this.emit('event', { kind: 'error', message: text.slice(0, 400) });
      });
      child.on('error', (err) => {
        this.emit('event', { kind: 'error', message: `${this.bin}: ${err.message}` });
        res({ sessionId, ok: false });
      });
      child.on('close', () => {
        if (buffer.trim()) handleLine(buffer);
        res({ sessionId, ok });
      });
    });

    return { done, cancel: () => child.kill('SIGTERM') };
  }

  /** Map one stream-json message to normalized events + an optional session id. */
  private normalize(
    msg: Record<string, unknown>,
  ): { events: AgentEvent[]; sessionId?: string | undefined } | null {
    const type = msg['type'] as string | undefined;
    const sid = (msg['session_id'] as string | undefined) ?? undefined;

    if (type === 'system' && msg['subtype'] === 'init') {
      return { events: sid ? [{ kind: 'session', sessionId: sid }] : [], sessionId: sid };
    }

    if (type === 'assistant') {
      const message = msg['message'] as { content?: Array<Record<string, unknown>> } | undefined;
      const events: AgentEvent[] = [];
      for (const block of message?.content ?? []) {
        if (block['type'] === 'text' && typeof block['text'] === 'string') {
          events.push({ kind: 'assistant', text: block['text'] });
        } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
          events.push({ kind: 'tool', tool: block['name'], status: 'running' });
        }
      }
      return { events, sessionId: sid };
    }

    if (type === 'user') {
      // Tool results arrive as user-role messages with tool_result blocks.
      const message = msg['message'] as { content?: Array<Record<string, unknown>> } | undefined;
      const events: AgentEvent[] = [];
      for (const block of message?.content ?? []) {
        if (block['type'] === 'tool_result') {
          events.push({ kind: 'tool-result', tool: 'tool', ok: block['is_error'] !== true });
        }
      }
      return { events, sessionId: sid };
    }

    if (type === 'result') {
      const text = (msg['result'] as string | undefined) ?? '';
      const ok = msg['subtype'] === 'success' || msg['is_error'] === false;
      const cost = (msg['total_cost_usd'] as number | undefined) ?? null;
      return {
        events: [{ kind: 'result', ok, text, costUsd: cost, sessionId: sid ?? null }],
        sessionId: sid,
      };
    }

    return null;
  }
}
