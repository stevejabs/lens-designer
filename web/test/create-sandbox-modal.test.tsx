// create-sandbox-modal.test.tsx
//
// Contract stubs for the Create-sandbox modal (design surface 2,
// states A–D5). Filled in during Phase 3 Step 14.
//
// Locked by docs/testing/2026-05-27-lens-designer-standalone-app-test-plan.md.
// Design source: docs/design/2026-05-27-lens-designer-standalone-app-design.md §2.

import { describe, test } from 'vitest';

describe('CreateSandboxModal — State A (pick directory)', () => {
  test.todo('shows the default path "~/Documents/spectacles-sandbox" on mount');
  test.todo('"Choose…" opens the native directory picker via ipc "dialog:openDirectory"');
  test.todo('selecting a path updates the read-only input');
  test.todo('"Create here" is disabled until a path is selected (defaults are selected, so always enabled in practice)');
  test.todo('shows "Needs ~50 MB free" hint');
  test.todo('clicking Cancel closes the modal');
  test.todo('Esc closes the modal');
  test.todo('backdrop click closes the modal');
});

describe('CreateSandboxModal — State A with non-empty dir (DS-2-D3)', () => {
  test.todo('selecting a non-empty directory shows the warning callout');
  test.todo('primary button label switches to "Continue anyway"');
  test.todo('callout copy is exactly: "This folder isn\'t empty. Continuing will add sandbox/ next to the existing files there."');
});

describe('CreateSandboxModal — State B (downloading)', () => {
  test.todo('progress bar aria-valuenow tracks bytes/total*100');
  test.todo('phase label is "Downloading…" during the 0–80% phase');
  test.todo('phase label is "Verifying…" during the 80–95% phase (indeterminate stripe)');
  test.todo('phase label is "Extracting…" during the 95–100% phase');
  test.todo('Cancel triggers ipc "sandbox:cancel" and returns to State A');
  test.todo('Esc triggers the same cancel as the Cancel button');
  test.todo('backdrop click has NO effect during downloading (prevents accidental cancel)');
  test.todo('"4.2 MB of 12.1 MB" stats line uses the .num font-num class');
});

describe('CreateSandboxModal — Auto-open on success (no State C)', () => {
  test.todo('on result.ok = true, dispatches ipc "shell:openPath" with the esproj path automatically');
  test.todo('on result.ok = true, calls props.onCreated with sandboxPath + esprojPath');
  test.todo('on result.ok = true, calls props.onClose — modal goes away without a "Sandbox ready" stop');
  test.todo('the renderer transitions out of empty state when settings update lands');
  test.todo('if shell.openPath rejects, the modal still closes — failure to spawn LS does not strand the user');
});

describe('CreateSandboxModal — Error states', () => {
  test.todo('D1 network-failed: header "Couldn\'t reach GitHub", footer has "Open release page" + "Try again"');
  test.todo('D1 "Open release page" calls shell.openExternal with the GH Releases URL');
  test.todo('D1 "Try again" re-runs the download from state A');
  test.todo('D2 sha-mismatch: header "Download was corrupted", copy mentions checksum');
  test.todo('D4 write-failed: shows the verbatim OS errno message in a code block');
  test.todo('D4 has only "Choose a different folder" in the footer (returns to state A)');
  test.todo('every error variant uses role="alert" on its callout');
});

describe('CreateSandboxModal — A11y', () => {
  test.todo('modal has role="dialog" aria-modal="true"');
  test.todo('focus is trapped within the modal while open');
  test.todo('focus returns to the empty-state CTA after close');
  test.todo('progress bar has role="progressbar" and aria-valuetext');
});
