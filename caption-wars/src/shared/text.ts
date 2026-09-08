// Text that came from a human or a model, made safe to store and to render.
//
// "Safe" here means SHAPE only: one line, trimmed, length-capped, no control
// characters. It deliberately does NOT escape or strip HTML. A caption of
// `<img src=x onerror=alert(1)>` stays exactly that string, because the client
// renders every name and caption with textContent / text nodes (plan amendment
// 10, enforced by `npm run check:xss`). Escaping here would only mean players
// see `&lt;img ...` on screen, and it would hide the real rule: never build
// markup out of player text.

import { CAPTION_MAX_CHARS, NAME_MAX_CHARS } from './config';

/**
 * Collapses anything that would break a single-line layout into a plain space:
 * C0/C1 control characters and the Unicode line separators. Written as a loop
 * rather than a regex literal so no raw control bytes end up in this source
 * file.
 */
function toOneLine(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    out += isControl ? ' ' : ch;
  }
  return out;
}

/**
 * A display name: one line, trimmed, at most NAME_MAX_CHARS. Internal runs of
 * whitespace are collapsed so a wall of spaces cannot blow out a player list.
 * Returns '' when nothing usable is left; the caller rejects that.
 */
export function sanitizeName(raw: string): string {
  return toOneLine(raw).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_CHARS);
}

/**
 * A caption: one line, trimmed, whitespace runs collapsed to a single space,
 * at most CAPTION_MAX_CHARS. Truncation is the ONLY thing that changes the
 * visible characters, so an injection-shaped caption survives as literal text.
 *
 * ROUND 6 (Claude nit 1): the cut is at a WORD boundary here too. The browser
 * sets `maxlength` so a phone cannot reach the cap, but the terminal agent and
 * the raw API can, and round 4 already decided that a caption severed mid-word
 * ("...claiming ownership of a t") reads as a bug on somebody's screen. It was
 * fixed on the model path and not on this one; the cut is our doing in exactly
 * the same way. This function is still the single place the cap is ENFORCED,
 * which is why src/shared/room.ts no longer re-checks the length afterwards.
 */
export function sanitizeCaption(raw: string): string {
  return trimToWordBoundary(toOneLine(raw).replace(/\s+/g, ' ').trim(), CAPTION_MAX_CHARS);
}

const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
};

/**
 * Extra cleanup for text a language model wrote: models like to wrap a caption
 * in quotes or open with "Sure! Here's a caption:". Humans keep their quotes,
 * so this runs only on the bot path.
 */
export function cleanModelCaption(raw: string): string {
  let text = toOneLine(raw).replace(/\s+/g, ' ').trim();

  // Drop a leading "Caption:" / "Here's a caption:" style preamble.
  //
  // ROUND 6 widened the tail from 20 to 40 characters. The round-6 live game
  // shipped this to a player, verbatim, because the tail after "caption" was 22
  // characters and the old pattern allowed 20:
  //   This is the caption I wrote for the photo: "The moment you don't want to
  //   discuss in the break room."
  // The payload after the colon was a perfectly good caption, which is exactly
  // why this is a STRIP and not a refusal (rule 39). Both halves stay bounded so
  // this can only ever eat a short preamble, never a sentence.
  text = text.replace(/^[^:]{0,40}\bcaption\b[^:]{0,40}:\s*/i, '');

  // Peel matching wrapping quotes (straight or curly), at most twice.
  for (let i = 0; i < 2; i++) {
    const first = text[0];
    const last = text[text.length - 1];
    if (text.length >= 2 && first !== undefined && QUOTE_PAIRS[first] === last) {
      text = text.slice(1, -1).trim();
    } else {
      break;
    }
  }

  return sanitizeCaption(trimToWordBoundary(text, CAPTION_MAX_CHARS));
}

/**
 * Cuts an over-long model answer at a WORD boundary rather than mid-word.
 *
 * A live tuning run on 2026-09-07 produced "...with the winner claiming
 * ownership of a t" at exactly the 120-character cap. A human writing 121
 * characters is their own business, so the plain `sanitizeCaption` slice stays
 * as it is; this runs only on the model path, where the cut is our doing and a
 * severed word reads as a bug on somebody's phone. Prefers the last sentence
 * end, then the last space, and only slices mid-word if the text has neither.
 */
export function trimToWordBoundary(raw: string, max: number): string {
  const text = raw.trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max);

  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  // Only honour a sentence break that leaves a caption worth reading: past 40%
  // of the window, a whole first sentence beats a longer trailing fragment.
  if (sentenceEnd >= max * 0.4) return window.slice(0, sentenceEnd + 1).trim();

  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace > 0) return window.slice(0, lastSpace).trim();
  return window.trim();
}
