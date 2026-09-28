// Turns a messy teacher paste into the word cards for Stroke Reveal.
//
// Copied from tianzige-generator/src/shared/parse.ts (one game per folder: copy,
// never import across folders). Steps, in order:
//  1. NFKC-normalize (PDF look-alike code points become the standard character).
//  2. Strip list markers at line start (1. 一、 （一） • ㈠). A line that had one is
//     a list item: never classified as a heading.
//  3. Skip headings by SHAPE only, never by keyword (练习, 日期, 姓名 are also
//     ordinary vocabulary): a lesson marker 第N课 / 第N单元, and a line ending in a
//     colon that has more Chinese lines after it. Everything skipped is reported
//     in `skipped`, never silent.
//  4. A Chinese character is anything in the Han script, minus iteration marks.
//     Everything else (numbering, punctuation, pinyin, English, emoji) separates.
//  5. A run of Han characters no longer than GAME.maxWordLen is one word card. A
//     longer run, like "一二三四五六", is a list of single characters.
//
// Duplicates: a whole word that already appeared is dropped (first one wins) and
// counted in `repeats`. Words past GAME.maxListWords are cut and listed in `overflow`.
// Momo draws the FIRST character of each word; the card shows the whole word.

import { GAME } from './config';

export interface ParseResult {
  /** Word cards, in order, no repeats. */
  words: string[];
  /** Whole words dropped because they already appeared. */
  repeats: number;
  /** Words past GAME.maxListWords, in order. */
  overflow: string[];
  /** How many characters of the paste were past GAME.maxPasteLength and never read. */
  inputCut: number;
  /** Headings we did not turn into cards, in order. Always shown to the teacher. */
  skipped: string[];
}

export interface ParseLimits {
  maxWords: number;
  maxInput: number;
  maxWordLen: number;
  headingLineMax: number;
}

const LIMITS: ParseLimits = { maxWords: GAME.maxListWords, maxInput: GAME.maxPasteLength, maxWordLen: GAME.maxWordLen, headingLineMax: GAME.headingLineMax };

const HAN_RUN = /\p{Script=Han}+/gu;
/** Han-script marks that are not characters to write: iteration marks. */
const NOT_CHARACTERS = /[々〻]/gu;
/** An enclosed NUMBER (㈠-㈩ U+3220-3229, ㊀-㊉ U+3280-3289) at the start of a line, before
 *  content, is list numbering. It becomes a bullet before NFKC (which would turn it into
 *  "(一)" or "一"). Anywhere else, and for other enclosed ideographs (㊊ ㊥ ㊤), the text
 *  simply normalizes: 我爱㊀ -> 我爱一, ㊊ -> 月. */
// [^\S\r\n] = a space that is not a line break, so "\u3280\n\u3281" is two characters, not a marker.
const ENCLOSED_NUMBER_AT_START = /^([^\S\r\n]*)[\u3220-\u3229\u3280-\u3289](?=[^\S\r\n]*[^\s])/gmu;
const BULLET = '\u2022';
/** A list marker at the start of a line that is never a character: 1. 2、 3) (4) （一） (二) • · - * */
const LIST_MARKER = /^\s*(?:[（(]\s*(?:[一二三四五六七八九十]+|\d+)\s*[)）]|\d+\s*[、．.)）]|[•·●○◦▪■*\-–—])\s*/u;
/** 一、 二. 十一． : a marker ONLY when the rest of the line has Chinese and no further 、.
 *  Otherwise the numeral is vocabulary: 一、二、三 is a list of the characters 一 二 三,
 *  and a line holding only 一、 is the character 一. */
const NUMERAL_MARKER = /^\s*[一二三四五六七八九十]+\s*[、．.]\s*/u;

function listMarker(line: string): RegExpMatchArray | null {
  const plain = line.match(LIST_MARKER);
  // A bracketed Chinese numeral with nothing after it on the line ("(一)", which is also
  // what NFKC makes of ㈠) is the character itself, not a marker.
  if (plain) return HAN.test(plain[0]) && line.slice(plain[0].length).trim() === '' ? null : plain;
  const numeral = line.match(NUMERAL_MARKER);
  if (!numeral) return null;
  const rest = line.slice(numeral[0].length);
  return HAN.test(rest) && !rest.includes('、') ? numeral : null;
}

const LESSON = '第[一二三四五六七八九十百零〇两兩0-9]+(?:课|課|单元|單元)';
/** 第三课 / 第二单元, alone or leading a line (a shape, not a word list). */
const LESSON_ALONE = new RegExp(`^${LESSON}$`, 'u');
const LESSON_LEAD = new RegExp(`^(${LESSON})(?![\\p{Script=Han}])`, 'u');
const HAN = /\p{Script=Han}/u;

/** True when the text is a pure heading shape: a lesson marker and nothing else Chinese. */
export function isHeading(text: string): boolean {
  const runs = text.match(/\p{Script=Han}+/gu) ?? [];
  return runs.length === 1 && LESSON_ALONE.test(runs[0]);
}

function stripHeadings(text: string, limits: { headingLineMax: number }): { text: string; skipped: string[] } {
  const skipped: string[] = [];
  // A line that carried a list marker is a list ITEM: vocabulary, never a heading
  // ("1. 第五课" is the fifth-lesson word, not a heading).
  const lines = text.split(/\r?\n/).map((raw) => {
    const marker = listMarker(raw);
    return { line: (marker ? raw.slice(marker[0].length) : raw).trim(), item: Boolean(marker) };
  });
  const out = lines.map(({ line, item }, i) => {
    const han = (line.match(/\p{Script=Han}+/gu) ?? []).join(' ');
    if (!han) return line;
    // "我的家人：" is a label for the list under it: a short line ending in a colon whose
    // NEXT non-blank line has Chinese. A glossary (学校：\nschool) and a sentence are not.
    const next = lines.slice(i + 1).find((l) => l.line !== '');
    const hanCount = (line.match(/\p{Script=Han}/gu) ?? []).length;
    if (/[:：]$/.test(line) && hanCount <= limits.headingLineMax && next && HAN.test(next.line)) {
      skipped.push(han);
      return '';
    }
    // A list item is vocabulary for every rule below ("1. 第五课" is a word), but a
    // list item ending in a colon over more Chinese ("一、生字：") is still a label (above).
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

export function parseWords(input: string, limits: ParseLimits = LIMITS): ParseResult {
  const all = Array.from(String(input ?? '').replace(ENCLOSED_NUMBER_AT_START, `$1${BULLET} `).normalize('NFKC'));
  const inputCut = Math.max(0, all.length - limits.maxInput);
  const stripped = stripHeadings(all.slice(0, limits.maxInput).join(''), limits);
  const text = stripped.text.replace(NOT_CHARACTERS, ' ');
  const words: string[] = [];
  const overflow: string[] = [];
  const seen = new Set<string>();
  let repeats = 0;

  const addWord = (chars: string[]) => {
    const key = chars.join('');
    if (seen.has(key)) {
      repeats += 1;
      return;
    }
    seen.add(key);
    if (words.length < limits.maxWords) words.push(key);
    else overflow.push(key);
  };

  for (const match of text.matchAll(HAN_RUN)) {
    const run = Array.from(match[0]);
    if (run.length <= limits.maxWordLen) addWord(run);
    else for (const c of run) addWord([c]);
  }

  return { words, repeats, overflow, inputCut, skipped: stripped.skipped };
}

/** The character Momo draws for a word card: its first character. */
export function drawnChar(word: string): string {
  return Array.from(word)[0] ?? '';
}
