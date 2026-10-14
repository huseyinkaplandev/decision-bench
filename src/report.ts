import { readFileSync, writeFileSync } from 'node:fs';
import type { Call } from './methods.ts';
import { expectedDecision, type Label } from './policy.ts';
import { tickets } from './tickets.ts';

export type Run = { ranAt: string; chatModel: string; decisionModel: string; repeats: number; failures: string[]; calls: Call[] };

export type Score = {
  calls: number;
  correct: number;
  /** Paid out money the policy says to keep. The expensive mistake. */
  wrongRefunds: number;
  /** Sent to a human when the policy allowed an automatic refund. */
  needlessHandoffs: number;
  invalid: number;
  /** Tickets whose repeats did not all agree. */
  flippedTickets: number;
  p50LatencyMs: number;
  costPer1kUsd: number;
};

const expected = new Map(tickets.map((ticket) => [ticket.id, expectedDecision(ticket)]));

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function score(calls: Call[], decide: (call: Call) => Label | null): Score {
  const result: Score = { calls: calls.length, correct: 0, wrongRefunds: 0, needlessHandoffs: 0, invalid: 0, flippedTickets: 0, p50LatencyMs: 0, costPer1kUsd: 0 };
  const byTicket = new Map<string, Set<string>>();
  for (const call of calls) {
    const label = decide(call);
    const truth = expected.get(call.ticketId);
    if (label === null) result.invalid++;
    else if (label === truth) result.correct++;
    else if (label === 'refund') result.wrongRefunds++;
    else result.needlessHandoffs++;
    const seen = byTicket.get(call.ticketId) ?? new Set<string>();
    seen.add(String(label));
    byTicket.set(call.ticketId, seen);
  }
  result.flippedTickets = [...byTicket.values()].filter((labels) => labels.size > 1).length;
  result.p50LatencyMs = median(calls.map((call) => call.latencyMs));
  result.costPer1kUsd = Number(((calls.reduce((sum, call) => sum + call.costUsd, 0) / calls.length) * 1000).toFixed(4));
  return result;
}

export function chatScore(run: Run, method: 'chat-json' | 'chat-schema' = 'chat-json'): Score {
  return score(run.calls.filter((call) => call.method === method), (call) => call.label);
}

export function decisionScore(run: Run, threshold: number): Score {
  return score(run.calls.filter((call) => call.method === 'decision'), (call) =>
    call.probability === null ? null : call.probability >= threshold ? 'refund' : 'handoff',
  );
}

export const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

export function summarize(run: Run) {
  return {
    ranAt: run.ranAt,
    chatModel: run.chatModel,
    decisionModel: run.decisionModel,
    tickets: tickets.length,
    repeats: run.repeats,
    chat: chatScore(run),
    chatSchema: chatScore(run, 'chat-schema'),
    decision: THRESHOLDS.map((threshold) => ({ threshold, ...decisionScore(run, threshold) })),
    perTicket: tickets.map((ticket) => {
      const calls = run.calls.filter((call) => call.ticketId === ticket.id);
      return {
        id: ticket.id,
        tricky: ticket.tricky,
        message: ticket.message,
        order: ticket.order,
        expected: expectedDecision(ticket),
        chat: calls.filter((call) => call.method === 'chat-json').map((call) => call.label),
        chatSchema: calls.filter((call) => call.method === 'chat-schema').map((call) => call.label),
        probability: calls.filter((call) => call.method === 'decision').map((call) => call.probability),
      };
    }),
  };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  const run = JSON.parse(readFileSync(new URL('../results/run.json', import.meta.url), 'utf8')) as Run;
  const summary = summarize(run);
  writeFileSync(new URL('../results/summary.json', import.meta.url), `${JSON.stringify(summary, null, 2)}\n`);
  const row = (name: string, s: Score) =>
    `| ${name} | ${s.correct}/${s.calls} | ${s.wrongRefunds} | ${s.needlessHandoffs} | ${s.invalid} | ${s.flippedTickets} | ${s.p50LatencyMs} | $${s.costPer1kUsd} |`;
  console.log(`${summary.tickets} tickets x ${summary.repeats} repeats, ran ${summary.ranAt}\n`);
  console.log('| method | correct | wrong refunds | needless handoffs | invalid | flipped tickets | p50 ms | cost / 1k |');
  console.log('|---|---|---|---|---|---|---|---|');
  console.log(row(`chat JSON (${summary.chatModel})`, summary.chat));
  console.log(row(`chat strict schema (${summary.chatModel})`, summary.chatSchema));
  for (const entry of summary.decision) console.log(row(`decision >= ${entry.threshold} (${summary.decisionModel})`, entry));
}
