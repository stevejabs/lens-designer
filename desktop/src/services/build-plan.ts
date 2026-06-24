// build-plan.ts — turn a freeform "build this experience" prompt into a
// structured manifest of generation steps, so Lens Designer can orchestrate
// the build itself: fire each asset as its own tracked, visible job instead of
// handing one opaque prompt to a CLAD subagent. This is what makes the build
// progress legible (per-step status) and sets up multi-backend routing later.

export type BuildStepKind = 'mesh' | 'music' | 'sfx' | 'ui';

export interface BuildStep {
  kind: BuildStepKind;
  /** PascalCase asset/view name. */
  name: string;
  /** What to generate (the per-step prompt). */
  description: string;
}

export interface BuildManifest {
  summary: string;
  steps: BuildStep[];
}

const VALID_KINDS: ReadonlySet<string> = new Set(['mesh', 'music', 'sfx', 'ui']);
const MAX_STEPS = 12;

/** Prompt the planner agent for a JSON manifest (no tools, single turn). */
export function buildPlanPrompt(userPrompt: string): string {
  return (
    'You are planning a Snap Spectacles AR experience for Lens Studio. ' +
    'Given the request, output a concise BUILD MANIFEST as JSON and NOTHING else ' +
    '(no prose, no markdown fences). Schema:\n' +
    '{\n' +
    '  "summary": "<one short sentence describing the experience>",\n' +
    '  "steps": [\n' +
    '    { "kind": "mesh|music|sfx|ui", "name": "<PascalCaseName>", "description": "<what to generate>" }\n' +
    '  ]\n' +
    '}\n' +
    'Rules: kind is one of mesh (a 3D model), music (a background track), sfx (a sound effect), ' +
    'or ui (an interface panel/view). Include only the essential assets — 3 to 8 steps. ' +
    'Give each a clear, specific description. Output JSON only.\n\n' +
    'Request: ' +
    userPrompt.trim()
  );
}

/** Extract + validate a manifest from the planner's text output. Tolerates
 *  markdown fences and surrounding prose. Returns null if unparseable. */
export function parseManifest(text: string): BuildManifest | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const stepsRaw = Array.isArray(obj['steps']) ? (obj['steps'] as unknown[]) : [];
  const steps: BuildStep[] = [];
  for (const s of stepsRaw) {
    if (typeof s !== 'object' || s === null) continue;
    const so = s as Record<string, unknown>;
    const kind = String(so['kind'] ?? '').toLowerCase();
    const name = String(so['name'] ?? '').trim();
    const description = String(so['description'] ?? '').trim();
    if (!VALID_KINDS.has(kind) || !name || !description) continue;
    steps.push({ kind: kind as BuildStepKind, name: sanitizeName(name), description });
    if (steps.length >= MAX_STEPS) break;
  }
  if (steps.length === 0) return null;
  const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '';
  return { summary, steps };
}

function sanitizeName(name: string): string {
  // Keep it a safe asset/identifier-ish token.
  const cleaned = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  return cleaned || 'Asset';
}

/** Find the first balanced top-level JSON object in a blob of text. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
