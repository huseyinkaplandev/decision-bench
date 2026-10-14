// Live run: every ticket, every method, REPEATS times each. Needs OPENROUTER_API_KEY.
// Writes results/run.json. Everything else in this repo reads that file and needs no key.
// --only=<method> runs one method and merges its calls into the existing results/run.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { askChat, askDecision, CHAT_MODEL, DECISION_MODEL, type Call } from './methods.ts';
import { tickets } from './tickets.ts';

const REPEATS = 3;
const CONCURRENCY = 6;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set. `npm run report` works without it.');
  process.exit(1);
}

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) as Call['method'] | undefined;
const wanted = (method: Call['method']) => !only || only === method;

const jobs: (() => Promise<Call>)[] = [];
for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const ticket of tickets) {
    if (wanted('chat-json')) jobs.push(() => askChat(ticket, repeat, apiKey));
    if (wanted('chat-schema')) jobs.push(() => askChat(ticket, repeat, apiKey, true));
    if (wanted('decision')) jobs.push(() => askDecision(ticket, repeat, apiKey));
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

const target = new URL('../results/run.json', import.meta.url);
const previous = only && existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
const result = previous
  ? { ...previous, failures: [...previous.failures, ...failures], calls: [...previous.calls.filter((call: Call) => call.method !== only), ...calls] }
  : { ranAt: new Date().toISOString(), chatModel: CHAT_MODEL, decisionModel: DECISION_MODEL, repeats: REPEATS, failures, calls };
writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
console.log(`${calls.length} calls, ${failures.length} failures -> results/run.json`);
