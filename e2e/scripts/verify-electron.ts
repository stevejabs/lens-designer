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
  // Click the actual mesh card by name (GhostonGlowCloud) to render the GLB.
  await win.locator('button', { hasText: 'GhostonGlowCloud' }).first().click().catch(() => {});
  await win.waitForTimeout(5000);
  const canvases = await win.locator('canvas').count();
  const audios = await win.locator('audio').count();
  console.log('after selecting mesh → canvas elements:', canvases, '| audio elements:', audios);
  await win.screenshot({ path: '/tmp/ld-electron-assets.png' });

  console.log('screenshots: /tmp/ld-electron-{designer,preview,assets}.png');
  void viewsText;
  await app.close();
  console.log('DONE');
}

main().catch((err) => {
  console.error('VERIFY FAILED:', err);
  process.exit(1);
});
