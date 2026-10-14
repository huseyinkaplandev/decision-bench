import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chatScore, decisionScore, type Run } from '../src/report.ts';

const run = JSON.parse(readFileSync(new URL('../results/run.json', import.meta.url), 'utf8')) as Run;

test('the recorded run is complete', () => {
  assert.equal(run.failures.length, 0);
  assert.equal(run.calls.length, 60 * 2 * run.repeats);
});

test('neither method paid out a refund the policy forbids', () => {
  assert.equal(chatScore(run).wrongRefunds, 0);
  for (const threshold of [0.5, 0.7, 0.9]) assert.equal(decisionScore(run, threshold).wrongRefunds, 0);
});

test('a higher threshold only adds needless handoffs on this data', () => {
  assert.ok(decisionScore(run, 0.9).needlessHandoffs > decisionScore(run, 0.5).needlessHandoffs);
});
