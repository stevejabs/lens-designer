// gen-prompt.ts — routes a generation/refine request to the EXACT CLAD skill
// that owns it, so the agent invokes the right tool on turn 1 instead of
// rediscovering it over many turns.
//
// The whole point of tracking provenance per asset is this file: on a refine
// we already know which skill made the asset and the file it lives at, so we
// hand the agent an unambiguous instruction ("Use /build-mesh to regenerate
// the existing asset at <path>, applying <change>, overwrite in place").

export type GenKind = 'mesh' | 'music' | 'sfx' | 'ui' | 'code';

/** The CLAD slash-command skill that produces/edits each kind of artifact. */
export const SKILL_FOR_KIND: Record<GenKind, string | null> = {
  mesh: '/build-mesh',
  music: '/build-music',
  sfx: '/build-sfx',
  ui: '/specs-build-ui',
  code: null, // plain code edits — no dedicated generator skill
};

const NOUN: Record<GenKind, string> = {
  mesh: '3D mesh asset',
  music: 'music track',
  sfx: 'sound effect',
  ui: 'UI view',
  code: 'code',
};

export interface CreatePromptInput {
  kind: GenKind;
  /** What the user typed (their description of the thing to make). */
  userText: string;
}

export interface RefinePromptInput {
  kind: GenKind;
  /** Exact file path of the existing artifact to modify in place. */
  artifactPath: string;
  /** The change the user is asking for. */
  userText: string;
  /** The original description the asset was generated from, if known. */
  priorPrompt?: string | undefined;
  /** The skill recorded at creation, if known (overrides the kind default). */
  skill?: string | undefined;
}

/** Build the prompt for generating a brand-new artifact. */
export function buildCreatePrompt(input: CreatePromptInput): string {
  const skill = SKILL_FOR_KIND[input.kind];
  const noun = NOUN[input.kind];
  if (skill) {
    return (
      `Use the ${skill} skill to generate a new ${noun}.\n` +
      `Description: ${input.userText.trim()}\n` +
      `Invoke ${skill} directly — do not deliberate about which approach to use.`
    );
  }
  return input.userText.trim();
}

/** Refine prompt for a CODE-AUTHORED mesh (a TypeScript BaseScriptComponent
 *  that builds geometry). Unlike a GLB, the fix is a code edit in place — not a
 *  regeneration — so this routes to editing the .ts directly and keeps it a
 *  scripted mesh with its existing controls. */
export function buildScriptMeshRefinePrompt(input: {
  artifactPath: string;
  userText: string;
  priorPrompt?: string | undefined;
}): string {
  const lines: string[] = [];
  lines.push(
    `A code-authored 3D mesh (a TypeScript BaseScriptComponent that builds geometry with ` +
      `MeshBuilder / RenderMeshVisual) already exists at this exact path: ${input.artifactPath}`,
  );
  if (input.priorPrompt) lines.push(`It was originally described as: "${input.priorPrompt.trim()}"`);
  lines.push(`Edit that TypeScript file in place to apply this change: ${input.userText.trim()}`);
  lines.push(
    `Keep it a code-authored mesh — do NOT replace it with a GLB, a new file, or a new path. ` +
      `Preserve its existing @input controls and public runtime setters. Recompile the project ` +
      `TypeScript when done so Lens Studio picks up the change.`,
  );
  return lines.join('\n');
}

/** Build the prompt for refining an EXISTING artifact in place.
 *  Reuses the original skill and pins the exact output path. */
export function buildRefinePrompt(input: RefinePromptInput): string {
  const skill = input.skill ?? SKILL_FOR_KIND[input.kind];
  const noun = NOUN[input.kind];
  const lines: string[] = [];
  lines.push(`A ${noun} already exists at this exact path: ${input.artifactPath}`);
  if (input.priorPrompt) {
    lines.push(`It was originally generated from: "${input.priorPrompt.trim()}"`);
  }
  if (skill) {
    lines.push(
      `Use the ${skill} skill to regenerate it with this change: ${input.userText.trim()}`,
    );
    lines.push(
      `Write the result to EXACTLY ${input.artifactPath} — overwrite the existing file in place. ` +
        `Do NOT create a new asset, a new file name, or a new path. It is already imported into the ` +
        `project; replace it directly. If your generator emits a differently-named file, move it onto ` +
        `${input.artifactPath} and delete the stray file before you finish.`,
    );
    lines.push(`Invoke ${skill} immediately — you already know the tool and the target file.`);
  } else {
    lines.push(`Apply this change and overwrite the file in place: ${input.userText.trim()}`);
  }
  return lines.join('\n');
}
