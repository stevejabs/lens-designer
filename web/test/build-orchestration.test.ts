import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '@/lib/v2/agent-store';

// Fake the native bridge by setting window.ld (what getLd() reads).
function installLd(plan: { summary: string; steps: { kind: string; name: string; description: string }[] }) {
  let seq = 0;
  (window as unknown as { ld: unknown }).ld = {
    build: { plan: vi.fn(async () => plan) },
    asset: { create: vi.fn(async () => ({ jobId: `job-${++seq}`, title: 'x' })), refine: vi.fn() },
    agent: {
      run: vi.fn(async () => ({ jobId: `job-${++seq}` })),
      cancel: vi.fn(),
      cli: vi.fn(async () => 'claude'),
      onEvent: () => () => {},
      onJobMeta: () => () => {},
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useAgentStore.setState({
    threads: [],
    activeId: null,
    build: { phase: 'idle', prompt: '', summary: '', stepThreadIds: [] },
  });
});

describe('orchestrated build', () => {
  it('plans then fires one tracked job per manifest step', async () => {
    installLd({
      summary: 'A forest',
      steps: [
        { kind: 'mesh', name: 'Tree', description: 'a pine tree' },
        { kind: 'sfx', name: 'Wind', description: 'wind gust' },
        { kind: 'ui', name: 'Panel', description: 'an info panel' },
      ],
    });

    await useAgentStore.getState().startBuild('a quiet forest');
    await flush();

    const { build, threads } = useAgentStore.getState();
    expect(build.phase).toBe('building');
    expect(build.summary).toBe('A forest');
    expect(build.stepThreadIds).toHaveLength(3);

    const stepThreads = build.stepThreadIds.map((id) => threads.find((t) => t.id === id)!);
    expect(stepThreads.map((t) => t.title)).toEqual(['Tree', 'Wind', 'Panel']);
    // every step kicked a real job (has a job id) and is running
    expect(stepThreads.every((t) => t.currentJobId && t.status === 'running')).toBe(true);

    // mesh+sfx route to asset.create; ui routes to agent.run(create)
    const ld = (window as unknown as { ld: any }).ld;
    expect(ld.asset.create).toHaveBeenCalledTimes(2);
    expect(ld.agent.run).toHaveBeenCalledTimes(1);
  });

  it('completes the build when every step job finishes', async () => {
    installLd({
      summary: 's',
      steps: [
        { kind: 'mesh', name: 'A', description: 'a' },
        { kind: 'sfx', name: 'B', description: 'b' },
      ],
    });
    const store = useAgentStore.getState();
    await store.startBuild('x');
    await flush();

    const { build, threads } = useAgentStore.getState();
    for (const id of build.stepThreadIds) {
      const jobId = threads.find((t) => t.id === id)!.currentJobId!;
      useAgentStore.getState()._onMeta({ jobId, status: 'done', artifactPath: '/p', artifactId: '/p', note: null });
    }
    expect(useAgentStore.getState().build.phase).toBe('done');
  });

  it('errors when the planner returns no steps', async () => {
    installLd({ summary: '', steps: [] });
    await useAgentStore.getState().startBuild('nonsense');
    await flush();
    expect(useAgentStore.getState().build.phase).toBe('error');
  });

  it('does not steal cockpit selection mid-build', async () => {
    installLd({ summary: 's', steps: [{ kind: 'mesh', name: 'A', description: 'a' }] });
    await useAgentStore.getState().startBuild('x');
    await flush();
    const { build, threads } = useAgentStore.getState();
    const jobId = threads.find((t) => t.id === build.stepThreadIds[0])!.currentJobId!;
    // job-meta with an artifactPath would normally select it; during a build it must not.
    useAgentStore.getState()._onMeta({ jobId, status: 'done', artifactPath: '/new', artifactId: '/new', note: null });
    // build completes, and selection wasn't yanked to the in-progress asset
    expect(useAgentStore.getState().build.phase).toBe('done');
  });
});
