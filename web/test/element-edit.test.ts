import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '@/lib/v2/agent-store';

let runArgs: unknown[];
function installLd() {
  runArgs = [];
  (window as unknown as { ld: unknown }).ld = {
    agent: {
      run: vi.fn(async (req: unknown) => {
        runArgs.push(req);
        return { jobId: 'job-1' };
      }),
      cancel: vi.fn(),
      cli: vi.fn(async () => 'claude'),
      onEvent: () => () => {},
      onJobMeta: () => () => {},
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  installLd();
  useAgentStore.setState({ threads: [], activeId: null, build: { phase: 'idle', prompt: '', summary: '', stepThreadIds: [] } });
});

describe('editElement (WYSIWYG write-back)', () => {
  it('routes an element edit to the agent against the view source', async () => {
    useAgentStore.getState().editElement({
      viewPath: '/proj/Assets/Scripts/SettingsViewUI.ts',
      elementName: 'Header',
      elementType: 'Text',
      changes: [
        { label: 'text', value: 'Welcome' },
        { label: 'font size', value: '40' },
      ],
    });
    await flush();

    // a view-scoped thread was opened with the user-facing change line
    const t = useAgentStore.getState().threads.find((x) => x.artifactPath === '/proj/Assets/Scripts/SettingsViewUI.ts');
    expect(t).toBeTruthy();
    expect(t!.kind).toBe('ui');
    expect(t!.messages.at(-1)?.text).toContain('Header');

    // the agent was invoked targeting the view file with a precise prompt
    expect(runArgs).toHaveLength(1);
    const req = runArgs[0] as { prompt: string; kind: string; mode: string; artifactPath: string };
    expect(req.artifactPath).toBe('/proj/Assets/Scripts/SettingsViewUI.ts');
    expect(req.kind).toBe('ui');
    expect(req.mode).toBe('chat');
    expect(req.prompt).toContain('Header');
    expect(req.prompt).toContain('set its text to Welcome');
    expect(req.prompt).toContain('set its font size to 40');
    expect(req.prompt).toContain('recompile');
  });

  it('reuses the same thread for repeated edits of one view', async () => {
    const store = useAgentStore.getState();
    store.editElement({ viewPath: '/v.ts', elementName: 'A', elementType: 'Text', changes: [{ label: 'text', value: 'x' }] });
    await flush();
    store.editElement({ viewPath: '/v.ts', elementName: 'B', elementType: 'Switch', changes: [{ label: 'on', value: 'true' }] });
    await flush();
    const threads = useAgentStore.getState().threads.filter((t) => t.artifactPath === '/v.ts');
    expect(threads).toHaveLength(1);
  });
});
