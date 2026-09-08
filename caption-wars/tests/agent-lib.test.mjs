import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripSurroundingQuotes,
  toOneLine,
  capLength,
  sanitizeCaption,
  parsePickedNumber,
} from '../agent/lib.mjs';

test('stripSurroundingQuotes removes one layer of matching quotes', () => {
  assert.equal(stripSurroundingQuotes('"Nice goat."'), 'Nice goat.');
  assert.equal(stripSurroundingQuotes("'Nice goat.'"), 'Nice goat.');
  assert.equal(stripSurroundingQuotes('“Nice goat.”'), 'Nice goat.');
  assert.equal(stripSurroundingQuotes('No quotes here'), 'No quotes here');
  assert.equal(stripSurroundingQuotes('"mismatched\''), '"mismatched\'');
});

test('toOneLine collapses multi-line text into one line', () => {
  assert.equal(toOneLine('line one\nline two\n\nline three'), 'line one line two line three');
  assert.equal(toOneLine('  spaced   out   text  '), 'spaced out text');
  assert.equal(toOneLine(''), '');
});

test('capLength enforces a hard character cap', () => {
  const long = 'x'.repeat(200);
  assert.equal(capLength(long, 120).length, 120);
  assert.equal(capLength('short', 120), 'short');
});

test('sanitizeCaption composes one-line + quote-strip + cap, and never throws', () => {
  assert.equal(sanitizeCaption('"Judging you silently, chewing loudly."'), 'Judging you silently, chewing loudly.');
  assert.equal(sanitizeCaption('line one\nline two'), 'line one line two');
  assert.equal(sanitizeCaption('y'.repeat(500)).length, 120);
  assert.equal(sanitizeCaption(null), '');
  assert.equal(sanitizeCaption(undefined), '');
  assert.equal(sanitizeCaption(42), '');
});

test('parsePickedNumber handles a bare number', () => {
  assert.equal(parsePickedNumber('3', 5), 3);
  assert.equal(parsePickedNumber('  2  ', 5), 2);
});

test('parsePickedNumber handles "Number N" and "#N" phrasing', () => {
  assert.equal(parsePickedNumber('Number 3', 5), 3);
  assert.equal(parsePickedNumber('#3', 5), 3);
  assert.equal(parsePickedNumber('caption #2 is funniest', 5), 2);
});

test('parsePickedNumber handles a reasoned answer', () => {
  assert.equal(parsePickedNumber("I pick 3 because it's funnier", 5), 3);
  assert.equal(parsePickedNumber('I would vote for option 4, it made me laugh', 5), 4);
});

test('parsePickedNumber rejects an out-of-range pick and falls back or returns null', () => {
  assert.equal(parsePickedNumber('10', 3), null);
  // "pick 10" is out of range for count=3, but there is no other number in the text
  assert.equal(parsePickedNumber('I pick 10', 3), null);
});

test('parsePickedNumber returns null when nothing usable is found', () => {
  assert.equal(parsePickedNumber('that one made me laugh the hardest', 5), null);
  assert.equal(parsePickedNumber('', 5), null);
  assert.equal(parsePickedNumber('3', 0), null);
  assert.equal(parsePickedNumber(null, 5), null);
});
