// orchestrator.ts — the two-channel core, now job-based.
//
// Holds the direct LS MCP connection and the agent runner. Multiple agent
// jobs run CONCURRENTLY (the user generates a mesh, an SFX and a UI at the
// same time and watches all three). The only thing serialized is work that
// mutates the live scene: scene-mutating jobs and direct MCP writes take a
// single scene-write lease so two writers never race the same scene. Direct
// reads (preview capture, listings) run anytime.
//
// Every job's streamed events are tagged with its jobId so the renderer can
// demux them into separate threads.

import { EventEmitter } from 'node:events';
import { LsConnection, type ConnState } from './ls-connection.js';
import type { AgentAdapter, AgentEvent } from './agent-runner.js';
import { createAgentAdapter } from './agent-factory.js';
import { Lease, nextJobId, type JobKind, type JobMode, type JobRecord, type JobStatus } from './jobs.js';

export interface JobRequest {
  prompt: string;
  cwd: string;
  kind: JobKind;
  mode: JobMode;
  title: string;
  artifactPath?: string | null;
  artifactId?: string | null;
  resumeSessionId?: string;
}

export type TaggedAgentEvent = AgentEvent & { jobId: string };

export interface OrchestratorEvents {
  'connection': (s: ConnState) => void;
  'agent-event': (e: TaggedAgentEvent) => void;
}

/** Only scene-mutating jobs need the scene-write lease. Asset/file generation
 *  (mesh/music/sfx) and plain code edits never touch the live scene graph. */
function mutatesScene(kind: JobKind): boolean {
  return kind === 'ui';
}

export class Orchestrator extends EventEmitter {
  readonly connection = new LsConnection();
  private readonly agent: AgentAdapter = createAgentAdapter();
  /** Serializes only scene-mutating work (UI jobs + direct writes). */
  private readonly sceneLease = new Lease();
  private readonly jobs = new Map<string, { record: JobRecord; cancel: () => void }>();

  constructor() {
    super();
    this.connection.on('status', (s) => this.emit('connection', s));
  }

  start(): void {
    this.connection.start();
  }

  stop(): void {
    for (const { cancel } of this.jobs.values()) cancel();
    this.connection.stop();
  }

  getConnection(): ConnState {
    return this.connection.getState();
  }

  /** Which generative CLI is active ('claude' | 'codex'). */
  getAgentCli(): string {
    return this.agent.cliName;
  }

  reconnect(): void {
    this.connection.reconnect();
  }

  listJobs(): JobRecord[] {
    return [...this.jobs.values()].map((j) => j.record);
  }

  /** Start an agent job. Returns immediately with its id + a done promise;
   *  events stream as tagged 'agent-event's. Concurrent with other jobs. */
  startJob(req: JobRequest): { jobId: string; done: Promise<{ sessionId: string | null; ok: boolean }> } {
    const jobId = nextJobId();
    const record: JobRecord = {
      id: jobId,
      kind: req.kind,
      mode: req.mode,
      title: req.title,
      artifactPath: req.artifactPath ?? null,
      artifactId: req.artifactId ?? null,
      sessionId: req.resumeSessionId ?? null,
      status: 'running',
      startedMs: Date.now(),
    };

    const emit = (e: AgentEvent): void => {
      if (e.kind === 'session' || e.kind === 'result') {
        const sid = e.kind === 'session' ? e.sessionId : e.sessionId;
        if (sid) record.sessionId = sid;
      }
      this.emit('agent-event', { ...e, jobId });
    };

    // The work itself: spawn the CLI run and await it.
    const runOnce = (): Promise<{ sessionId: string | null; ok: boolean }> => {
      const handle = this.agent.run({
        prompt: req.prompt,
        cwd: req.cwd,
        onEvent: emit,
        ...(req.resumeSessionId ? { resumeSessionId: req.resumeSessionId } : {}),
      });
      this.jobs.set(jobId, {
        record,
        cancel: () => {
          handle.cancel();
          if (record.status === 'running') record.status = 'cancelled';
        },
      });
      return handle.done;
    };

    // Scene-mutating jobs go through the lease; asset jobs run free.
    const work = mutatesScene(req.kind) ? this.sceneLease.acquire(runOnce) : runOnce();

    const done = work
      .then((res): { sessionId: string | null; ok: boolean } => {
        if (record.status === 'running') record.status = res.ok ? 'done' : 'error';
        if (res.sessionId) record.sessionId = res.sessionId;
        return res;
      })
      .catch((): { sessionId: string | null; ok: boolean } => {
        if (record.status === 'running') record.status = 'error';
        return { sessionId: record.sessionId, ok: false };
      });

    return { jobId, done };
  }

  setJobStatus(jobId: string, status: JobStatus): void {
    const j = this.jobs.get(jobId);
    if (j) j.record.status = status;
  }

  setJobArtifact(jobId: string, artifactPath: string | null, artifactId: string | null): void {
    const j = this.jobs.get(jobId);
    if (j) {
      j.record.artifactPath = artifactPath;
      j.record.artifactId = artifactId;
    }
  }

  cancelJob(jobId: string): void {
    this.jobs.get(jobId)?.cancel();
  }

  /** Run a single silent, tool-less planning turn and return its final text.
   *  Not tracked as a job (no UI thread, no scene access) — used to turn a
   *  build prompt into a manifest before the real per-step jobs fire. */
  planText(prompt: string, cwd: string): Promise<string> {
    return new Promise((resolve) => {
      let text = '';
      const handle = this.agent.run({
        prompt,
        cwd,
        allowedTools: [], // no tools — force a text-only manifest, mutate nothing
        maxTurns: 1,
        onEvent: (e) => {
          if (e.kind === 'result' && e.text) text = e.text;
          else if (e.kind === 'assistant' && e.text) text = e.text;
        },
      });
      handle.done.then(
        () => resolve(text),
        () => resolve(text),
      );
    });
  }

  /** Run a deterministic MCP op. Reads run immediately; writes take the
   *  scene-write lease so they never overlap a scene-mutating agent job. */
  runDirect<T>(fn: (client: import('./mcp-client.js').McpClient) => Promise<T>, opts?: { write?: boolean }): Promise<T> {
    const exec = (): Promise<T> => {
      const client = this.connection.getClient();
      if (!client) throw new Error('not connected to Lens Studio');
      return fn(client);
    };
    return opts?.write ? this.sceneLease.acquire(exec) : exec();
  }
}
