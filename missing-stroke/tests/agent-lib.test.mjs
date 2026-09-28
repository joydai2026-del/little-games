import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStroke, seededRandom, waitFor } from '../agent/lib.mjs';

const base = {
  phase: 'racing',
  serverNow: 5000,
  you: 'me',
  round: 2,
  rules: { revealMs: 3500 },
  turn: { index: 1, char: '水', hidden: 2, opensAt: 3000, closedAt: null },
  progress: { me: { turn: 1, rightAt: null, seq: 6 } },
};

test('plans the next answer from the room state', () => {
  assert.deepEqual(planStroke(base, { random: () => 0.9, mistakeRate: 0.1, thinkMs: 1000 }), {
    race: 2,
    seq: 7,
    turn: 1,
    result: 'correct',
    char: '水',
    hidden: 2,
  });
  assert.equal(planStroke(base, { random: () => 0.01, mistakeRate: 0.1 }).result, 'mistake');
});

test('does nothing while thinking, when closed, after a right answer, or outside a race', () => {
  assert.equal(planStroke(base, { thinkMs: 2500 }), null);
  assert.equal(planStroke({ ...base, turn: { ...base.turn, closedAt: 4000 } }), null);
  assert.equal(planStroke({ ...base, progress: { me: { turn: 1, rightAt: 4500, seq: 7 } } }), null);
  assert.equal(planStroke({ ...base, phase: 'done' }), null);
  assert.equal(planStroke({ ...base, progress: {} }), null);
});

test('waits until the character opens or the reveal ends', () => {
  assert.equal(waitFor(base, { thinkMs: 2500 }), 500);
  assert.equal(waitFor({ ...base, turn: { ...base.turn, closedAt: 4800 } }), 1000);
  assert.equal(waitFor({ ...base, turn: { ...base.turn, closedAt: 4000 } }), 1000);
  assert.equal(waitFor({ ...base, turn: { ...base.turn, closedAt: 1000 } }), 100);
  assert.equal(waitFor({ phase: 'lobby' }), 1000);
});

test('seeded random is repeatable', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
