'use client';

// Recent-projects store — remembers projects you've attached to (name + Assets
// path) so re-attaching after a restart is a click, not a re-Browse. Persisted
// in localStorage (a local-machine fact, like the absolute path it holds). The
// project manifest carries the canonical name; this is the designer-side
// convenience index keyed by assetsDir.

const KEY = 'lens-designer.recent-projects.v1';
const CAP = 8;

export interface RecentProject {
  /** Display name (the attach label / project header name). */
  name: string;
  /** Absolute path to the project's Assets/ dir (the stable per-machine key). */
  assetsDir: string;
  /** Last port we attached on (a hint; LS reassigns per launch). */
  lastPort: number;
  /** Epoch ms of the last attach — drives most-recent-first ordering. */
  attachedAt: number;
}

function read(): RecentProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentProject =>
        r && typeof r.name === 'string' && typeof r.assetsDir === 'string',
    );
  } catch {
    return [];
  }
}

function write(list: RecentProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    // storage full / disabled — non-fatal, recents are a convenience.
  }
}

/** Most-recent-first list of projects attached to from this machine. */
export function getRecentProjects(): RecentProject[] {
  return read().sort((a, b) => b.attachedAt - a.attachedAt);
}

/** Record (or refresh) a successful attach. Dedups by assetsDir. */
export function recordRecentProject(
  entry: { name: string; assetsDir: string; lastPort: number },
  now: number = Date.now(),
): void {
  const existing = read().filter((r) => r.assetsDir !== entry.assetsDir);
  write([{ ...entry, attachedAt: now }, ...existing]);
}

/** Forget a project (e.g. the user removes it from the recents list). */
export function forgetRecentProject(assetsDir: string): void {
  write(read().filter((r) => r.assetsDir !== assetsDir));
}
