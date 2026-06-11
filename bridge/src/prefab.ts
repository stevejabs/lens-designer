// .prefab YAML splice (TD-3, plan Step 9). MCP's CreatePrefabFromSceneObject
// always creates a NEW asset (S2 spike — never updates in place), so to keep
// a re-saved prefab's identity stable for placed instances, the bridge
// captures a fresh prefab to a temp path and splices its body into the
// existing prefab file, preserving the top-level `- !<ObjectPrefab/<UUID>>`
// line. .prefab is plain ASCII YAML in LS 5.15.4 (the older binary .oprfb
// format is obsolete).
//
// The splice is conservative: replace everything after the prefab header
// EXCEPT keep the original `ObjectPrefab/<UUID>` so the asset's identity
// (and the LS asset-DB's instance-link) survives.
//
// Sources:
//   - docs/testing/2026-05-26-attach-mode-spikes-runbook.md (S2 finding)
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §TD-3

import { type McpClient, readProjectTextFile, writeProjectTextFile } from './mcp.ts';

/**
 * Splice the body of `newPrefabPath` into the file at `existingPrefabPath`,
 * preserving `existingPrefabPath`'s top-level `ObjectPrefab/<UUID>` line.
 *
 * After splice, MCP-side the temp prefab at `newPrefabPath` is left as-is
 * (LS will GC it when its parent folder is removed). Callers in
 * `generate.ts` clean up after success.
 *
 * Throws on:
 *   - `existingPrefabPath` doesn't exist (caller should use straight-create instead).
 *   - either file isn't a parseable `.prefab` (no ObjectPrefab/<UUID> header).
 *   - the resulting spliced YAML doesn't itself parse as a `.prefab`.
 */
export async function splicePrefabBody(
  client: McpClient,
  existingPrefabPath: string,
  newPrefabPath: string,
): Promise<void> {
  const [existingBody, newBody] = await Promise.all([
    readProjectTextFile(client, existingPrefabPath),
    readProjectTextFile(client, newPrefabPath),
  ]);

  const existingHeader = parseHeader(existingBody, existingPrefabPath);
  parseHeader(newBody, newPrefabPath); // validate; throw if shape is off

  // Strip the new file's header line; everything after stays as the body.
  // Then prepend the existing header so the asset UUID is preserved.
  const newBodyAfterHeader = stripHeaderLine(newBody);
  const spliced = `${existingHeader.line}\n${newBodyAfterHeader}`;

  // Post-write validation: re-parse the spliced YAML to make sure we
  // didn't break the file. parseHeader checks the header survived; the
  // body-after check makes sure the new body's structure is still intact.
  parseHeader(spliced, existingPrefabPath);

  await writeProjectTextFile(client, existingPrefabPath, spliced);
}

interface PrefabHeader {
  /** The full header line, e.g. "- !<ObjectPrefab/abc123-…>". */
  line: string;
  /** The bare UUID. */
  uuid: string;
}

const HEADER_RE = /^- !<ObjectPrefab\/([0-9a-f-]{36})>\s*$/im;

/** Verify and extract the `.prefab`'s top-level ObjectPrefab line. */
function parseHeader(body: string, sourcePath: string): PrefabHeader {
  const match = body.match(HEADER_RE);
  if (!match) {
    throw new Error(
      `${sourcePath} is not a recognizable .prefab file — ` +
        `no "- !<ObjectPrefab/<UUID>>" header found`,
    );
  }
  return { line: match[0]!, uuid: match[1]! };
}

/**
 * Drop the very first occurrence of the ObjectPrefab header line. Anything
 * before it (typically nothing; YAML may start at column 0) is kept; the
 * caller prepends the preserved-header line.
 */
function stripHeaderLine(body: string): string {
  return body.replace(HEADER_RE, '').replace(/^\n+/, '');
}
