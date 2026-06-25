import { AgentRunner } from '../src/services/agent-runner.js';
import { readFile, writeFile, copyFile } from 'node:fs/promises';

const PROJ = '/Users/jabsbot/Developer/specs/ld-bookshelf-app';
const VIEW = `${PROJ}/Assets/Scripts/SettingsViewUI.ts`;
const MARKER = 'WYSIWYG Verified';

const before = await readFile(VIEW, 'utf8');
await copyFile(VIEW, VIEW + '.ldbak'); // backup to restore after
console.log('before contains marker:', before.includes(MARKER));

const prompt =
  `In the SpectaclesUIKit view at this exact file path: ${VIEW}\n` +
  `Modify the element named "Header" (a Text): set its text to "${MARKER}".\n` +
  `Edit the view's TypeScript source to apply this. Keep every other element unchanged. ` +
  `You do not need to recompile — just make the source edit.`;

const runner = new AgentRunner();
runner.on('event', (e: any) => { if (e.kind === 'tool') process.stdout.write(`[${e.tool}]`); });
const handle = runner.run({ prompt, cwd: PROJ, permissionMode: 'acceptEdits', maxTurns: 12 });
const res = await handle.done;
console.log('\nagent ok:', res.ok);

const after = await readFile(VIEW, 'utf8');
console.log('AFTER contains marker:', after.includes(MARKER));
console.log('source changed:', before !== after);

// restore the user's original file
await writeFile(VIEW, before, 'utf8');
const { rm } = await import('node:fs/promises');
await rm(VIEW + '.ldbak', { force: true });
console.log('restored original SettingsViewUI.ts');
