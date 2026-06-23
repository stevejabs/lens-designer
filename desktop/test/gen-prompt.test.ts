import { describe, it, expect } from 'vitest';
import { buildCreatePrompt, buildRefinePrompt, SKILL_FOR_KIND } from '../src/services/gen-prompt.js';

describe('SKILL_FOR_KIND', () => {
  it('maps each generative kind to its CLAD skill', () => {
    expect(SKILL_FOR_KIND.mesh).toBe('/build-mesh');
    expect(SKILL_FOR_KIND.music).toBe('/build-music');
    expect(SKILL_FOR_KIND.sfx).toBe('/build-sfx');
    expect(SKILL_FOR_KIND.ui).toBe('/specs-build-ui');
    expect(SKILL_FOR_KIND.code).toBeNull();
  });
});

describe('buildCreatePrompt', () => {
  it('names the skill so the agent invokes it on turn 1', () => {
    const p = buildCreatePrompt({ kind: 'mesh', userText: 'a low-poly ghost' });
    expect(p).toContain('/build-mesh');
    expect(p).toContain('a low-poly ghost');
  });
  it('falls back to the raw text when no skill owns the kind', () => {
    expect(buildCreatePrompt({ kind: 'code', userText: 'refactor X' })).toBe('refactor X');
  });
});

describe('buildRefinePrompt', () => {
  it('reuses the recorded skill, pins the exact path, and forbids duplicates', () => {
    const p = buildRefinePrompt({
      kind: 'mesh',
      artifactPath: '/proj/Assets/Ghost.glb',
      userText: 'make it smaller',
      priorPrompt: 'a low-poly ghost',
      skill: '/build-mesh',
    });
    expect(p).toContain('/build-mesh');
    expect(p).toContain('/proj/Assets/Ghost.glb');
    expect(p).toContain('a low-poly ghost'); // prior context handed back
    expect(p).toMatch(/overwrite the existing file in place/i);
    expect(p).toMatch(/do not create a new asset/i);
  });
  it('derives the skill from kind when none recorded', () => {
    const p = buildRefinePrompt({ kind: 'sfx', artifactPath: '/p/a.wav', userText: 'punchier' });
    expect(p).toContain('/build-sfx');
  });
});
