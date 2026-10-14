import { POLICY, type Label, type Ticket } from './policy.ts';

export const CHAT_MODEL = 'anthropic/claude-haiku-5.5';
export const DECISION_MODEL = 'typesafe/jev-1.13';

export type Call = {
  ticketId: string;
  method: 'chat-json' | 'chat-schema' | 'decision';
  repeat: number;
  /** chat-json / chat-schema: the parsed label, or null when the reply was not valid JSON. */
  label: Label | null;
  /** decision: probability that the customer qualifies. */
  probability: number | null;
  latencyMs: number;
  costUsd: number;
  raw: string;
};

const QUESTION =
  'The customer qualifies for a refund under the policy. False if any rule fails, ' +
  'if a needed fact is missing, or if the ticket contradicts the order record.';

function caseState(ticket: Ticket) {
  return { policy: POLICY, order_record: ticket.order, customer_message: ticket.message };
}

async function post(url: string, apiKey: string, body: unknown) {
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, any>;
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return { json, latencyMs };
}

const DECISION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'refund_decision',
    strict: true,
    schema: {
      type: 'object',
      properties: { decision: { type: 'string', enum: ['refund', 'handoff'] } },
      required: ['decision'],
      additionalProperties: false,
    },
  },
};

/** schema: true adds a strict JSON schema with an enum, so the reply can only be one of the two labels. */
export async function askChat(ticket: Ticket, repeat: number, apiKey: string, schema = false): Promise<Call> {
  const { json, latencyMs } = await post('https://openrouter.ai/api/v1/chat/completions', apiKey, {
    model: CHAT_MODEL,
    usage: { include: true },
    max_tokens: 1024,
    ...(schema ? { response_format: DECISION_SCHEMA, provider: { require_parameters: true } } : {}),
    messages: [
      {
        role: 'system',
        content: `${POLICY}\n\nReply with JSON only: {"decision": "refund"} or {"decision": "handoff"}.`,
      },
      { role: 'user', content: JSON.stringify(caseState(ticket)) },
    ],
  });
  const raw = String(json.choices?.[0]?.message?.content ?? '');
  let label: Label | null = null;
  try {
    const decision = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')).decision;
    if (decision === 'refund' || decision === 'handoff') label = decision;
  } catch {
    label = null;
  }
  return { ticketId: ticket.id, method: schema ? 'chat-schema' : 'chat-json', repeat, label, probability: null, latencyMs, costUsd: Number(json.usage?.cost ?? 0), raw };
}

export async function askDecision(ticket: Ticket, repeat: number, apiKey: string): Promise<Call> {
  const { json, latencyMs } = await post('https://openrouter.ai/api/alpha/decisions', apiKey, {
    model: DECISION_MODEL,
    state: caseState(ticket),
    questions: { qualifies: { type: 'noul', instructions: QUESTION } },
  });
  const probability = typeof json.answers?.qualifies?.noul === 'number' ? json.answers.qualifies.noul : null;
  return { ticketId: ticket.id, method: 'decision', repeat, label: null, probability, latencyMs, costUsd: Number(json.usage?.cost ?? 0), raw: JSON.stringify(json.answers ?? {}) };
}
