// The bot content guard and the refusal detector: src/shared/caption-guard.ts.
//
// The case table lives in tests/guard-cases.json and is read by this file AND
// by tests/agent-lib.test.mjs, which drives the mjs twin in agent/lib.mjs. One
// table, two implementations, identical answers: that parity is the point, and
// a table written out twice drifts (round 3 shipped a false-positive class green
// because only the reported captions were asserted).
//
// The PRINCIPLE these cases pin down is written in the header of
// src/shared/caption-guard.ts. Read it before changing a single expectation.

import { describe, expect, it } from 'vitest';
import cases from './guard-cases.json';
import {
  BLOCKED_TERMS,
  labellingMatch,
  looksLikeLabelling,
  looksLikeRefusal,
  refusalMatch,
  stripCaptionPrefix,
} from '../src/shared/caption-guard';

describe('labellingMatch: the shared case table', () => {
  it('trips on every must-trip caption', () => {
    for (const caption of cases.mustTrip) {
      expect(labellingMatch(caption), `must trip: ${caption}`).not.toBeNull();
    }
  });

  it('trips on nothing in the must-not-trip list', () => {
    for (const caption of cases.mustNotTrip) {
      expect(labellingMatch(caption), `must NOT trip: ${caption}`).toBeNull();
    }
  });

  it('names the live incident exactly', () => {
    expect(looksLikeLabelling('Black people just standing there.')).toBe(true);
    expect(labellingMatch('Black people just standing there.')).toBe('black people');
  });
});

describe('labellingMatch: the whole word list, not just the reported cases', () => {
  // Round 3's must-not-trip list was exactly the eight captions the round-3
  // review handed over, and none from the group round 3 ADDED, which is how a
  // guard that blocked "Old man yells at cloud" shipped green. So: every label
  // word and every gap modifier gets both directions, generated from the shipped
  // JSON so a new entry cannot arrive untested.

  it('every label word trips next to a people-noun', () => {
    for (const word of BLOCKED_TERMS.labelWords) {
      expect(labellingMatch(`Three ${word} people waiting for the bus.`), word).not.toBeNull();
    }
  });

  it('no label word trips when there is no person in the sentence', () => {
    for (const word of BLOCKED_TERMS.labelWords) {
      expect(labellingMatch(`A ${word} umbrella in the rain.`), word).toBeNull();
    }
  });

  it('every gap modifier carries a label word to a people-noun', () => {
    for (const mod of BLOCKED_TERMS.gapModifiers ?? []) {
      // not.toBeNull rather than an exact term: a few modifiers are also half
      // of a `phrases` entry ("old people"), which is checked first and wins.
      expect(labellingMatch(`Three black ${mod} people waiting.`), mod).not.toBeNull();
    }
  });

  it('two gap modifiers still carry it: the round-5 off-by-one', () => {
    for (const mod of BLOCKED_TERMS.gapModifiers ?? []) {
      expect(labellingMatch(`Three black young ${mod} people waiting.`), mod).not.toBeNull();
    }
  });

  it('an ordinary OBJECT in the gap ends the walk, for every label word', () => {
    // This is the round-5 replacement for the old nonPeopleCompounds coverage.
    // The allowlist could only ever assert the objects somebody thought of; the
    // closed modifier list makes the statement general: anything that is not a
    // modifier ends the walk.
    for (const word of BLOCKED_TERMS.labelWords) {
      for (const object of ['hat', 'umbrella', 'sneakers', 'gloves', 'cat', 'friday']) {
        expect(labellingMatch(`The ${word} ${object} guy again.`), `${word} ${object}`).toBeNull();
      }
    }
  });

  it('the gap modifier list stays short, and is not a back door for labels', () => {
    const mods = BLOCKED_TERMS.gapModifiers ?? [];
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.length).toBeLessThan(30);
    for (const mod of mods) {
      expect(BLOCKED_TERMS.labelWords, mod).not.toContain(mod);
      expect(BLOCKED_TERMS.peopleNouns, mod).not.toContain(mod);
    }
  });
});

describe('labellingMatch: the principle, stated as tests', () => {
  it('(b) survives up to two MODIFIER words between the label and the people-noun', () => {
    expect(labellingMatch('Black homeless people just standing there.')).toBe('black people');
    expect(labellingMatch('Asian looking guys at the buffet.')).toBe('asian guys');
    expect(labellingMatch('black young homeless people just standing there')).toBe('black people');
    expect(labellingMatch('white middle-aged men in a queue')).toBe('white men');
    // Three modifiers is past the gap. It is a guard, not a classifier.
    expect(labellingMatch('black young homeless american people')).toBeNull();
  });

  it('(b) a word that is not a modifier of a person ends the walk', () => {
    // The round-5 change: the gap accepts a closed list of modifiers, so an
    // object between the two halves is ordinary play with no allowlist needed.
    expect(labellingMatch('a black dog and the guy holding it')).toBeNull();
    expect(labellingMatch('The white hat guy is winning.')).toBeNull();
    expect(labellingMatch('Black umbrella lady owns this street.')).toBeNull();
    expect(labellingMatch('Nobody told the deaf cat lady.')).toBeNull();
    // A documented miss, asserted so it cannot be quietly "fixed" by widening
    // the modifier list: front and row are not modifiers of a person.
    expect(labellingMatch('wheelchair front row guy')).toBeNull();
  });

  it('(b) a colour PAIR does not start a walk, which is accepted in writing', () => {
    expect(labellingMatch('black and white family photo energy')).toBeNull();
    expect(labellingMatch('asian black and white men')).toBeNull();
    // The accepted cost of the pair rule, stated as a test so nobody discovers
    // it by surprise: see THE GAP in src/shared/caption-guard.ts.
    expect(labellingMatch('black and white people')).toBeNull();
    // ...but a colour word that is NOT the tail of a pair still walks.
    expect(labellingMatch('white people just standing there')).toBe('white people');
  });

  it('(c) standalone slurs and clinical labels trip with no people-noun at all', () => {
    expect(labellingMatch('That obese looking man again.')).toBe('obese');
    expect(labellingMatch('the crippled one is winning')).toBe('crippled');
    expect(labellingMatch('A group of people of color waiting for the bus.')).toBe(
      'people of color'
    );
  });

  it('(d) ordinary body and age adjectives are NOT blocked, on purpose', () => {
    // The residual risk is accepted in writing in the header of
    // src/shared/caption-guard.ts: the prompt is what stops these, not this file.
    expect(labellingMatch('Fat guy just standing there.')).toBeNull();
    expect(labellingMatch('Old woman just standing there.')).toBeNull();
    // Only the plural group-insult forms are explicit phrases.
    expect(labellingMatch('fat people at the buffet')).toBe('fat people');
    expect(labellingMatch('old people be like')).toBe('old people');
  });

  it('is empty-safe and takes a caller-supplied term list', () => {
    expect(looksLikeLabelling('')).toBe(false);
    const custom = { labelWords: [], peopleNouns: [], standaloneLabels: [], phrases: ['no dogs'] };
    expect(looksLikeLabelling('Black people just standing there.', custom)).toBe(false);
    expect(looksLikeLabelling('Sign says NO DOGS, dog cannot read.', custom)).toBe(true);
  });

  it('ships a term list that is short and only about labelling people', () => {
    expect(BLOCKED_TERMS.labelWords.length).toBeGreaterThan(0);
    expect(BLOCKED_TERMS.labelWords.length).toBeLessThan(40);
    expect(BLOCKED_TERMS.peopleNouns).toContain('people');
    expect(BLOCKED_TERMS.standaloneLabels).toContain('obese');
    // (d): these are NOT label words, and a later round must not quietly add them.
    for (const word of ['old', 'elderly', 'bald', 'fat', 'skinny', 'ugly']) {
      expect(BLOCKED_TERMS.labelWords, word).not.toContain(word);
      expect(BLOCKED_TERMS.standaloneLabels, word).not.toContain(word);
    }
  });
});

describe('looksLikeRefusal', () => {
  it('catches every refusal and prompt-echo in the shared table', () => {
    for (const text of cases.refusals) {
      expect(refusalMatch(text), `must be a refusal: ${text}`).not.toBeNull();
    }
  });

  it('lets real captions through', () => {
    for (const text of cases.notRefusals) {
      expect(refusalMatch(text), `must NOT be a refusal: ${text}`).toBeNull();
    }
  });

  it('catches the three refusals a live game actually shipped as captions', () => {
    expect(
      looksLikeRefusal("I'm a large language model, I'm not capable of generating original content")
    ).toBe(true);
    expect(
      looksLikeRefusal(
        'I cannot write a caption that makes a joke at the expense of a dog. Can I help you with something else?'
      )
    ).toBe(true);
    expect(
      looksLikeRefusal(
        "I'm happy to help with your request, but I must clarify that I'm a large language model"
      )
    ).toBe(true);
  });

  it('catches the prompt echo', () => {
    expect(looksLikeRefusal('The party game photo shows a man wearing a suit and tie')).toBe(true);
  });

  it('strips a leading "Caption:" instead of failing it', () => {
    expect(stripCaptionPrefix('Caption: the goat has seen things.')).toBe(
      'the goat has seen things.'
    );
    expect(stripCaptionPrefix('Caption - the goat has seen things.')).toBe(
      'the goat has seen things.'
    );
    expect(looksLikeRefusal('Caption: the goat has seen things.')).toBe(false);
    // Nothing to strip: left exactly as it was.
    expect(stripCaptionPrefix('The goat has seen things.')).toBe('The goat has seen things.');
  });

  it('does not fire on "I can\'t believe", which is a caption, not a refusal', () => {
    expect(looksLikeRefusal("I can't believe he wore that to a wedding.")).toBe(false);
    expect(looksLikeRefusal("I can't even with this dog today.")).toBe(false);
    // ...but the same words followed by a task verb, at the start, are a refusal.
    expect(looksLikeRefusal("I can't write a caption for this.")).toBe(true);
  });
});
