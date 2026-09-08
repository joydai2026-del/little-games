// The bot content guard: src/shared/caption-guard.ts.
//
// The first case is the exact caption a Workers AI bot produced in a live game
// on 2026-09-07, which is why this file exists. The rest are the other half of
// the job: ordinary captions must sail through, because a guard that fires on
// normal play just makes the bots go quiet.

import { describe, expect, it } from 'vitest';
import { BLOCKED_TERMS, labellingMatch, looksLikeLabelling } from '../src/shared/caption-guard';

describe('looksLikeLabelling', () => {
  it('trips on the caption from the live game', () => {
    expect(looksLikeLabelling('Black people just standing there.')).toBe(true);
    expect(labellingMatch('Black people just standing there.')).toBe('black people');
  });

  it('lets ordinary captions through', () => {
    expect(looksLikeLabelling('When the coffee ran out an hour ago and nobody told you.')).toBe(
      false
    );
    expect(looksLikeLabelling('Nobody warned the goat it was a formal event.')).toBe(false);
    expect(looksLikeLabelling('This is what happens when the map says turn left.')).toBe(false);
  });

  it('does not fire on a descriptor that is not labelling a person', () => {
    expect(looksLikeLabelling('The black cat has decided this is its chair now.')).toBe(false);
    expect(looksLikeLabelling('Indian food at 2am was a decision.')).toBe(false);
  });

  it('catches the same shape with a word in between, and a descriptor used as a noun', () => {
    expect(looksLikeLabelling('Two asian guys arguing with a map')).toBe(true);
    expect(looksLikeLabelling('a whole group of Asians waiting for the bus')).toBe(true);
    expect(looksLikeLabelling('white men doing white middle-aged things')).toBe(true);
    // The gap is two words at most, on purpose: widening it starts catching
    // ordinary captions ("asian food the guys ordered").
    expect(looksLikeLabelling('white middle-aged men in a queue')).toBe(false);
  });

  it('is a guard, not a classifier: a people-noun it does not carry slips through', () => {
    // "tourists" is not in peopleNouns and the list is deliberately not
    // exhaustive. The PROMPT is the primary defence; this check is the cheap
    // backstop for the obvious shape. Chasing every noun would trade a real
    // false-negative for a pile of false positives on ordinary captions.
    expect(looksLikeLabelling('Two asian tourists arguing with a map')).toBe(false);
  });

  it('matches phrases whatever the punctuation between the words', () => {
    expect(looksLikeLabelling('You people never learn!')).toBe(true);
    expect(looksLikeLabelling('That is so typical of them.')).toBe(true);
    expect(looksLikeLabelling('typical, of them...')).toBe(true);
    expect(looksLikeLabelling('a typical Tuesday for them')).toBe(false);
  });

  it('is empty-safe and takes a caller-supplied term list', () => {
    expect(looksLikeLabelling('')).toBe(false);
    expect(looksLikeLabelling('   ')).toBe(false);
    const custom = { descriptors: [], peopleNouns: [], standaloneLabels: [], phrases: ['no dogs'] };
    expect(looksLikeLabelling('Black people just standing there.', custom)).toBe(false);
    expect(looksLikeLabelling('Sign says NO DOGS, dog cannot read.', custom)).toBe(true);
  });

  it('ships a term list that is short and only about labelling people', () => {
    expect(BLOCKED_TERMS.descriptors.length).toBeGreaterThan(0);
    expect(BLOCKED_TERMS.descriptors.length).toBeLessThan(30);
    expect(BLOCKED_TERMS.peopleNouns).toContain('people');
  });
});
