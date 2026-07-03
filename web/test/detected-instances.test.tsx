// detected-instances.test.tsx
//
// The inline landing list that surfaces every reachable LS MCP instance on
// load. Locks: configured (already-set-up) projects are elevated to the top,
// each row labels its action ("Attach" vs "Set up…"), selecting fires onSelect,
// and the scanning / empty states render the right copy.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import type { TargetSummary } from '@lens-designer/bridge/client';
import { DetectedInstances } from '@/components/empty-state/DetectedInstances';

afterEach(cleanup);

const configured: TargetSummary = {
  port: 50080,
  hasMarker: false,
  projectName: 'MyConfiguredLens',
  assetsDir: '/Users/me/MyConfiguredLens/Assets',
  configured: true,
};
const unconfigured: TargetSummary = {
  port: 50010,
  hasMarker: false,
  projectName: 'SomeOtherProject',
  assetsDir: '/Users/me/SomeOtherProject/Assets',
  configured: false,
};

describe('DetectedInstances — ordering + elevation', () => {
  test('configured projects sort above unconfigured regardless of port', () => {
    render(
      <DetectedInstances
        instances={[unconfigured, configured]}
        scanning={false}
        onSelect={() => {}}
        onRescan={() => {}}
      />,
    );
    const rows = screen.getAllByRole('button').filter((b) => b.textContent?.includes('Assets'));
    // First listed row is the configured one even though its port is higher.
    expect(rows[0].textContent).toContain('MyConfiguredLens');
    expect(rows[1].textContent).toContain('SomeOtherProject');
  });
});

describe('DetectedInstances — per-row action labels', () => {
  test('configured row offers "Attach"; unconfigured offers "Set up…"', () => {
    render(
      <DetectedInstances
        instances={[configured, unconfigured]}
        scanning={false}
        onSelect={() => {}}
        onRescan={() => {}}
      />,
    );
    const configuredRow = screen.getByText('MyConfiguredLens').closest('button')!;
    expect(within(configuredRow).getByText('Attach')).toBeTruthy();
    expect(within(configuredRow).getByText('Set up')).toBeTruthy(); // the badge

    const otherRow = screen.getByText('SomeOtherProject').closest('button')!;
    expect(within(otherRow).getByText('Set up…')).toBeTruthy();
  });
});

describe('DetectedInstances — interactions', () => {
  test('selecting a row fires onSelect with that instance', () => {
    const onSelect = vi.fn();
    render(
      <DetectedInstances
        instances={[configured]}
        scanning={false}
        onSelect={onSelect}
        onRescan={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('MyConfiguredLens').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith(configured);
  });

  test('Rescan button fires onRescan', () => {
    const onRescan = vi.fn();
    render(
      <DetectedInstances
        instances={[]}
        scanning={false}
        onSelect={() => {}}
        onRescan={onRescan}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /rescan/i }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });
});

describe('DetectedInstances — empty + scanning states', () => {
  test('empty + idle shows the 50000–51000 not-found guidance', () => {
    render(
      <DetectedInstances instances={[]} scanning={false} onSelect={() => {}} onRescan={() => {}} />,
    );
    expect(screen.getByText(/No Lens Studio instances detected on ports 50000–51000/)).toBeTruthy();
  });

  test('empty + scanning shows the scanning copy', () => {
    render(
      <DetectedInstances instances={[]} scanning={true} onSelect={() => {}} onRescan={() => {}} />,
    );
    expect(screen.getByText(/Scanning ports 50000–51000/)).toBeTruthy();
  });

  test('a port-only instance (no resolved name) labels by port', () => {
    const bare: TargetSummary = { port: 50042, hasMarker: false, projectName: null, assetsDir: null, configured: false };
    render(
      <DetectedInstances instances={[bare]} scanning={false} onSelect={() => {}} onRescan={() => {}} />,
    );
    expect(screen.getByText('port 50042')).toBeTruthy();
  });
});
