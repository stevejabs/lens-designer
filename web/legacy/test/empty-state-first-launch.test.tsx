// empty-state-first-launch.test.tsx
//
// Contract stubs for the first-launch empty state (design surface 1).
// Filled in during Phase 3 Step 14 when the web-side Create-sandbox
// flow lands.
//
// Locked by docs/testing/2026-05-27-lens-designer-standalone-app-test-plan.md.
// Design source: docs/design/2026-05-27-lens-designer-standalone-app-design.md §1.

import { describe, test } from 'vitest';

describe('FirstLaunchEmptyState (DS-1)', () => {
  test.todo('renders when settings.sandboxPath is null and attachTarget is null');
  test.todo('does NOT render when settings.sandboxPath is set');
  test.todo('does NOT render when attachTarget is set');
  test.todo('shows the "Attach to a project" heading exactly as in the design spec');
  test.todo('"Attach to a project" primary CTA is focused on mount');
  test.todo('clicking "Attach to a project" routes to the attach-mode flow');
  test.todo('clicking "Create sandbox" sends ipc "sandbox:create"');
  test.todo('clicking "I already have one" opens the OS .esproj picker via ipc "sandbox:locate"');
  test.todo('"I already have one" rejects an invalid pick with inline copy: "That doesn\'t look like a Lens Designer sandbox."');
  test.todo('tab order: Attach to a project → Create sandbox → I already have one');
  test.todo('Enter on a focused button activates it');
  test.todo('heading is rendered as <h1> for screen readers');
  test.todo('inline divider label "or, start with a sandbox" is present between primary and secondary CTAs');
});

describe('NonMacHostEmptyState (DS-8)', () => {
  test.todo('renders when getPlatformCapabilities() returns kind: "platform-unsupported"');
  test.todo('shows the "This platform isn\'t supported yet" heading exactly');
  test.todo('shows the body copy: "Windows support is in progress. Lens Designer is open source — anyone can help."');
  test.todo('does NOT show the "Create sandbox" / "Attach to a project" buttons');
  test.todo('does NOT mention Linux anywhere');
  test.todo('"View the repo" button calls shell.openExternal with PUBLIC_REPO_URL when set');
  test.todo('"View the repo" button is disabled with aria-disabled when PUBLIC_REPO_URL is null (v1.0 pre-public)');
  test.todo('credit line shows the app version, license, org');
});
