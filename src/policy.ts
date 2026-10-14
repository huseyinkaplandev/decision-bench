export const POLICY = [
  'Refund policy.',
  '1. The order must exist in the order record.',
  '2. Refunds are allowed up to and including 30 days after delivery.',
  '3. The item must be unused, or it must have arrived damaged.',
  '4. Final-sale items are never refunded.',
  'If a fact needed for these rules is missing, or the ticket contradicts the order record,',
  'the case goes to a human.',
].join('\n');

export type Condition = 'unopened' | 'opened-unused' | 'used' | 'damaged-on-arrival' | 'not-stated';

export type OrderRecord = {
  orderId: string;
  found: boolean;
  deliveredDaysAgo: number | null;
  finalSale: boolean;
};

export type Ticket = {
  id: string;
  /** What the customer wrote. */
  message: string;
  /** What the lookup_order tool returned. */
  order: OrderRecord;
  /** Ground truth facts the message was written from. Never sent to a model. */
  facts: { condition: Condition; contradictsRecord: boolean };
  /** Hand-written edge case rather than a template. */
  tricky: boolean;
};

export type Label = 'refund' | 'handoff';

export function expectedDecision(ticket: Ticket): Label {
  const { order, facts } = ticket;
  if (!order.found || order.deliveredDaysAgo === null) return 'handoff';
  if (facts.contradictsRecord || facts.condition === 'not-stated') return 'handoff';
  if (order.finalSale) return 'handoff';
  if (order.deliveredDaysAgo > 30) return 'handoff';
  return facts.condition === 'used' ? 'handoff' : 'refund';
}
