import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchingCards, planGuess, seededRandom, firstChar } from '../agent/lib.mjs';

const load = (c) => JSON.parse(readFileSync(new URL(`./fixtures/${c}.json`, import.meta.url), 'utf8'));
const da = load('大');
const ren = load('人');
const shan = load('山');
const xue = load('学');

const state = (over = {}) => ({
  phase: 'playing',
  round: 1,
  inRound: true,
  serverNow: 5000,
  score: { seq: 3 },
  mine: null,
  question: { index: 0, cards: ['山', '大人', '学校', '人'], startAt: 1000, closedAt: null },
  ...over,
});
const cardData = [shan, da, xue, ren];
const drawing = (data, n, complete = false) => ({ round: 1, question: 0, strokes: data.strokes.slice(0, n), complete });

test('matching compares drawn strokes with each card\'s first character', () => {
  assert.equal(firstChar('大人'), '大');
  assert.deepEqual(matchingCards(drawing(da, 0), cardData), [0, 1, 2, 3]);
  assert.deepEqual(matchingCards(drawing(da, 1), cardData), [1]);
  assert.deepEqual(matchingCards(drawing(xue, 8), cardData), [2]);
});

test('waits for patience, then taps the one matching card with the next seq', () => {
  assert.equal(planGuess(state(), drawing(xue, 2), cardData, { patience: 0.5, mistakeRate: 0 }), null);
  assert.deepEqual(planGuess(state(), drawing(xue, 4), cardData, { patience: 0.5, mistakeRate: 0 }), { race: 1, question: 0, seq: 4, card: 2 });
  assert.equal(planGuess(state(), drawing(da, 3, true), cardData, { patience: 1, mistakeRate: 0 }).card, 1);
});

test('does nothing when it cannot or should not guess', () => {
  const d = drawing(da, 3, true);
  assert.equal(planGuess(state({ phase: 'done' }), d, cardData), null);
  assert.equal(planGuess(state({ inRound: false }), d, cardData), null);
  assert.equal(planGuess(state({ mine: { correctAt: 1, locked: false, tried: [] } }), d, cardData), null);
  assert.equal(planGuess(state({ mine: { correctAt: null, locked: true, tried: [0] } }), d, cardData), null);
  assert.equal(planGuess(state({ mine: { correctAt: null, locked: false, tried: [0], coolUntil: 9000 } }), d, cardData), null);
  assert.equal(planGuess(state({ serverNow: 500 }), d, cardData), null);
  assert.equal(planGuess(state(), { ...d, question: 1 }, cardData), null);
});

test('a mistake taps an untried wrong card', () => {
  const p = planGuess(state({ mine: { correctAt: null, locked: false, tried: [0], coolUntil: null } }), drawing(da, 3, true), cardData, { mistakeRate: 1, random: seededRandom(3) });
  assert.ok([2, 3].includes(p.card));
});
