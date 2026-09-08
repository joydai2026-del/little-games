// A narrow guard on what the AI PLAYERS write.
//
// Why it exists: in a live game on 2026-09-07 a Workers AI bot looked at a
// photo of a group of people and captioned it "Black people just standing
// there." That is not a joke about the situation, it is a label on the people
// in the frame, and it is the one failure mode of an image model let loose on
// photos of strangers in a party game.
//
// Two independent defences, both in this repo:
//   1. Every bot caption prompt now says, in as many words, to joke about the
//      SITUATION and never about anyone's race, ethnicity, skin colour, body,
//      gender, religion, age or disability (src/worker/bots.ts, agent/play.mjs).
//   2. This file: a cheap output check. A caption that trips it is regenerated
//      ONCE with a stricter instruction; if the second attempt trips too, the
//      bot skips the round (its job is recorded `failed` with the reason
//      logged). A skipped bot is already a first-class outcome everywhere else,
//      so nothing else has to change.
//
// Scope, deliberately: HUMANS ARE NOT FILTERED. Their captions are their own
// and the plan does not moderate players. This only ever sees model output.
//
// It is a guard, not a classifier. It aims at the obvious shape "<descriptor> +
// <word for people>", plus a handful of standing phrases. It will miss cleverer
// phrasings (the prompt is the primary defence) and it must not fire on ordinary
// captions, which is why the descriptor lists are short, are only about
// labelling PEOPLE, and live in blocked-terms.json where they can be tuned
// without touching code.
//
// Two shapes the third review round corrected, both proven by running the guard:
//   - It was tripping on ordinary captions ("Black Friday crowd control", "the
//     black cat lady", "a black tie couple", "the white wine guy", "korean bbq
//     family reunion"), which on a solo game with two bots voided the round.
//     Fixed two ways: colour words moved out of `descriptors` into explicit
//     two-word phrases, and the gap below narrowed to the adjacent word.
//   - It covered only race and ethnicity while the prompt promised body, age and
//     disability too, so "Fat guy just standing there." sailed through the exact
//     shape of the incident that created the guard. Hence
//     `bodyAgeDisabilityDescriptors`.

import blocked from './blocked-terms.json';

export interface BlockedTerms {
  /** Words that label a person's race, ethnicity or religion. Only tripped next to a people-noun. */
  descriptors: string[];
  /**
   * Words that label a person's body, age or disability. Same rule as
   * `descriptors`, kept as its own group so the list stays readable and either
   * category can be tuned on its own. Optional: a caller-supplied term list
   * (the tests do this) need not carry it.
   */
  bodyAgeDisabilityDescriptors?: string[];
  /** Words meaning "a human being", which is what turns a descriptor into a label. */
  peopleNouns: string[];
  /** Descriptors used as a noun on their own ("a group of asians"). */
  standaloneLabels: string[];
  /** Whole phrases that are othering however they are placed. */
  phrases: string[];
}

export const BLOCKED_TERMS: BlockedTerms = blocked as BlockedTerms;

/**
 * How far after a descriptor a people-noun still counts. 1 = the very next word.
 *
 * It used to be 2, which read "korean bbq family reunion" and "the chinese food
 * guy knows my order" as labels on people. A descriptor two words from a person
 * word is usually describing the thing in between, so the wider gap bought one
 * extra catch ("asian young men") at the price of ordinary captions being
 * blocked, and a blocked bot caption can void a round.
 */
const MAX_GAP = 1;

/** Lower-cased, punctuation flattened to spaces, so matching never depends on typography. */
function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The term that made this caption look like a label on the people in the photo,
 * or null when nothing did. Returned rather than a bare boolean so the reason
 * can be logged when a bot skips a round.
 */
export function labellingMatch(text: string, terms: BlockedTerms = BLOCKED_TERMS): string | null {
  const flat = normalize(text);
  if (flat.length === 0) return null;

  for (const phrase of terms.phrases) {
    const needle = normalize(phrase);
    if (needle && ` ${flat} `.includes(` ${needle} `)) return phrase;
  }

  const words = flat.split(' ');
  const standalone = new Set(terms.standaloneLabels.map((t) => normalize(t)));
  for (const word of words) {
    if (standalone.has(word)) return word;
  }

  const descriptors = new Set(
    [...terms.descriptors, ...(terms.bodyAgeDisabilityDescriptors ?? [])].map((t) => normalize(t))
  );
  const peopleNouns = new Set(terms.peopleNouns.map((t) => normalize(t)));
  for (let i = 0; i < words.length; i++) {
    if (!descriptors.has(words[i])) continue;
    for (let j = i + 1; j <= i + MAX_GAP && j < words.length; j++) {
      if (peopleNouns.has(words[j])) return `${words[i]} ${words[j]}`;
    }
  }

  return null;
}

/** True when the caption reads as a label on the people in the photo. */
export function looksLikeLabelling(text: string, terms: BlockedTerms = BLOCKED_TERMS): boolean {
  return labellingMatch(text, terms) !== null;
}
