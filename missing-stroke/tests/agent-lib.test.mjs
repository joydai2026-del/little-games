import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMissing, planStroke, seededRandom, waitFor } from '../agent/lib.mjs';

const full = { strokes: ['A', 'B', 'C'], medians: [[[0, 0], [10, 0]], [[5, 5], [5, 50]], [[1, 1], [2, 2], [3, 3]]] };
const base = {
  phase: 'racing',
  serverNow: 5000,
  you: 'me',
  round: 2,
  rules: { revealMs: 3500 },
  turn: { index: 1, char: '水', visible: ['A', 'C'], opensAt: 3000, closedAt: null },
  progress: { me: { turn: 1, rightAt: null, seq: 6 } },
};

test('finds the missing stroke by reading the character', () => {
  assert.equal(findMissing(full, ['A', 'C']), 1);
  assert.equal(findMissing(full, ['A', 'B', 'C']), -1);
  assert.equal(findMissing(null, ['A']), -1);
});

test('draws the missing stroke along its median, or backwards for a planned miss', () => {
  assert.deepEqual(planStroke(base, full, { random: () => 0.9, mistakeRate: 0.1, thinkMs: 1000 }), {
    race: 2, seq: 7, turn: 1, points: [[5, 5], [5, 50]], kind: 'right', char: '水', stroke: 1,
  });
  const miss = planStroke(base, full, { random: () => 0.01, mistakeRate: 0.1 });
  assert.equal(miss.kind, 'miss');
  assert.deepEqual(miss.points, [[5, 50], [5, 5]]);
  assert.equal('result' in miss, false);
});

test('does nothing while thinking, when closed, after a right answer, or outside a race', () => {
  assert.equal(planStroke(base, full, { thinkMs: 2500 }), null);
  assert.equal(planStroke({ ...base, turn: { ...base.turn, closedAt: 4000 } }, full), null);
  assert.equal(planStroke({ ...base, progress: { me: { turn: 1, rightAt: 4500, seq: 7 } } }, full), null);
  assert.equal(planStroke({ ...base, phase: 'done' }, full), null);
  assert.equal(planStroke({ ...base, progress: {} }, full), null);
});

test('waits until the character opens or the reveal ends', () => {
  assert.equal(waitFor(base, { thinkMs: 2500 }), 500);
  assert.equal(waitFor({ ...base, turn: { ...base.turn, closedAt: 4800 } }), 1000);
  assert.equal(waitFor({ ...base, turn: { ...base.turn, closedAt: 1000 } }), 100);
  assert.equal(waitFor({ phase: 'lobby' }), 1000);
});

test('seeded random is repeatable', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
