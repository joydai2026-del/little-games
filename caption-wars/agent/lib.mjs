// Small pure helpers used by agent/play.mjs. No npm dependencies and no
// network, so they are easy to unit test in isolation (see
// tests/agent-lib.test.mjs). The one read from disk is the shared blocked-terms
// list at the bottom of this file, loaded once at import time.

import fs from 'node:fs';

/**
 * Strips one layer of surrounding quote marks (straight or curly) a model
 * sometimes wraps its answer in, e.g. `"Nice goat."` -> `Nice goat.`.
 */
export function stripSurroundingQuotes(text) {
  let s = String(text ?? '').trim();
  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'], // “ ”
    ['‘', '’'], // ‘ ’
    ['`', '`'],
  ];
  for (const [open, close] of pairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  return s;
}

/** Collapses any multi-line answer into a single line with normalized whitespace. */
export function toOneLine(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncates to at most `max` characters (no ellipsis, just a hard cap; trims trailing whitespace). */
export function capLength(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max).trim();
}

/**
 * Turns raw model output into a caption safe to submit: one line, no
 * surrounding quotes, capped length. Never throws; a non-string or empty
 * input sanitizes to ''.
 */
export function sanitizeCaption(raw, max = 120) {
  if (typeof raw !== 'string') return '';
  let s = toOneLine(raw);
  // A leading "Caption:" label is cosmetic: strip it rather than shipping it,
  // and rather than letting the refusal detector fail an otherwise good answer.
  // Same move as cleanModelCaption in src/shared/text.ts.
  s = stripCaptionPrefix(s);
  s = stripSurroundingQuotes(s);
  s = toOneLine(s); // stripping quotes can reveal new leading/trailing junk
  s = stripCaptionPrefix(s); // a quoted "Caption: ..." reveals the label after unwrapping
  s = capLength(s, max);
  return s;
}

/**
 * Pulls a 1-based pick out of free-form model text, tolerant of answers like
 * "3", "Number 3", "#3", or "I pick 3 because it's funnier". Deliberately
 * digit-only (no spelled-out "three"): words like "one" are common enough as
 * plain English ("that one made me laugh") that matching them as a number
 * produces false positives, which is worse than just returning null and
 * skipping the vote.
 * Returns an integer in [1, count], or null if nothing usable was found.
 */
export function parsePickedNumber(raw, count) {
  if (typeof raw !== 'string' || !Number.isInteger(count) || count <= 0) return null;
  const text = raw.toLowerCase();

  const patterns = [
    /(?:number|caption|choice|option|pick|vote(?:\s*for)?)\s*#?\s*(\d+)/i,
    /#\s*(\d+)/,
    /\b(\d+)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isInteger(n) && n >= 1 && n <= count) return n;
    }
  }

  return null;
}

// --- bot content guard + refusal detector -----------------------------------
//
// The mjs twin of src/shared/caption-guard.ts, for the terminal agent (which has
// no build step and cannot import TypeScript). Both read the SAME
// src/shared/blocked-terms.json, so the term lists cannot drift; only the
// matching below is written twice, and tests/agent-lib.test.mjs and
// tests/caption-guard.test.ts assert the SAME cases against both.
//
// THE PRINCIPLE lives in the header of src/shared/caption-guard.ts and is the
// written standard for both copies. In one line: the guard is a backstop, it
// blocks group labelling (a race / ethnicity / religion / nationality word
// landing on a people-noun within two words, minus an allowlist of object
// compounds), standalone slurs trip anywhere, and ordinary body/age adjectives
// are deliberately NOT blocked because they are the median caption vocabulary
// for a photo of a person. HUMANS ARE NOT FILTERED: this only sees model output.

export const BLOCKED_TERMS = JSON.parse(
  fs.readFileSync(new URL('../src/shared/blocked-terms.json', import.meta.url), 'utf8')
);

/** Must stay identical to MAX_GAP in src/shared/caption-guard.ts (the reason is written there). */
const MAX_GAP = 2;

/** A word that no list contains, left where an allowlisted compound was. */
const ALLOWLISTED = 'allowlisted';

function normalizeTerm(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Replaces "the label word belongs to an object" compounds with a neutral word. */
function neutralizeCompounds(flat, compounds) {
  let padded = ` ${flat} `;
  const ordered = [...compounds]
    .map(normalizeTerm)
    .filter((c) => c.length > 0)
    .sort((a, b) => b.split(' ').length - a.split(' ').length);
  for (const compound of ordered) {
    const needle = ` ${compound} `;
    while (padded.includes(needle)) padded = padded.replace(needle, ` ${ALLOWLISTED} `);
  }
  return padded.trim();
}

/** The term that made this read as a label on the people in the photo, or null. */
export function labellingMatch(text, terms = BLOCKED_TERMS) {
  const flat = normalizeTerm(text);
  if (flat.length === 0) return null;

  for (const phrase of terms.phrases ?? []) {
    const needle = normalizeTerm(phrase);
    if (needle && ` ${flat} `.includes(` ${needle} `)) return phrase;
  }

  const standalone = new Set((terms.standaloneLabels ?? []).map(normalizeTerm));
  for (const word of flat.split(' ')) {
    if (standalone.has(word)) return word;
  }

  const words = neutralizeCompounds(flat, terms.nonPeopleCompounds ?? []).split(' ');
  const labels = new Set((terms.labelWords ?? []).map(normalizeTerm));
  const peopleNouns = new Set((terms.peopleNouns ?? []).map(normalizeTerm));
  const stops = new Set((terms.gapStopWords ?? []).map(normalizeTerm));

  for (let i = 0; i < words.length; i++) {
    if (!labels.has(words[i])) continue;
    for (let j = i + 1; j <= i + MAX_GAP && j < words.length; j++) {
      if (peopleNouns.has(words[j])) return `${words[i]} ${words[j]}`;
      if (stops.has(words[j])) break;
    }
  }

  return null;
}

/** True when the caption reads as a label on the people in the photo. */
export function looksLikeLabelling(text, terms = BLOCKED_TERMS) {
  return labellingMatch(text, terms) !== null;
}

// The refusal / meta detector. Twin of the same section in
// src/shared/caption-guard.ts, including the marker lists: live runs on
// 2026-09-07 shipped "I'm a large language model...", "I cannot write a caption
// that makes a joke at the expense of a dog." and "The party game photo shows a
// man wearing a suit and tie..." to players AS CAPTIONS.

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

// The "I cannot ..." family, matched only at the START and only with a task
// verb after it: "I can't believe he wore that to a wedding." is a caption, not
// a refusal. Must stay identical to REFUSAL_OPENER_RE in caption-guard.ts.
const REFUSAL_OPENER_RE =
  /^(?:(?:i'm\s+|i\s+am\s+)?sorry[,.!\s]+|unfortunately[,.!\s]+)?i(?:'m|\s+am)?\s*(?:cannot|can\s?not|can't|won't|will\s+not|not\s+able|unable|do\s+not|don't)\s+(?:to\s+|really\s+|actually\s+)*(?:write|generate|create|provide|produce|make|do|perform|fulfil|fulfill|comply|help|assist|caption|continue|complete|answer|respond)\b/;

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

const CAPTION_PREFIX_RE = /^\s*(?:the\s+)?caption(?:\s+is)?\s*[:\-\u2013\u2014]\s*/i;

/** Removes a leading "Caption:" label. Stripped, never failed. */
export function stripCaptionPrefix(text) {
  return String(text ?? '').replace(CAPTION_PREFIX_RE, '').trim();
}

/** The marker that makes this a refusal or a description rather than a caption, or null. */
export function refusalMatch(text) {
  const flat = stripCaptionPrefix(String(text ?? ''))
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
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
export function looksLikeRefusal(text) {
  return refusalMatch(text) !== null;
}
