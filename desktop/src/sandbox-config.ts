// sandbox-config.ts — pinned sandbox source coordinates.
//
// v1.0 (internal) pulls directly from `main` of the sandbox repo
// via GitHub's archive endpoint — no release ceremony, no SHA
// verification. Trades the integrity check for a much simpler
// publishing flow (Steve pushes to main; that's it).
//
// Switching to release-mode later: set SANDBOX_REF_KIND to 'tag',
// set SANDBOX_PINNED_REF to a v-prefixed tag, set
// SANDBOX_PINNED_SHA256 to the real hash. The download path
// re-enables SHA verification automatically when both are set.

export const SANDBOX_REPO_OWNER = 'stevejabs';
export const SANDBOX_REPO_NAME = 'spectacles-sandbox';

export type SandboxRefKind = 'branch' | 'tag';

/** Whether SANDBOX_PINNED_REF is a branch name (e.g. 'main') or a tag (e.g. 'v0.1.0'). */
export const SANDBOX_REF_KIND: SandboxRefKind = 'branch';

/** The ref name to pull from. With SANDBOX_REF_KIND === 'branch', this is a branch. */
export const SANDBOX_PINNED_REF = 'main';

/**
 * Expected SHA-256 of the downloaded zip. Set to null to skip
 * verification (used in branch-mode where the SHA changes on every
 * push). When non-null, mismatch aborts the download.
 */
export const SANDBOX_PINNED_SHA256: string | null = null;

/** Returns the full download URL for the pinned sandbox. */
export function sandboxArchiveUrl(): string {
  const kindPath = SANDBOX_REF_KIND === 'tag' ? 'tags' : 'heads';
  return `https://github.com/${SANDBOX_REPO_OWNER}/${SANDBOX_REPO_NAME}/archive/refs/${kindPath}/${SANDBOX_PINNED_REF}.zip`;
}

/** Returns the human-readable repo / release page URL (for fallback links). */
export function sandboxRepoPageUrl(): string {
  if (SANDBOX_REF_KIND === 'tag') {
    return `https://github.com/${SANDBOX_REPO_OWNER}/${SANDBOX_REPO_NAME}/releases/tag/${SANDBOX_PINNED_REF}`;
  }
  return `https://github.com/${SANDBOX_REPO_OWNER}/${SANDBOX_REPO_NAME}/tree/${SANDBOX_PINNED_REF}`;
}

/**
 * GitHub's archive endpoint wraps the repo contents in a top-level
 * directory named `<repo>-<ref>/`. The extractor strips this prefix
 * so the user's target directory ends up with the project at its
 * root, not nested.
 */
export function sandboxArchiveWrapperPrefix(): string {
  return `${SANDBOX_REPO_NAME}-${SANDBOX_PINNED_REF}/`;
}
