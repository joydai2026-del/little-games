// Turns a teacher's messy paste into the words to dictate.
//
// Teachers paste this week's 听写 list from wherever it lives: a numbered doc,
// a slide, a spreadsheet column, a vocab table with pinyin and English.
//
//  1. Zero-width and bidi control characters are removed first, so 朋<U+200B>友
//     is the word 朋友 (copy-paste from web pages carries them).
//  2. Headings are skipped by SHAPE only, never by keyword (Tianzige's rule,
//     tianzige-generator/src/shared/parse.ts): a lesson marker 第N课 / 第N单元
//     alone on a line or leading it, and a short line ending in a colon with
//     more Chinese lines under it ("生字："). A numbered line ("1. 第五课") is a
//     list item, never a heading. Everything skipped is REPORTED, never silent.
//  3. A word is a run of Chinese characters (Unicode Script=Han) with nothing
//     else between them. Everything else splits words and is dropped. Each word
//     is kept once, in first-seen order. A run longer than GAME.maxWordChars is
//     reported, not cut.

import { GAME } from './config';

export interface ParsedWords {
  /** Words to dictate, in order, no repeats, capped at `maxWords`. */
  words: string[];
  /** Runs longer than GAME.maxWordChars, left out and reported. */
  tooLong: string[];
  /** Headings left out by shape, in order, reported to the teacher. */
  skipped: string[];
  /** How many repeated words were dropped. */
  repeats: number;
  /** Words past the cap that were left out, in order. */
  overflow: string[];
}

const HAN = /\p{Script=Han}/u;
// Han-script symbols that are not writable characters (iteration marks).
const NOT_WRITABLE = new Set(['々', '〆', '〻']);
// Zero-width spaces and joiners, bidi marks and embeddings, word joiner, BOM.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

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

/** A list marker at the start of a line: 1. 2、 3) (4) （一） • · - * (Tianzige's shape). */
const LIST_MARKER = /^\s*(?:[（(]\s*(?:[一二三四五六七八九十]+|\d+)\s*[)）]|\d+\s*[、．.)）]|[•·●○◦▪■*\-–—])\s*/u;
const LESSON = '第[一二三四五六七八九十百零〇两兩0-9]+(?:课|課|单元|單元)';
const LESSON_ALONE = new RegExp(`^${LESSON}$`, 'u');
const LESSON_LEAD = new RegExp(`^(${LESSON})(?![\\p{Script=Han}])`, 'u');

/** True when the text is a pure heading shape: a lesson marker and nothing else Chinese. */
export function isHeading(text: string): boolean {
  const runs = text.match(/\p{Script=Han}+/gu) ?? [];
  return runs.length === 1 && LESSON_ALONE.test(runs[0]);
}

function stripHeadings(text: string): { text: string; skipped: string[] } {
  const skipped: string[] = [];
  const lines = text.split(/\r?\n/).map((raw) => {
    const marker = raw.match(LIST_MARKER);
    return { line: (marker ? raw.slice(marker[0].length) : raw).trim(), item: Boolean(marker) };
  });
  const out = lines.map(({ line, item }, i) => {
    const han = (line.match(/\p{Script=Han}+/gu) ?? []).join(' ');
    if (!han) return line;
    const next = lines.slice(i + 1).find((l) => l.line !== '');
    const hanCount = (line.match(/\p{Script=Han}/gu) ?? []).length;
    if (/[:：]$/.test(line) && hanCount <= GAME.headingLineMax && next && HAN.test(next.line)) {
      skipped.push(han);
      return '';
    }
    if (item) return line;
    if (isHeading(line)) {
      skipped.push(han);
      return '';
    }
    const lead = line.match(LESSON_LEAD);
    if (lead) {
      skipped.push(lead[1]);
      return line.slice(lead[0].length);
    }
    return line;
  });
  return { text: out.join('\n'), skipped };
}

export function parseWordList(text: string, maxWords: number = GAME.maxListWords): ParsedWords {
  const input = String(text ?? '').slice(0, GAME.maxPasteLength).replace(INVISIBLE, '');
  const { text: body, skipped } = stripHeadings(input);
  const seen = new Set<string>();
  const words: string[] = [];
  const tooLong: string[] = [];
  const overflow: string[] = [];
  let repeats = 0;
  for (const run of hanRuns(body)) {
    if (seen.has(run)) {
      repeats += 1;
      continue;
    }
    seen.add(run);
    if ([...run].length > GAME.maxWordChars) tooLong.push(run);
    else if (words.length < maxWords) words.push(run);
    else overflow.push(run);
  }
  return { words, tooLong, skipped, repeats, overflow };
}
