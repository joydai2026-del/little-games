// Turns a messy teacher paste into an ordered list of words, each word a list
// of Chinese characters.
//
// Steps, in order:
//  1. NFKC-normalize. Text copied out of a PDF often carries look-alike code
//     points (Kangxi radicals like ⼈ U+2F08, CJK compatibility ideographs);
//     NFKC maps them to the standard character (人), which has stroke data.
//  2. Strip list markers at line start (1. 一、 （一） • and an enclosed number ㈠ ㊀ before
//     content). A line that had one is a list item: never classified as a heading.
//  3. Skip headings by SHAPE only, never by keyword (练习, 日期, 姓名 are also
//     ordinary vocabulary): a lesson marker 第N课 / 第N单元 (alone on a line, or
//     leading a line), and a line ending in a colon that has more Chinese lines
//     after it. Everything skipped is reported in `skipped`, never silent.
//  4. A Chinese character is anything in the Han script, minus iteration marks
//     (々). Everything else (numbering, punctuation, pinyin with or without
//     tone marks, English glosses, emoji, spaces) is a separator.
//  5. A run of Han characters no longer than LIMITS.maxWordLen stays together
//     as one word (one grid per character, kept together on the page). A longer
//     run, like "一二三四五六", is a list of single characters.
//
// Duplicates, ONE rule: a whole word that already appeared is dropped (first
// one wins). Characters inside DIFFERENT words are kept, so 学校 and 学生 give
// 学 twice and 大 then 大人 give 大 twice (in either order). A character
// repeated inside one word (妈妈) gets one grid.

import { LIMITS } from './config';

export interface ParsedWord {
  text: string;
  chars: string[];
}

export interface ParseResult {
  words: ParsedWord[];
  /** Every character on the sheet, in order, one entry per grid. */
  chars: string[];
  /** True when the paste had more characters than LIMITS.maxChars and we cut the rest. */
  truncated: boolean;
  /** How many characters of the paste were past LIMITS.maxInput and never read. */
  inputCut: number;
  /** Headings we did not turn into practice grids, in order. Always shown to the teacher. */
  skipped: string[];
}

const HAN_RUN = /\p{Script=Han}+/gu;
/** Han-script marks that are not characters to write: iteration marks. */
const NOT_CHARACTERS = /[々〻]/gu;
/** An enclosed NUMBER (㈠-㈩ U+3220-3229, ㊀-㊉ U+3280-3289) at the start of a line, before
 *  content, is list numbering. It becomes a bullet before NFKC (which would turn it into
 *  "(一)" or "一"). Anywhere else, and for other enclosed ideographs (㊊ ㊥ ㊤), the text
 *  simply normalizes: 我爱㊀ -> 我爱一, ㊊ -> 月. */
const ENCLOSED_NUMBER_AT_START = /^(\s*)[\u3220-\u3229\u3280-\u3289](?=\s*\S)/gmu;
const BULLET = '\u2022';
/** A list marker at the start of a line that is never a character: 1. 2、 3) (4) （一） (二) • · - * */
const LIST_MARKER = /^\s*(?:[（(]\s*(?:[一二三四五六七八九十]+|\d+)\s*[)）]|\d+\s*[、．.)）]|[•·●○◦▪■*\-–—])\s*/u;
/** 一、 二. 十一． : a marker ONLY when the rest of the line has Chinese and no further 、.
 *  Otherwise the numeral is vocabulary: 一、二、三 is a list of the characters 一 二 三,
 *  and a line holding only 一、 is the character 一. */
const NUMERAL_MARKER = /^\s*[一二三四五六七八九十]+\s*[、．.]\s*/u;

function listMarker(line: string): RegExpMatchArray | null {
  const plain = line.match(LIST_MARKER);
  if (plain) return plain;
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

function stripHeadings(text: string, limits = LIMITS): { text: string; skipped: string[] } {
  const skipped: string[] = [];
  // A line that carried a list marker is a list ITEM: vocabulary, never a heading
  // ("1. 第五课" is the fifth-lesson word, not a heading).
  const lines = text.split(/\r?\n/).map((raw) => {
    const marker = listMarker(raw);
    return { line: (marker ? raw.slice(marker[0].length) : raw).trim(), item: Boolean(marker) };
  });
  const out = lines.map(({ line, item }, i) => {
    const han = (line.match(/\p{Script=Han}+/gu) ?? []).join(' ');
    if (!han || item) return line;
    // "我的家人：" is a label for the list under it: a short line ending in a colon whose
    // NEXT non-blank line has Chinese. A glossary (学校：\nschool) and a sentence are not.
    const next = lines.slice(i + 1).find((l) => l.line !== '');
    const hanCount = (line.match(/\p{Script=Han}/gu) ?? []).length;
    if (/[:：]$/.test(line) && hanCount <= limits.headingLineMax && next && HAN.test(next.line)) {
      skipped.push(han);
      return '';
    }
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

export function parseChars(input: string, limits = LIMITS): ParseResult {
  const all = Array.from(String(input ?? '').replace(ENCLOSED_NUMBER_AT_START, `$1${BULLET} `).normalize('NFKC'));
  const inputCut = Math.max(0, all.length - limits.maxInput);
  const stripped = stripHeadings(all.slice(0, limits.maxInput).join(''), limits);
  const text = stripped.text.replace(NOT_CHARACTERS, ' ');
  const words: ParsedWord[] = [];
  const seenWords = new Set<string>();
  let count = 0;
  let truncated = false;

  const addWord = (chars: string[]) => {
    if (truncated) return;
    const unique = chars.filter((c, i) => chars.indexOf(c) === i);
    const key = chars.join('');
    if (seenWords.has(key)) return;
    if (count + unique.length > limits.maxChars) {
      truncated = true;
      return;
    }
    seenWords.add(key);
    words.push({ text: key, chars: unique });
    count += unique.length;
  };

  for (const match of text.matchAll(HAN_RUN)) {
    const run = Array.from(match[0]);
    if (run.length <= limits.maxWordLen) addWord(run);
    else for (const c of run) addWord([c]);
  }

  return { words, chars: words.flatMap((w) => w.chars), truncated, inputCut, skipped: stripped.skipped };
}
