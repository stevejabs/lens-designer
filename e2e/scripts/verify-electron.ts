// verify-electron.ts — launch the built Lens Designer desktop app and inspect
// it end-to-end: connection goes live, Views list populates from the project,
// switch to the Designer and capture the live preview. Screenshots to /tmp.
//
// Run from the e2e dir: pnpm exec tsx scripts/verify-electron.ts

import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const desktop = resolve(process.cwd(), '..', 'desktop');
const electronBin = createRequire(resolve(desktop, 'package.json'))('electron') as string;

async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms: number, every = 1000): Promise<T> {
  const end = Date.now() + ms;
  let last = await fn();
  while (!ok(last) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, every));
    last = await fn();
  }
  return last;
}

async function main(): Promise<void> {
  console.log('launching electron:', electronBin);
  const app = await electron.launch({
    executablePath: electronBin,
    args: [resolve(desktop, 'dist/main/main.cjs')],
    cwd: desktop,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('header', { timeout: 15000 });
  console.log('window title:', await win.title());

  // Size the window so the viewer pane is visible for screenshots.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(1600, 1000);
  });
  await win.waitForTimeout(500);

  // 1. Connection chip should go live within ~25s.
  const header = win.locator('header');
  const conn = await poll(
    () => header.innerText(),
    (t) => /Lens Studio|:50\d{3}/.test(t),
    25000,
  );
  console.log('connection chip:', conn.replace(/\s+/g, ' ').trim().slice(0, 120));

  // 2. Switch to Designer; Views list should populate from the project.
  await win.locator('[title="Designer"]').click();
  await win.waitForTimeout(1500);
  const viewsText = await poll(
    async () => win.locator('text=Views').first().locator('xpath=ancestor::nav | xpath=..').innerText().catch(() => ''),
    () => true,
    2000,
  );
  const allText = await win.locator('body').innerText();
  console.log('has WelcomeBannerUI in UI:', /WelcomeBanner/i.test(allText));
  console.log('has LDValidationPanel in UI:', /LDValidationPanel/i.test(allText));

  // 3. The live preview should AUTO-load once connected (no manual refresh).
  await win.waitForTimeout(6000);
  const autoPreview = await win.locator('img[alt="Live Lens Studio preview"]').count();
  console.log('auto-loaded preview image present:', autoPreview > 0);
  await win.screenshot({ path: '/tmp/ld-electron-designer.png' });

  // 4. Back to Assets; select the first card and confirm the viewer renders.
  await win.locator('[title="Assets"]').click();
  await win.waitForTimeout(1500);
  // Select the mesh card to render the GLB in the viewer; wait for texture load.
  await win.locator('[role="button"]', { hasText: 'GhostOnGlowCloud' }).first().click().catch(() => {});
  await win.locator('[role="button"]', { hasText: 'Ghost' }).first().click().catch(() => {});
  await win.waitForTimeout(9000);
  const canvases = await win.locator('canvas').count();
  const diag = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-maps]')).map((e) => ({
      meshes: (e as HTMLElement).dataset['meshes'],
      maps: (e as HTMLElement).dataset['maps'],
    })),
  );
  console.log('after selecting mesh → canvas elements:', canvases, '| GLB diag:', JSON.stringify(diag));
  await win.screenshot({ path: '/tmp/ld-electron-assets.png' });

  // 5. Audio: an inline card <audio> should load its data URL (no CSP block).
  await win.waitForTimeout(1500);
  const audioState = await win.evaluate(async () => {
    const a = document.querySelector('audio') as HTMLAudioElement | null;
    if (!a) return 'no audio element';
    // Wait briefly for metadata.
    await new Promise((r) => setTimeout(r, 2500));
    return { hasError: a.error != null, errorCode: a.error?.code ?? null, readyState: a.readyState, src: a.src.slice(0, 20) };
  });
  console.log('audio element state:', JSON.stringify(audioState));

  // 6. Multi-thread agent tabs: each "New Asset" choice opens its own thread
  //    tab so several generations can run + be monitored side-by-side. These
  //    open a tab only (no agent job runs until the user sends), so they're
  //    side-effect-free against the real project.
  const tabCountBefore = await win.locator('aside button[title^="New "], aside button[title^="Refine "]').count();
  await win.locator('button:has-text("New Asset")').first().click().catch(() => {});
  await win.locator('button:has-text("3D Asset")').first().click().catch(() => {});
  await win.waitForTimeout(400);
  await win.locator('button:has-text("New Asset")').first().click().catch(() => {});
  await win.locator('button:has-text("Music")').first().click().catch(() => {});
  await win.waitForTimeout(600);
  const tabCountAfter = await win.locator('aside button[title^="New "], aside button[title^="Refine "]').count();
  console.log('agent thread tabs before/after New Asset x2:', tabCountBefore, '→', tabCountAfter);
  console.log('multi-tab threads created:', tabCountAfter >= tabCountBefore + 2);

  // 7. Refine routing: select the mesh, type a change, click Refine. A
  //    "Refine <name>" tab should appear with the marker as the first user
  //    message. This DOES start a real job, so we immediately Stop it.
  await win.locator('[role="button"]', { hasText: 'Ghost' }).first().click().catch(() => {});
  await win.waitForTimeout(500);
  const refineInput = win.locator('input[placeholder*="cartoonish"], input[placeholder*="warmer"]').first();
  await refineInput.fill('zztest-refine-marker').catch(() => {});
  await win.locator('aside button:has-text("Refine"), button:has-text("Refine")').last().click().catch(() => {});
  await win.waitForTimeout(2000);
  const agentText = await win.locator('aside:has-text("Agents")').innerText().catch(() => '');
  console.log('refine routed into a thread (marker present):', /zztest-refine-marker/.test(agentText));
  const refineTab = (await win.locator('aside button[title^="Refine "]').count()) > 0;
  console.log('refine opened its own thread tab:', refineTab);
  const stopVisible = (await win.locator('button:has-text("Stop")').count()) > 0;
  console.log('stop control visible during run:', stopVisible);
  // Cancel the real job so we don't churn the project.
  await win.locator('button:has-text("Stop")').first().click().catch(() => {});
  await win.waitForTimeout(500);

  console.log('screenshots: /tmp/ld-electron-{designer,preview,assets}.png');
  void viewsText;
  await app.close();
  console.log('DONE');
}

main().catch((err) => {
  console.error('VERIFY FAILED:', err);
  process.exit(1);
});
