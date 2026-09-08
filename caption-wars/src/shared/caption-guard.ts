// The guard on what the AI PLAYERS write, and the detector for a model that
// answered with a refusal instead of a caption.
//
// ============================================================================
// THE PRINCIPLE (settled in review round 4, 2026-09-07). This is the written
// standard. A later round may tune the word lists in blocked-terms.json; it may
// NOT flip these four rules without changing this comment and the plan's rule
// 30/34 together, because three rounds of "too loose" / "too tight" flip-flop is
// what this paragraph exists to stop.
//
// (a) THE GUARD IS A BACKSTOP. The prompt is the primary defence. Every bot
//     caption prompt carries one short, calm content rule. This file is the
//     cheap check on the answer, not a classifier, and it is allowed to miss
//     clever phrasings. What it must never do is fire on ordinary play: a
//     blocked bot caption is a silent bot, and two silent bots in a solo game
//     void the round.
//
// (b) IT BLOCKS GROUP LABELLING. One shape: a race / ethnicity / religion /
//     nationality word landing on a word that means "a human being", with up to
//     two words in between ("black homeless people", "black young men", "asian
//     looking guys", "african american people"). The two-word gap is what makes
//     it survive an inserted adjective, which is exactly how round 3's version
//     was defeated. The gap is also why `nonPeopleCompounds` exists: without an
//     explicit allowlist, "Black Friday crowd control" and "the white wine guy"
//     would trip. Words that begin a gap and are pure grammar (`and`, `the`,
//     `of`, ...) break the match, because they mean the two halves belong to
//     different phrases.
//
// (c) STANDALONE SLURS AND CLINICAL LABELS TRIP ANYWHERE, no people-noun
//     needed: `obese`, `crippled`, `retarded`, `midget`, `dwarf`, and the
//     phrases `people of color` / `people of colour`. They are never ordinary
//     caption vocabulary. Accepted cost, in writing: "dwarf planet" and "dwarf
//     hamster" are false positives. They are rare enough on party photos to be
//     worth the certainty, and the cost of a false positive is one bot sitting
//     out one round.
//
// (d) ORDINARY BODY AND AGE ADJECTIVES ARE NOT BLOCKED: `old`, `elderly`,
//     `bald`, `fat`, `skinny`, `ugly`. "Old man yells at cloud" is a stock meme
//     and the median caption for a photo of an older person; the PHOTO_TAGS
//     ship `party`, `baby`, `costume`, so those photos are full of exactly
//     those people. Round 3 put these words in the matcher and blocked `old
//     man`, `bald guy`, `skinny guy`, `old lady`, `old couple`, `ugly kids`.
//     ACCEPTED RESIDUAL RISK, in writing: a bot caption of the form "Fat guy
//     just standing there." now passes this file and is stopped by the prompt
//     alone. That is the deliberate trade: a guard that silences the bots on
//     normal photos is worse than nothing (rule a). The only explicit
//     exceptions are the plural group-insult forms, which read as a verdict on
//     a group rather than a description of the person in the frame: `fat
//     people`, `fat guys`, `ugly people`, `ugly guys`, `old people`.
//
// HUMANS ARE NOT FILTERED, ever. This only sees model output.
// ============================================================================
//
// Why any of it exists: in a live game on 2026-09-07 a Workers AI bot looked at
// a photo of a group of people and captioned it "Black people just standing
// there." A caption that trips this guard is regenerated once with a lighter
// prompt, then tried once on the fallback vision model, and only then does the
// bot sit the round out (src/worker/bots.ts). The terminal agent does the same
// (agent/play.mjs), reading this same JSON through agent/lib.mjs.

import blocked from './blocked-terms.json';

export interface BlockedTerms {
  /** Race / ethnicity / religion / nationality words. Only trip next to a people-noun. */
  labelWords: string[];
  /** Words meaning "a human being", which is what turns a label word into a label. */
  peopleNouns: string[];
  /** Slurs and clinical labels that trip on their own, anywhere. */
  standaloneLabels: string[];
  /** Whole phrases that are othering or a group insult however they are placed. */
  phrases: string[];
  /**
   * Compounds where a label word belongs to an OBJECT, not a person
   * ("black cat", "white wine", "korean bbq"). Neutralized before the gap
   * matcher runs, so they can never reach a people-noun. Optional so a
   * caller-supplied term list (the tests do this) need not carry it.
   */
  nonPeopleCompounds?: string[];
  /** Pure grammar words that break a gap: they mean the two halves are different phrases. */
  gapStopWords?: string[];
}

export const BLOCKED_TERMS: BlockedTerms = blocked as BlockedTerms;

/**
 * How many words may sit between a label word and a people-noun. 2, so an
 * inserted adjective ("black HOMELESS people", "asian LOOKING guys", "african
 * AMERICAN people") does not defeat the whole guard. Round 3 used 1 and every
 * one of those sailed through.
 */
const MAX_GAP = 2;

/** A word that no list contains, left where an allowlisted compound was. */
const ALLOWLISTED = 'allowlisted';

/** Lower-cased, punctuation flattened to spaces, so matching never depends on typography. */
function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Replaces every "the label word belongs to an object" compound with a neutral
 * word, so the gap matcher below cannot walk from it to a people-noun. Longest
 * compounds first, so "black and white" is taken before "black" can be reached
 * by anything shorter.
 */
function neutralizeCompounds(flat: string, compounds: string[]): string {
  let padded = ` ${flat} `;
  const ordered = [...compounds]
    .map((c) => normalize(c))
    .filter((c) => c.length > 0)
    .sort((a, b) => b.split(' ').length - a.split(' ').length);
  for (const compound of ordered) {
    const needle = ` ${compound} `;
    while (padded.includes(needle)) padded = padded.replace(needle, ` ${ALLOWLISTED} `);
  }
  return padded.trim();
}

/**
 * The term that made this caption look like a label on the people in the photo,
 * or null when nothing did. Returned rather than a bare boolean so the reason
 * can be logged and named back to the model on the retry.
 */
export function labellingMatch(text: string, terms: BlockedTerms = BLOCKED_TERMS): string | null {
  const flat = normalize(text);
  if (flat.length === 0) return null;

  // Principle (c): phrases and standalone labels trip on the caption as written,
  // before any allowlist gets a say.
  for (const phrase of terms.phrases ?? []) {
    const needle = normalize(phrase);
    if (needle && ` ${flat} `.includes(` ${needle} `)) return phrase;
  }

  const standalone = new Set((terms.standaloneLabels ?? []).map((t) => normalize(t)));
  for (const word of flat.split(' ')) {
    if (standalone.has(word)) return word;
  }

  // Principle (b): the gap matcher, on text with the object compounds taken out.
  const words = neutralizeCompounds(flat, terms.nonPeopleCompounds ?? []).split(' ');
  const labels = new Set((terms.labelWords ?? []).map((t) => normalize(t)));
  const peopleNouns = new Set((terms.peopleNouns ?? []).map((t) => normalize(t)));
  const stops = new Set((terms.gapStopWords ?? []).map((t) => normalize(t)));

  for (let i = 0; i < words.length; i++) {
    if (!labels.has(words[i])) continue;
    for (let j = i + 1; j <= i + MAX_GAP && j < words.length; j++) {
      if (peopleNouns.has(words[j])) return `${words[i]} ${words[j]}`;
      // A grammar word between the two halves means they belong to different
      // phrases ("a black dog AND the guy"), so stop walking.
      if (stops.has(words[j])) break;
    }
  }

  return null;
}

/** True when the caption reads as a label on the people in the photo. */
export function looksLikeLabelling(text: string, terms: BlockedTerms = BLOCKED_TERMS): boolean {
  return labellingMatch(text, terms) !== null;
}

// --- refusals and other non-captions ----------------------------------------
//
// Live runs on 2026-09-07 put THESE strings in front of players as captions:
//   "I'm a large language model, I'm not capable of generating original content or ca..."
//   "I cannot write a caption that makes a joke at the expense of a dog. Can I help you with something else?"
//   "I'm happy to help with your request, but I must clarify that I'm a large language model, I don't have the capability to..."
//   "The party game photo shows a man wearing a suit and tie..."
// The first three are refusals (the round-3 content rule was long and stern
// enough to read as a request the model should decline); the last is the model
// describing the photo back instead of joking about it. Both are worthless as
// captions, and both are invisible to the labelling guard above, so they get
// their own detector and the same treatment: retry, then the fallback model,
// then the bot sits the round out.

/**
 * Markers of a model talking about itself, matched ANYWHERE in the answer.
 * Every one of these is a sentence about the assistant, which a caption never is.
 */
const REFUSAL_MARKERS = [
  'language model',
  'text-based ai',
  "i'm not designed",
  'i am not designed',
  'against my guidelines',
  'not appropriate or acceptable',
  'appropriate content',
  'acceptable content',
  'for a general audience',
  'as an ai',
  'as an artificial intelligence',
  "i'm an ai",
  'i am an ai',
  'i must clarify',
  "i'm happy to help",
  'i am happy to help',
  'i apologize',
  'i apologise',
  'can i help you with',
  "i don't have the capability",
  'i do not have the capability',
  "i'm not capable",
  'i am not capable',
];

/**
 * The "I cannot ..." family, which is NOT safe as a bare substring: "I can't
 * believe he wore that to a wedding." is a perfectly good caption and one of
 * the most natural openings in English. So it is matched only at the START of
 * the answer (where a refusal lives) AND only when a task verb follows, which
 * is what separates "I cannot write a caption" from "I can't even".
 */
const REFUSAL_OPENER_RE =
  /^(?:(?:i'm\s+|i\s+am\s+)?sorry[,.!\s]+|unfortunately[,.!\s]+)?i(?:'m|\s+am)?\s*(?:cannot|can\s?not|can't|won't|will\s+not|not\s+able|unable|do\s+not|don't)\s+(?:to\s+|really\s+|actually\s+)*(?:write|generate|create|provide|produce|make|do|perform|fulfil|fulfill|comply|help|assist|caption|continue|complete|answer|respond)\b/;

/** Markers of a model DESCRIBING the photo (or narrating the task) instead of captioning it. */
const META_MARKERS = [
  'the party game photo shows',
  'this image shows',
  'the image shows',
  'this photo shows',
  'the photo shows',
  'the picture shows',
  'this picture shows',
  'the image depicts',
  'the photo depicts',
  'in this image',
  'in this photo',
  "here's a caption",
  'here is a caption',
  'here are some captions',
  'sure, here',
];

/**
 * A leading label a model likes to put in front of the answer. Stripped, never
 * failed: "Caption: Day four of the standoff." is a perfectly good caption with
 * a label glued to the front.
 */
const CAPTION_PREFIX_RE = /^\s*(?:the\s+)?caption(?:\s+is)?\s*[:\-–—]\s*/i;

/** Removes a leading "Caption:" / "Caption -" label. Returns the text otherwise unchanged. */
export function stripCaptionPrefix(text: string): string {
  return String(text ?? '').replace(CAPTION_PREFIX_RE, '').trim();
}

/**
 * The marker that makes this answer a refusal or a description rather than a
 * caption, or null when it reads like a caption. Apostrophes are normalized so a
 * curly `’` matches, and a leading "Caption:" is stripped first, since that is
 * cosmetic rather than a refusal.
 */
export function refusalMatch(text: string): string | null {
  const flat = stripCaptionPrefix(String(text ?? ''))
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length === 0) return null;

  for (const marker of REFUSAL_MARKERS) {
    if (flat.includes(marker)) return marker;
  }
  for (const marker of META_MARKERS) {
    if (flat.includes(marker)) return marker;
  }
  const opener = flat.match(REFUSAL_OPENER_RE);
  if (opener) return opener[0];
  return null;
}

/** True when the model refused, talked about itself, or described the photo back. */
export function looksLikeRefusal(text: string): boolean {
  return refusalMatch(text) !== null;
}
