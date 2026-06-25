import { AgentRunner } from '../src/services/agent-runner.js';
import { readFile, writeFile, copyFile, rm } from 'node:fs/promises';
const PROJ='/Users/jabsbot/Developer/specs/ld-bookshelf-app';
const VIEW=`${PROJ}/Assets/Scripts/SettingsViewUI.ts`;
const before = await readFile(VIEW,'utf8');
await copyFile(VIEW, VIEW+'.ldbak');
// order of genre rows before
const order = (s:string)=> (s.match(/Fiction|Mystery|Sci-?Fi|Fantasy|Romance|History/g)||[]).slice(0,6).join(',');
console.log('genres before:', order(before));
const prompt =
  `In the SpectaclesUIKit view at this exact file path: ${VIEW}\n`+
  `Reorder the layout so the "Mystery" genre row comes before the "Fiction" genre row within their shared parent. `+
  `Edit the source so they build in that order. Change nothing else. You do not need to recompile.`;
const r = new AgentRunner();
r.on('event',(e:any)=>{ if(e.kind==='tool') process.stdout.write(`[${e.tool}]`); });
const res = await r.run({ prompt, cwd: PROJ, permissionMode:'acceptEdits', maxTurns:14 }).done;
const after = await readFile(VIEW,'utf8');
console.log('\nagent ok:', res.ok);
console.log('genres after :', order(after));
console.log('source changed:', before!==after);
await writeFile(VIEW, before, 'utf8'); await rm(VIEW+'.ldbak',{force:true});
console.log('restored original');
