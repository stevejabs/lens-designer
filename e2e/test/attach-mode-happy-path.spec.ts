// E2E — attach-mode happy path. Drives the web app via Playwright against
// a live bridge + LS sandbox. Mirrors the design spec's user flow.
//
// Sources:
//   - docs/design/2026-05-26-lens-designer-attach-mode-design.md (§4 picker,
//     §5 save, §6 switch, §7 per-state inventory, §9 content strings)
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md
//
// Prereqs identical to the existing e2e suite: sandbox LS open, bridge
// running, web app on :3001. See playwright.config.ts header.

import { test } from '@playwright/test';

test.describe('attach-mode happy path — connect, author, save, switch', () => {
  test.skip('cold load shows "Not connected" TargetChip + empty Views panel CTA', async () => {});
  test.skip('clicking the TargetChip opens the picker with at least one LS instance listed', async () => {});
  test.skip('the sandbox row carries the [SANDBOX] badge', async () => {});
  test.skip('selecting the sandbox attaches without opening the Attach dialog (path not needed)', async () => {});
  test.skip('after attach, TargetChip shows the project name + success dot', async () => {});
  test.skip('Views panel switches from disconnected-empty to connected-empty CTA', async () => {});
  test.skip('clicking "+" (or ⌘N) opens the Save dialog pre-filled with a fresh blank tree', async () => {});
  test.skip('valid name "PoiCard" submits → new view appears at top of the Views list, marked active', async () => {});
  test.skip('editing an Inspector field flips the active view to unsaved (● dot in panel + brand area)', async () => {});
  test.skip('⌘S triggers save → bottom-center toast "Saved · PoiCard · N slots · M actions"', async () => {});
  test.skip('after save, the unsaved dot clears', async () => {});
  test.skip('after save, views.json on disk contains the named view (verify via fs read)', async () => {});
  test.skip('after save, <Name>.prefab + <Name>.ts exist in the project Assets/LensDesigner/', async () => {});
});

test.describe('attach-mode — second view + switching', () => {
  test.skip('creating a second view ("PoiMarker") adds it to the Views list', async () => {});
  test.skip('clicking the other view while current is clean switches immediately (no confirm)', async () => {});
  test.skip('the edit surface tears down + materializes the loaded view; canvas + preview adopt it', async () => {});
  test.skip('switching while current is dirty shows the "Switch view?" confirm with three buttons', async () => {});
  test.skip('confirm "Save & switch" saves the dirty view, then loads the target', async () => {});
  test.skip('confirm "Discard" loses the dirty edits and loads the target (with no warning toast)', async () => {});
  test.skip('confirm "Cancel" closes the dialog; the active view does not change', async () => {});
});

test.describe('attach-mode — reload survives via the project (not localStorage)', () => {
  test.skip('reloading the web app shows the Views panel populated from views.json', async () => {});
  test.skip('after reload the previously-active view is loaded into the canvas + preview', async () => {});
  test.skip('localStorage now holds only a draft cache, not the source of truth', async () => {});
});

test.describe('attach-mode — design-spec error states', () => {
  test.skip('attach to a project with an invalid path shows "That path doesn\'t exist" in the dialog', async () => {});
  test.skip('save with a name that already exists shows "Update existing · Save as new" branch buttons', async () => {});
  test.skip('save while disconnected shows the toast "Connect to a project before saving"', async () => {});
  test.skip('delete confirm names the view + warns that prefab + controller files stay', async () => {});
  test.skip('TargetChip cycles through all seven states (idle → scanning → connected → reconnecting → down → installing-pack → connected) without UI shifts', async () => {});
});

test.describe('attach-mode — sandbox + export still work', () => {
  test.skip('sandbox mode end-to-end works identically (views.json + switcher present)', async () => {});
});
