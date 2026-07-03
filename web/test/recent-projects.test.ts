// recent-projects.test.ts
//
// Locks the "a project is NEVER pinned to an MCP port between sessions"
// invariant: recent-projects persists project identity (Assets dir + name)
// only — never a port. Old entries that still carry a `lastPort` must read
// back without it leaking into the persisted shape.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  getRecentProjects,
  recordRecentProject,
  forgetRecentProject,
} from '@/lib/recent-projects';

const KEY = 'lens-designer.recent-projects.v1';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('recordRecentProject — no port is ever persisted', () => {
  test('a recorded project stores name + assetsDir, never a port', () => {
    recordRecentProject({ name: 'MyLens', assetsDir: '/Users/me/MyLens/Assets' }, 1000);
    const raw = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toEqual({
      name: 'MyLens',
      assetsDir: '/Users/me/MyLens/Assets',
      attachedAt: 1000,
    });
    expect(raw[0]).not.toHaveProperty('lastPort');
  });

  test('the public RecentProject shape has no port field', () => {
    recordRecentProject({ name: 'A', assetsDir: '/p/A/Assets' }, 5);
    const [r] = getRecentProjects();
    expect(r).not.toHaveProperty('lastPort');
    expect(Object.keys(r).sort()).toEqual(['assetsDir', 'attachedAt', 'name']);
  });
});

describe('recordRecentProject — identity is the Assets dir', () => {
  test('dedups by assetsDir, refreshing name + recency in place', () => {
    recordRecentProject({ name: 'Old', assetsDir: '/p/X/Assets' }, 100);
    recordRecentProject({ name: 'New', assetsDir: '/p/X/Assets' }, 200);
    const list = getRecentProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('New');
    expect(list[0].attachedAt).toBe(200);
  });

  test('distinct Assets dirs are separate entries, most-recent-first', () => {
    recordRecentProject({ name: 'A', assetsDir: '/p/A/Assets' }, 100);
    recordRecentProject({ name: 'B', assetsDir: '/p/B/Assets' }, 300);
    recordRecentProject({ name: 'C', assetsDir: '/p/C/Assets' }, 200);
    expect(getRecentProjects().map((r) => r.name)).toEqual(['B', 'C', 'A']);
  });
});

describe('backward compatibility', () => {
  test('reads legacy entries that still carry lastPort, then drops it on rewrite', () => {
    // Simulate a pre-change persisted entry.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { name: 'Legacy', assetsDir: '/p/L/Assets', lastPort: 50049, attachedAt: 10 },
      ]),
    );
    // Reads back fine (port ignored).
    expect(getRecentProjects()).toHaveLength(1);
    // A subsequent record of the SAME project drops the stale port.
    recordRecentProject({ name: 'Legacy', assetsDir: '/p/L/Assets' }, 20);
    const raw = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(raw[0]).not.toHaveProperty('lastPort');
    expect(raw[0].attachedAt).toBe(20);
  });
});

describe('forgetRecentProject', () => {
  test('removes a single project by assetsDir', () => {
    recordRecentProject({ name: 'A', assetsDir: '/p/A/Assets' }, 1);
    recordRecentProject({ name: 'B', assetsDir: '/p/B/Assets' }, 2);
    forgetRecentProject('/p/A/Assets');
    expect(getRecentProjects().map((r) => r.name)).toEqual(['B']);
  });
});
