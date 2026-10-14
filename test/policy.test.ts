import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedDecision } from '../src/policy.ts';
import { tickets } from '../src/tickets.ts';

const byId = (id: string) => {
  const ticket = tickets.find((candidate) => candidate.id === id);
  assert.ok(ticket, id);
  return ticket;
};

test('the dataset is stable: 60 tickets, 23 refunds, 37 handoffs', () => {
  assert.equal(tickets.length, 60);
  assert.equal(tickets.filter((ticket) => expectedDecision(ticket) === 'refund').length, 23);
});

test('day 30 is inside the window, day 31 is not', () => {
  assert.equal(expectedDecision(byId('x04')), 'refund');
  assert.equal(expectedDecision(byId('x11')), 'handoff');
});

test('final sale beats damage, contradictions and missing records go to a human', () => {
  assert.equal(expectedDecision(byId('x03')), 'handoff');
  assert.equal(expectedDecision(byId('x02')), 'handoff');
  assert.equal(expectedDecision(byId('x06')), 'handoff');
  assert.equal(expectedDecision(byId('x10')), 'handoff');
});
