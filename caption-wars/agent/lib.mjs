// Small pure helpers used by agent/play.mjs. No I/O, no dependencies, so they
// are easy to unit test in isolation (see tests/agent-lib.test.mjs).

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
