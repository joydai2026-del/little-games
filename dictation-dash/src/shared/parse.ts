// Turns a teacher's messy paste into the words to dictate.
//
// Teachers paste this week's 听写 list from wherever it lives: a numbered doc,
// a slide, a spreadsheet column, a vocab table with pinyin and English. The
// rule is deliberately simple: a WORD is a run of Chinese characters (Unicode
// Script=Han) with nothing else between them. Everything else (numbers, pinyin
// with tone marks, English, commas, Chinese punctuation, spaces, emoji) splits
// words and is dropped. Each word is kept once, in the order it first appears.
// Nothing is guessed: a run longer than GAME.maxWordChars is reported, not cut.

import { GAME } from './config';

export interface ParsedWords {
  /** Words to dictate, in order, no repeats, capped at `maxWords`. */
  words: string[];
  /** Runs longer than GAME.maxWordChars, left out and reported. */
  tooLong: string[];
  /** How many repeated words were dropped. */
  repeats: number;
  /** Words past the cap that were left out, in order. */
  overflow: string[];
}

const HAN = /\p{Script=Han}/u;
// Han-script symbols that are not writable characters (iteration marks).
const NOT_WRITABLE = new Set(['々', '〆', '〻']);

export function isWritableChar(ch: string): boolean {
  return [...ch].length === 1 && HAN.test(ch) && !NOT_WRITABLE.has(ch);
}

/** Every run of writable characters, in order, repeats included. */
export function hanRuns(text: string): string[] {
  const runs: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (isWritableChar(ch)) cur += ch;
    else if (cur) {
      runs.push(cur);
      cur = '';
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

export function parseWordList(text: string, maxWords: number = GAME.maxListWords): ParsedWords {
  const input = String(text ?? '').slice(0, GAME.maxPasteLength);
  const seen = new Set<string>();
  const words: string[] = [];
  const tooLong: string[] = [];
  const overflow: string[] = [];
  let repeats = 0;
  for (const run of hanRuns(input)) {
    if (seen.has(run)) {
      repeats += 1;
      continue;
    }
    seen.add(run);
    if ([...run].length > GAME.maxWordChars) tooLong.push(run);
    else if (words.length < maxWords) words.push(run);
    else overflow.push(run);
  }
  return { words, tooLong, repeats, overflow };
}
