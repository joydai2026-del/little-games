// Turns a teacher's messy paste into the characters to trace.
//
// Teachers paste from wherever the list lives: a numbered doc, a slide, a
// spreadsheet column, a vocab table with pinyin and English. The rule is
// deliberately simple: keep every Chinese character (Unicode Script=Han), in
// the order it first appears, once. Everything else (numbers, pinyin with tone
// marks, English, commas, Chinese punctuation, emoji) is ignored. A word like
// 妈妈 becomes one 妈; 学校 becomes 学 then 校.

import { GAME } from './config';

export interface ParsedList {
  /** Characters to trace, in order, no repeats, capped at GAME.maxListChars. */
  chars: string[];
  /** How many repeated characters were dropped. */
  repeats: number;
  /** Characters past the cap that were left out, in order. */
  overflow: string[];
}

const HAN = /\p{Script=Han}/u;
// Han-script symbols that are not writable characters (iteration mark 々, 〇 is kept: it is a real character).
const NOT_TRACEABLE = new Set(['々', '〆', '〻']);

export function isTraceableChar(ch: string): boolean {
  return [...ch].length === 1 && HAN.test(ch) && !NOT_TRACEABLE.has(ch);
}

export function parseCharList(text: string, maxChars: number = GAME.maxListChars): ParsedList {
  const input = String(text ?? '').slice(0, GAME.maxPasteLength);
  const seen = new Set<string>();
  const chars: string[] = [];
  const overflow: string[] = [];
  let repeats = 0;
  for (const ch of input) {
    if (!isTraceableChar(ch)) continue;
    if (seen.has(ch)) {
      repeats += 1;
      continue;
    }
    seen.add(ch);
    if (chars.length < maxChars) chars.push(ch);
    else overflow.push(ch);
  }
  return { chars, repeats, overflow };
}
