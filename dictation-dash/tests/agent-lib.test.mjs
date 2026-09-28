import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, seededRandom, strokePoints } from '../agent/lib.mjs';

test('candidates: list words with the right number of boxes, not already closed', () => {
  const me = { charCount: 2, closed: [{ word: '朋友', result: 'written' }] };
  assert.deepEqual(candidates(me, ['朋友', '学校', '大', '大山']), ['学校', '大山']);
  assert.deepEqual(candidates({ charCount: null }, ['大']), []);
});

test('strokePoints: the median as points; wrong = backwards', () => {
  const medians = [[[1, 2], [3, 4], [5, 6]]];
  assert.deepEqual(strokePoints(medians, 0), [[1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(strokePoints(medians, 0, { wrong: true }), [[5, 6], [3, 4], [1, 2]]);
  assert.equal(strokePoints(medians, 3), null);
});

test('seeded random is repeatable', () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
