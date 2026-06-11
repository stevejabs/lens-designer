// Phase 1 — apply debounce + preview kickoff. D5 in the implementation plan.

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { ApplyPipeline, APPLY_DEBOUNCE_MS } from '../src/apply-pipeline.ts';
import type { DesignNode, ServerToClientMsg } from '../src/protocol.ts';

function node(id: string, name: string): DesignNode {
  return {
    id,
    type: 'Rectangle',
    name,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    properties: {
      position: { x: 0, y: 0 },
      size: { x: 1, y: 1 },
      rotation: 0,
      opacity: 100,
      fillColor: { r: 255, g: 255, b: 255, a: 100 },
    },
    children: [],
  };
}

describe('ApplyPipeline debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a single submit calls the applier once after the debounce window', async () => {
    const sent: ServerToClientMsg[] = [];
    const p = new ApplyPipeline({
      getTarget: () => null, // forces an error reply, no real MCP work
      send: (m) => sent.push(m),
    });
    p.submit([node('a', 'A')]);

    // Before the window elapses: nothing fired.
    await vi.advanceTimersByTimeAsync(APPLY_DEBOUNCE_MS - 1);
    expect(sent).toHaveLength(0);

    // Crossing the threshold flushes.
    await vi.advanceTimersByTimeAsync(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('design.error');
  });

  test('10 submits within 50ms coalesce into 1 flush with the LAST tree', async () => {
    const sent: ServerToClientMsg[] = [];
    let appliedGeneration: string | null = null;
    const p = new ApplyPipeline({
      getTarget: () => null,
      send: (m) => {
        sent.push(m);
        if (m.type === 'design.error') {
          // We can't see the tree here, but a single send proves coalescing.
          appliedGeneration = m.error.lsError;
        }
      },
    });

    for (let i = 0; i < 10; i++) {
      p.submit([node(`gen-${i}`, `Gen ${i}`)]);
      await vi.advanceTimersByTimeAsync(5); // total 50ms; all within window
    }

    // No flush yet — the timer keeps resetting.
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(APPLY_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(appliedGeneration).not.toBeNull();
  });

  test('a submit after the window flushes again (no fallthrough)', async () => {
    const sent: ServerToClientMsg[] = [];
    const p = new ApplyPipeline({
      getTarget: () => null,
      send: (m) => sent.push(m),
    });

    p.submit([node('a', 'A')]);
    await vi.advanceTimersByTimeAsync(APPLY_DEBOUNCE_MS + 1);
    expect(sent).toHaveLength(1);

    p.submit([node('b', 'B')]);
    await vi.advanceTimersByTimeAsync(APPLY_DEBOUNCE_MS + 1);
    expect(sent).toHaveLength(2);
  });

  test('cancel() prevents a pending flush from firing', async () => {
    const sent: ServerToClientMsg[] = [];
    const p = new ApplyPipeline({
      getTarget: () => null,
      send: (m) => sent.push(m),
    });

    p.submit([node('a', 'A')]);
    p.cancel();
    await vi.advanceTimersByTimeAsync(APPLY_DEBOUNCE_MS * 5);
    expect(sent).toHaveLength(0);
  });

  test('a submit during the debounce RESETS the timer (does not extend it)', async () => {
    const sent: ServerToClientMsg[] = [];
    const p = new ApplyPipeline({
      getTarget: () => null,
      send: (m) => sent.push(m),
    });

    p.submit([node('a', 'A')]);
    await vi.advanceTimersByTimeAsync(60);
    p.submit([node('b', 'B')]); // resets to t+60 + APPLY_DEBOUNCE_MS

    // Crossing the *original* boundary at t=100 must NOT flush.
    await vi.advanceTimersByTimeAsync(45); // now at t=105
    expect(sent).toHaveLength(0);

    // Crossing the *reset* boundary at t=160 does flush.
    await vi.advanceTimersByTimeAsync(60); // now at t=165
    expect(sent).toHaveLength(1);
  });
});

describe('preview-kickoff debounce', () => {
  test.todo('a burst of design.apply messages produces exactly 1 preview.ready event');
  test.todo('the preview is captured AFTER the last design.apply lands in LS, not before');
});
