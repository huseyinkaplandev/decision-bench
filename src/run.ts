// Live run: every ticket, both methods, REPEATS times each. Needs OPENROUTER_API_KEY.
// Writes results/run.json. Everything else in this repo reads that file and needs no key.
import { writeFileSync } from 'node:fs';
import { askChat, askDecision, CHAT_MODEL, DECISION_MODEL, type Call } from './methods.ts';
import { tickets } from './tickets.ts';

const REPEATS = 3;
const CONCURRENCY = 6;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set. `npm run report` works without it.');
  process.exit(1);
}

const jobs: (() => Promise<Call>)[] = [];
for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const ticket of tickets) {
    jobs.push(() => askChat(ticket, repeat, apiKey));
    jobs.push(() => askDecision(ticket, repeat, apiKey));
  }
}

const calls: Call[] = [];
const failures: string[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++] as () => Promise<Call>;
    try {
      calls.push(await job());
    } catch (error) {
      failures.push(String(error));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(
  new URL('../results/run.json', import.meta.url),
  `${JSON.stringify({ ranAt: new Date().toISOString(), chatModel: CHAT_MODEL, decisionModel: DECISION_MODEL, repeats: REPEATS, failures, calls }, null, 2)}\n`,
);
console.log(`${calls.length} calls, ${failures.length} failures -> results/run.json`);
