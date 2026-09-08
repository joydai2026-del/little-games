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
  s = stripSurroundingQuotes(s);
  s = toOneLine(s); // stripping quotes can reveal new leading/trailing junk
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

// --- bot content guard -------------------------------------------------------
//
// The mjs twin of src/shared/caption-guard.ts, for the terminal agent (which has
// no build step and cannot import TypeScript). Both read the SAME
// src/shared/blocked-terms.json, so the term list cannot drift; only the ~20
// lines of matching below are written twice, and tests/agent-lib.test.mjs and
// tests/caption-guard.test.ts assert the same live example against both.
//
// Why: a live game on 2026-09-07 produced the bot caption "Black people just
// standing there." A caption that trips this is regenerated once with a
// stricter instruction; if it trips again the agent skips the round.
// HUMANS ARE NOT FILTERED: this only ever sees model output.

export const BLOCKED_TERMS = JSON.parse(
  fs.readFileSync(new URL('../src/shared/blocked-terms.json', import.meta.url), 'utf8')
);

/** How far after a descriptor a people-noun still counts ("black young men"). */
const MAX_GAP = 2;

function normalizeTerm(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The term that made this read as a label on the people in the photo, or null. */
export function labellingMatch(text, terms = BLOCKED_TERMS) {
  const flat = normalizeTerm(text);
  if (flat.length === 0) return null;

  for (const phrase of terms.phrases) {
    const needle = normalizeTerm(phrase);
    if (needle && ` ${flat} `.includes(` ${needle} `)) return phrase;
  }

  const words = flat.split(' ');
  const standalone = new Set(terms.standaloneLabels.map(normalizeTerm));
  for (const word of words) {
    if (standalone.has(word)) return word;
  }

  const descriptors = new Set(terms.descriptors.map(normalizeTerm));
  const peopleNouns = new Set(terms.peopleNouns.map(normalizeTerm));
  for (let i = 0; i < words.length; i++) {
    if (!descriptors.has(words[i])) continue;
    for (let j = i + 1; j <= i + MAX_GAP && j < words.length; j++) {
      if (peopleNouns.has(words[j])) return `${words[i]} ${words[j]}`;
    }
  }

  return null;
}

/** True when the caption reads as a label on the people in the photo. */
export function looksLikeLabelling(text, terms = BLOCKED_TERMS) {
  return labellingMatch(text, terms) !== null;
}
