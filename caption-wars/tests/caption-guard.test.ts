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

  it('catches a descriptor next to a people-noun, and a descriptor used as a noun', () => {
    expect(looksLikeLabelling('Two asian guys arguing with a map')).toBe(true);
    expect(looksLikeLabelling('a whole group of Asians waiting for the bus')).toBe(true);
    expect(looksLikeLabelling('white men doing white middle-aged things')).toBe(true);
    // The people-noun has to be the NEXT word. A descriptor two words away is
    // usually describing the thing in between ("korean bbq family"), and a guard
    // that fires on ordinary captions silences the bots and can void a round.
    expect(looksLikeLabelling('white middle-aged men in a queue')).toBe(false);
  });

  it('covers body, age and disability, not just race: the categories the prompt promises', () => {
    // Round 3 found the guard was narrower than the rule the models are given:
    // the exact shape of the live incident sailed through as soon as the
    // category shifted from race to body or age.
    expect(labellingMatch('Fat guy just standing there.')).toBe('fat guy');
    expect(labellingMatch('Old woman just standing there.')).toBe('old woman');
    expect(labellingMatch('Disabled people waiting in line.')).toBe('disabled people');
    expect(labellingMatch('A group of people of color waiting for the bus.')).toBe(
      'people of color'
    );
    expect(looksLikeLabelling('A group of people of colour waiting for the bus.')).toBe(true);
  });

  it('does NOT fire on the ordinary captions a photo game is full of', () => {
    // Every one of these tripped the shipped guard before round 3, on photos
    // tagged dog / cat / party / costume, which is exactly what a caption is
    // about. A tripped bot caption is a bot that says nothing, and two silent
    // bots in a solo game void the round.
    for (const caption of [
      'Black Friday crowd control, level: expert',
      'the black cat lady strikes again',
      'a black tie couple who peaked in 2009',
      'black and white family photo energy',
      'the white wine guy has opinions',
      'his white dress lady is unimpressed',
      'korean bbq family reunion, day three',
      'the chinese food guy knows my order',
    ]) {
      expect(labellingMatch(caption), caption).toBeNull();
    }
  });

  it('still catches the colour-word labels, which is why the false positives could not just be dropped', () => {
    expect(labellingMatch('black people just standing there')).toBe('black people');
    expect(labellingMatch('two white guys and a ladder')).toBe('white guys');
    expect(labellingMatch('brown folks at the market')).toBe('brown folks');
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
    expect(BLOCKED_TERMS.bodyAgeDisabilityDescriptors?.length).toBeGreaterThan(0);
    expect(BLOCKED_TERMS.bodyAgeDisabilityDescriptors?.length).toBeLessThan(30);
    expect(BLOCKED_TERMS.peopleNouns).toContain('people');
    // Colour words are two-word phrases, never bare descriptors: as adjectives
    // they belong to objects (black cat, white wine, black tie) far more often
    // than to people.
    expect(BLOCKED_TERMS.descriptors).not.toContain('black');
    expect(BLOCKED_TERMS.descriptors).not.toContain('white');
    expect(BLOCKED_TERMS.phrases).toContain('black people');
  });
});
