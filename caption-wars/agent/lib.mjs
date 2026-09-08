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

/**
 * Truncates to at most `max` characters at a WORD boundary.
 *
 * Twin of trimToWordBoundary in src/shared/text.ts, which the worker's model
 * path has used since round 4 after a live run produced "...claiming ownership
 * of a t", cut dead at the 120-character cap. This is a model path too: the
 * terminal agent's brain writes the caption and the agent caps it, so the severed
 * word is our doing here in exactly the same way. Prefers the last sentence end,
 * then the last space, and only slices mid-word if the text has neither.
 */
export function capLength(text, max) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const window = s.slice(0, max);

  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  if (sentenceEnd >= max * 0.4) return window.slice(0, sentenceEnd + 1).trim();

  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace > 0) return window.slice(0, lastSpace).trim();
  return window.trim();
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
// landing on a people-noun over at most two words, every one of which must be on
// the closed gapModifiers list), standalone slurs trip anywhere, and body/age adjectives
// are deliberately NOT blocked because they are the median caption vocabulary
// for a photo of a person. HUMANS ARE NOT FILTERED: this only sees model output.

export const BLOCKED_TERMS = JSON.parse(
  fs.readFileSync(new URL('../src/shared/blocked-terms.json', import.meta.url), 'utf8')
);

/** Must stay identical to MAX_GAP_WORDS in src/shared/caption-guard.ts (the reason is written there). */
const MAX_GAP_WORDS = 2;

function normalizeTerm(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when this label word is the tail of a colour pair ("black AND white"). */
function isPairTail(words, i, labels, conjunctions) {
  return i >= 2 && conjunctions.has(words[i - 1]) && labels.has(words[i - 2]);
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

  // The modifier walk. Round 5 replaced the object allowlist + neutralizer with
  // a CLOSED list of modifiers: any word in the gap that is not a modifier ends
  // the walk. The reasoning, and the accepted consequences, are written in the
  // header of src/shared/caption-guard.ts under THE GAP.
  const words = flat.split(' ');
  const labels = new Set((terms.labelWords ?? []).map(normalizeTerm));
  const peopleNouns = new Set((terms.peopleNouns ?? []).map(normalizeTerm));
  const modifiers = new Set((terms.gapModifiers ?? []).map(normalizeTerm));
  const conjunctions = new Set((terms.pairConjunctions ?? []).map(normalizeTerm));

  for (let i = 0; i < words.length; i++) {
    if (!labels.has(words[i])) continue;
    if (isPairTail(words, i, labels, conjunctions)) continue;
    for (let j = i + 1; j <= i + MAX_GAP_WORDS + 1 && j < words.length; j++) {
      if (peopleNouns.has(words[j])) return `${words[i]} ${words[j]}`;
      if (!modifiers.has(words[j])) break;
    }
  }

  return null;
}

/** True when the caption reads as a label on the people in the photo. */
export function looksLikeLabelling(text, terms = BLOCKED_TERMS) {
  return labellingMatch(text, terms) !== null;
}

// The refusal / meta detector. Twin of the same section in
// src/shared/caption-guard.ts, including the marker lists and the round-5
// matching rules (word boundaries everywhere, META markers anchored to the start
// of the answer, "shows up" is not "shows"). Live runs on 2026-09-07 shipped
// "I'm a large language model...", "I cannot write a caption that makes a joke at
// the expense of a dog." and "The party game photo shows a man wearing a suit and
// tie..." to players AS CAPTIONS; round 5's probes then showed the round-4
// substring matching failing ordinary captions like "Dressed as an airline pilot
// for no reason." Both halves have to stay true, in both implementations.

const SELF_REFERENCE_RE =
  /\b(?:i'm|i am|as an?|being an?)\s+(?:a\s+)?(?:large\s+|small\s+|text[\s-]based\s+)?(?:language model|ai|artificial intelligence)\b/;

const REFUSAL_MARKERS = [
  "i'm not designed",
  'i am not designed',
  'against my guidelines',
  'not appropriate or acceptable',
  'i must clarify',
  "i'm happy to help",
  'i am happy to help',
  "i don't have the capability",
  'i do not have the capability',
  "i'm not capable",
  'i am not capable',
];

const APOLOGY_RE = /\bi apologi[sz]e,?\s+(?:but|however|i)\b/;

// The "I cannot ..." family, matched only at the START and only with a task
// verb after it: "I can't believe he wore that to a wedding." is a caption, not
// a refusal. Must stay identical to REFUSAL_OPENER_RE in caption-guard.ts.
const REFUSAL_OPENER_RE =
  /^(?:(?:i'm\s+|i\s+am\s+)?(?:sorry|afraid)[,.!\s]+|unfortunately[,.!\s]+){0,2}(?:but\s+)?i(?:'m|\s+am)?\s*(?:cannot|can\s?not|can't|won't|will\s+not|not\s+able|unable|do\s+not|don't)\s+(?:to\s+|really\s+|actually\s+)*(?:write|generate|create|provide|produce|make|do|fulfil|fulfill|comply|assist|caption|continue|complete|answer|respond|help\s+(?:you|with))\b/;

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
];

/** Twin of markerRe in src/shared/caption-guard.ts. */
function markerRe(marker, anchored) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const lead = anchored ? '^' : '\\b';
  const tail = /\b(?:shows|depicts)$/.test(marker) ? '\\b(?!\\s+up\\b)' : '\\b';
  return new RegExp(`${lead}${escaped}${tail}`);
}

const REFUSAL_RES = REFUSAL_MARKERS.map((m) => markerRe(m, false));
const META_RES = META_MARKERS.map((m) => markerRe(m, true));

const CAPTION_PREFIX_RE = /^\s*(?:the\s+)?caption(?:\s+is)?\s*[:\-–—]\s*/i;

/** Removes a leading "Caption:" label. Stripped, never failed. */
export function stripCaptionPrefix(text) {
  return String(text ?? '').replace(CAPTION_PREFIX_RE, '').trim();
}

/** The marker that makes this a refusal or a description rather than a caption, or null. */
export function refusalMatch(text) {
  const flat = stripCaptionPrefix(String(text ?? ''))
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length === 0) return null;
  if (SELF_REFERENCE_RE.test(flat)) return 'model talking about itself';
  if (APOLOGY_RE.test(flat)) return 'i apologize, but';
  for (let i = 0; i < REFUSAL_MARKERS.length; i++) {
    if (REFUSAL_RES[i].test(flat)) return REFUSAL_MARKERS[i];
  }
  for (let i = 0; i < META_MARKERS.length; i++) {
    if (META_RES[i].test(flat)) return META_MARKERS[i];
  }
  const opener = flat.match(REFUSAL_OPENER_RE);
  if (opener) return opener[0];
  return null;
}

/** True when the model refused, talked about itself, or described the photo back. */
export function looksLikeRefusal(text) {
  return refusalMatch(text) !== null;
}
