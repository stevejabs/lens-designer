import { describe, it, expect } from 'vitest';
import { parseManifest, buildPlanPrompt } from '../src/services/build-plan.js';

describe('buildPlanPrompt', () => {
  it('asks for JSON-only and includes the request', () => {
    const p = buildPlanPrompt('a cozy bookshelf');
    expect(p).toMatch(/JSON/);
    expect(p).toContain('a cozy bookshelf');
  });
});

describe('parseManifest', () => {
  it('parses a clean manifest', () => {
    const m = parseManifest(
      JSON.stringify({
        summary: 'A bookshelf',
        steps: [
          { kind: 'mesh', name: 'Book', description: 'a hardcover book' },
          { kind: 'sfx', name: 'PageTurn', description: 'a page turn sound' },
        ],
      }),
    );
    expect(m?.summary).toBe('A bookshelf');
    expect(m?.steps).toHaveLength(2);
    expect(m?.steps[0]).toMatchObject({ kind: 'mesh', name: 'Book' });
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const text =
      'Here is the plan:\n```json\n' +
      JSON.stringify({ summary: 's', steps: [{ kind: 'ui', name: 'Panel', description: 'a panel' }] }) +
      '\n```\nHope that helps!';
    const m = parseManifest(text);
    expect(m?.steps[0]).toMatchObject({ kind: 'ui', name: 'Panel' });
  });

  it('drops invalid kinds and incomplete steps', () => {
    const m = parseManifest(
      JSON.stringify({
        summary: 's',
        steps: [
          { kind: 'mesh', name: 'Good', description: 'ok' },
          { kind: 'banana', name: 'Bad', description: 'nope' },
          { kind: 'music', name: '', description: 'no name' },
        ],
      }),
    );
    expect(m?.steps).toHaveLength(1);
    expect(m?.steps[0]?.name).toBe('Good');
  });

  it('sanitizes names and returns null when nothing valid', () => {
    expect(parseManifest('no json here at all')).toBeNull();
    expect(parseManifest(JSON.stringify({ steps: [] }))).toBeNull();
    const m = parseManifest(
      JSON.stringify({ summary: 's', steps: [{ kind: 'mesh', name: 'A/B*C!', description: 'x' }] }),
    );
    expect(m?.steps[0]?.name).toBe('ABC');
  });
});
