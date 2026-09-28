import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStroke, seededRandom } from '../agent/lib.mjs';

const base = {
  phase: 'racing',
  goAt: 1000,
  serverNow: 2000,
  you: 'me',
  round: 2,
  roundWords: ['人口', '大'],
  list: { strokeCounts: { 人: 2, 口: 3, 大: 3 } },
  progress: { me: { wordIndex: 0, charIndex: 1, strokeIndex: 2, finishedAt: null, seq: 6 } },
};

test('plans the next stroke (word, character, stroke) from the room state', () => {
  assert.deepEqual(planStroke(base, { random: () => 0.9, mistakeRate: 0.1 }), {
    race: 2, seq: 7, wordIndex: 0, charIndex: 1, strokeIndex: 2, result: 'correct', word: '人口',
  });
  assert.equal(planStroke(base, { random: () => 0.01, mistakeRate: 0.1 }).result, 'mistake');
});

test('does nothing before GO, after finishing, or outside a round', () => {
  assert.equal(planStroke({ ...base, serverNow: 500 }), null);
  assert.equal(planStroke({ ...base, phase: 'done' }), null);
  assert.equal(planStroke({ ...base, progress: { me: { ...base.progress.me, finishedAt: 5 } } }), null);
});

test('seeded random is repeatable', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
