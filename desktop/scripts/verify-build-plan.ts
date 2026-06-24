import { AgentRunner } from '../src/services/agent-runner.js';
import { buildPlanPrompt, parseManifest } from '../src/services/build-plan.js';

const runner = new AgentRunner();
let text = '';
const handle = runner.run({
  prompt: buildPlanPrompt('a cozy bookshelf where I can pull books off the shelf and a chime plays'),
  cwd: process.cwd(),
  allowedTools: [],
  maxTurns: 1,
  onEvent: (e: any) => {
    if (e.kind === 'result' && e.text) text = e.text;
    else if (e.kind === 'assistant' && e.text) text = e.text;
  },
});
const res = await handle.done;
console.log('ok:', res.ok);
console.log('--- raw text (first 400) ---\n' + text.slice(0, 400));
console.log('--- parsed manifest ---');
console.log(JSON.stringify(parseManifest(text), null, 1));
