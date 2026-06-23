// jobs.ts — the Job model that makes concurrent, monitorable agent runs
// possible. A Job is one agent turn with a stable id, a target artifact, the
// CLAD skill it routes to, and a live status. The orchestrator runs many at
// once; the cockpit renders one tab per job.

import type { GenKind } from './gen-prompt.js';

export type JobKind = GenKind; // mesh | music | sfx | ui | code
export type JobMode = 'create' | 'refine' | 'chat';
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface JobRecord {
  id: string;
  kind: JobKind;
  mode: JobMode;
  title: string;
  /** Canonical artifact path this job targets (refine) or produced (create). */
  artifactPath: string | null;
  artifactId: string | null;
  sessionId: string | null;
  status: JobStatus;
  startedMs: number;
}

/** Lifecycle/post-processing update pushed to the renderer alongside the
 *  streamed agent events (which carry the same jobId). */
export interface JobMeta {
  jobId: string;
  status: JobStatus;
  artifactPath: string | null;
  artifactId: string | null;
  /** Human note about reconciliation/versioning ("overwritten in place"). */
  note: string | null;
}

let seq = 0;
export function nextJobId(): string {
  seq += 1;
  return `job-${Date.now().toString(36)}-${seq}`;
}

/** A FIFO async mutex. Scene-mutating work acquires it so two writers never
 *  race the live Lens Studio scene; asset/file generation never touches it. */
export class Lease {
  private chain: Promise<void> = Promise.resolve();

  /** Run `fn` once the lease is free; releases when it settles. */
  acquire<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
