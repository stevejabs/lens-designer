// sandbox-config.test.ts — verify the pinned-source coordinates +
// URL builders. v1.0 pulls from `main` via the archive endpoint
// (no SHA pin).

import { describe, test, expect } from 'vitest';
import {
  SANDBOX_PINNED_REF,
  SANDBOX_PINNED_SHA256,
  SANDBOX_REF_KIND,
  SANDBOX_REPO_NAME,
  SANDBOX_REPO_OWNER,
  sandboxArchiveUrl,
  sandboxArchiveWrapperPrefix,
  sandboxRepoPageUrl,
} from '../src/sandbox-config.js';

describe('sandbox-config · constants', () => {
  test('repo owner + name are kebab-case and non-empty', () => {
    expect(SANDBOX_REPO_OWNER).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(SANDBOX_REPO_NAME).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  test('owner is stevejabs (locked 2026-05-27)', () => {
    expect(SANDBOX_REPO_OWNER).toBe('stevejabs');
    expect(SANDBOX_REPO_NAME).toBe('spectacles-sandbox');
  });

  test('SANDBOX_REF_KIND is either "branch" or "tag"', () => {
    expect(['branch', 'tag']).toContain(SANDBOX_REF_KIND);
  });

  test('SANDBOX_PINNED_REF is a non-empty string', () => {
    expect(typeof SANDBOX_PINNED_REF).toBe('string');
    expect(SANDBOX_PINNED_REF.length).toBeGreaterThan(0);
  });

  test('SANDBOX_PINNED_SHA256 is null (branch mode) or a 64-char hex string (tag mode)', () => {
    if (SANDBOX_PINNED_SHA256 === null) {
      // branch mode — fine
      expect(SANDBOX_REF_KIND).toBe('branch');
    } else {
      expect(SANDBOX_PINNED_SHA256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe('sandbox-config · URL builders', () => {
  test('sandboxArchiveUrl points at the branch archive endpoint in branch mode', () => {
    if (SANDBOX_REF_KIND !== 'branch') return;
    const url = sandboxArchiveUrl();
    expect(url).toBe(
      `https://github.com/${SANDBOX_REPO_OWNER}/${SANDBOX_REPO_NAME}/archive/refs/heads/${SANDBOX_PINNED_REF}.zip`,
    );
  });

  test('sandboxArchiveUrl points at the tag archive endpoint in tag mode', () => {
    if (SANDBOX_REF_KIND !== 'tag') return;
    const url = sandboxArchiveUrl();
    expect(url).toBe(
      `https://github.com/${SANDBOX_REPO_OWNER}/${SANDBOX_REPO_NAME}/archive/refs/tags/${SANDBOX_PINNED_REF}.zip`,
    );
  });

  test('sandboxRepoPageUrl is a github.com URL', () => {
    expect(sandboxRepoPageUrl()).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('sandbox-config · wrapper-prefix', () => {
  test('wrapper prefix is <repo>-<ref>/ — matches GitHub archive convention', () => {
    expect(sandboxArchiveWrapperPrefix()).toBe(
      `${SANDBOX_REPO_NAME}-${SANDBOX_PINNED_REF}/`,
    );
  });
});
