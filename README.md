# decision-bench

**[Move the threshold yourself →](https://huseyinkaplan.dev/lab/decision-bench/)** — every number
below comes from `results/run.json`, and the page replays it with a slider. No API key needed.

The same refund decision, asked three ways, 180 times each:

- **chat JSON**: a chat model (`anthropic/claude-haiku-5.5`) reads the policy and the ticket and
  replies `{"decision": "refund"}` or `{"decision": "handoff"}`.
- **chat strict schema**: the same call with a strict JSON schema whose `decision` field is an enum
  of the two labels, so the reply cannot be anything else.
- **decision**: a decision model (`typesafe/jev-1.13` through the OpenRouter Decisions API) gets the
  same input and returns one number: the probability that the customer qualifies.

This is the decision step of the refund agent in
[agent-runtime-bench](https://github.com/huseyinkaplandev/agent-runtime-bench). That repo held the
model still and changed the runtime. This one holds the runtime still and changes how the model
answers.

## Setup

`src/policy.ts` holds a four-rule refund policy and `expectedDecision()`, which derives the correct
answer from the facts each ticket was written from. Those facts are never sent to a model.

`src/tickets.ts` builds 60 tickets: 48 from seeded templates and 12 hand-written edge cases (day 30
vs day 31, a final-sale item that arrived broken, a ticket that contradicts the order record, an
order that does not exist, a prompt injection). 23 should be refunded, 37 should go to a human.

Both methods get identical input: the policy, the order record and the customer message. Each
ticket runs 3 times per method, so 180 calls each.

## Results

Run on 2026-10-14 (the strict-schema arm was added to the same run file the same morning). Reproduce the table from the recorded run with `npm run report`.

| method | correct | wrong refunds | needless handoffs | flipped tickets | p50 latency | cost / 1k decisions |
|---|---|---|---|---|---|---|
| chat JSON (claude-haiku-5.5) | 175/180 | 0 | 5 | 1 | 2064 ms | $0.132 |
| chat strict schema (claude-haiku-5.5) | 177/180 | 0 | 3 | 0 | 2138 ms | $0.134 |
| decision >= 0.5 (jev-1.13) | 177/180 | 0 | 3 | 0 | 506 ms | $0.020 |
| decision >= 0.7 | 176/180 | 0 | 4 | 1 | | |
| decision >= 0.8 | 168/180 | 0 | 12 | 0 | | |
| decision >= 0.9 | 139/180 | 0 | 41 | 3 | | |
| decision >= 0.95 | 111/180 | 0 | 69 | 0 | | |

*Wrong refund* = money paid that the policy says to keep. *Needless handoff* = a human gets a case
the policy would have refunded automatically. *Flipped* = the 3 repeats of one ticket disagreed.

## What the numbers say

**On accuracy, it is a tie.** Nobody paid a single wrong refund. Plain JSON was right 175 times and
changed its answer on one ticket across repeats (x09: refund, handoff, handoff). With a strict schema
the chat model was right 177 times, exactly like the decision model, with the same single miss (x05).
So the schema closes the accuracy gap. It does not give you a number.

**The decision model is 4x faster and about 6.6x cheaper per decision** on this run. It returns a
number, not text, so there is nothing to generate and nothing to parse.

**The number is the part a word cannot give you.** Every ticket that should go to a human scored
0.18 or lower. Every ticket that should be refunded scored 0.69 or higher, except one: x05 at
0.34 to 0.36, where the customer asks *"I tried it on once in my room, does that count as used?"*
I labelled it a refund before the run. Both models disagreed with me, and the decision model put it
in the only empty space on the scale. The chat model said `handoff` there in exactly the same way
it said `handoff` to the prompt injection in x12, which scored 0.03.

**Pick the threshold from your data, not from instinct.** On this set, 0.9 "to be safe" sends 41 of
180 cases to a human and stops zero extra bad refunds, because there were none to stop. The gap
between 0.18 and 0.69 is where the threshold belongs.

## The scores repeat

A second full run 42 minutes later (`results/replication.json`) moved no ticket's mean decision
score by more than 0.033. x05 went from 0.35 to 0.34, the handoff group still topped out at 0.18 and
the refund group still started at 0.70. A test checks the 0.05 bound.

## Pick your own threshold

1. Label a sample of real cases with what the policy says (a few hundred is enough to start).
2. Score them, then find the lowest threshold that pays zero wrong refunds on that sample.
3. Add a margin, run it in shadow mode next to the current process, and read every disagreement.

```ts
// labelled: { p: number; shouldRefund: boolean }[]
function lowestSafeThreshold(labelled: { p: number; shouldRefund: boolean }[]): number {
  for (let step = 5; step <= 99; step++) {
    const threshold = step / 100;
    const wrongRefunds = labelled.filter((item) => item.p >= threshold && !item.shouldRefund).length;
    if (wrongRefunds === 0) return threshold;
  }
  return 1;
}
```

On this run it returns 0.19, the edge of the gap. The lab page lets you see what each step above it
costs in handoffs.

## Caveats

- 60 synthetic tickets and one policy. Labels come from rules I wrote, and x05 is a judgment call I
  would now label `handoff`.
- One chat model. The strict-schema arm removes parse risk; it still returns a word, not a probability.
- `claude-haiku-5.5` reasons before it answers. A first run with `max_tokens: 50` came back empty
  because reasoning used the budget; the numbers above use 1024.
- Latency was measured from Istanbul through OpenRouter, one run, concurrency 6.
- Cost uses the `usage.cost` OpenRouter returned for each call.

## Run it

```bash
npm install
npm test              # policy rules + checks on the recorded run, no key
npm run report        # rebuilds the table and results/summary.json, no key
OPENROUTER_API_KEY=... npm run run:live   # 540 live calls, about $0.05
OPENROUTER_API_KEY=... npm run run:live -- --only=chat-schema   # one method, merged into run.json
```
