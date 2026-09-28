// Turns a messy teacher paste into an ordered list of words, each word a list
// of Chinese characters.
//
// Steps, in order:
//  1. NFKC-normalize. Text copied out of a PDF often carries look-alike code
//     points (Kangxi radicals like ⼈ U+2F08, CJK compatibility ideographs);
//     NFKC maps them to the standard character (人), which has stroke data.
//  2. Drop headings (see isHeading): a short line ending in a colon, a label before a
//     colon that is a heading, and a line made only of heading words
//     (第三课, 生字, 词语, 课文, 练习, 姓名, 日期 ...).
//  3. A Chinese character is anything in the Han script, minus iteration marks
//     (々). Everything else (numbering, punctuation, pinyin with or without
//     tone marks, English glosses, emoji, spaces) is a separator.
//  4. A run of Han characters no longer than LIMITS.maxWordLen stays together
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
}

const HAN_RUN = /\p{Script=Han}+/gu;
/** Han-script marks that are not characters to write: iteration marks. */
const NOT_CHARACTERS = /[々〻]/gu;
const COLON = /[:：]/;
/** Most Chinese characters a colon-ended line can have and still count as a heading. */
const HEADING_LINE_MAX = 8;

/** Common heading words on a teacher's list. Policy: add a word here, nothing else changes. */
const HEADING_WORDS = '生字|生词|生詞|词语|詞語|课文|課文|练习|練習|姓名|日期|听写|聽寫|写字|寫字';
const HEADING_PREFIXES = '本周|本週|本课|本課|今天|今日';
const LESSON = '第[一二三四五六七八九十百零〇两兩0-9]+(?:课|課|单元|單元|周|週|章|节|節|回)';
/** 第三课, 生字, 第三课生字, 本周生字, 第二单元词语 ... (a whole run, nothing else). */
const HEADING_RUN = new RegExp(`^(?=.)(?:${LESSON})?(?:(?:${HEADING_PREFIXES})?(?:${HEADING_WORDS}))?$`, 'u');

function isHeadingRun(run: string): boolean {
  return HEADING_RUN.test(run);
}

/** True when every Chinese run in the text is a heading word (and there is at least one). */
export function isHeading(text: string): boolean {
  const runs = text.match(/\p{Script=Han}+/gu) ?? [];
  return runs.length > 0 && runs.every(isHeadingRun);
}

function stripHeadings(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      // A heading-sized line ending in a colon ("我的家人：", "Unit 3 词语:") is a label.
      // A long line that happens to end in a colon is still content.
      if (/[:：]$/.test(trimmed) && (trimmed.match(/\p{Script=Han}/gu) ?? []).length <= HEADING_LINE_MAX) return '';
      let rest = trimmed;
      const colon = rest.search(COLON);
      if (colon >= 0 && isHeading(rest.slice(0, colon))) rest = rest.slice(colon + 1);
      // Any later "label：" that is a heading word goes too (姓名：___ 日期：___).
      rest = rest.replace(/(\p{Script=Han}+)(\s*[:：])/gu, (m, run: string) => (isHeadingRun(run) ? ' ' : m));
      return isHeading(rest) ? '' : rest;
    })
    .join('\n');
}

export function parseChars(input: string, limits = LIMITS): ParseResult {
  const all = Array.from(String(input ?? '').normalize('NFKC'));
  const inputCut = Math.max(0, all.length - limits.maxInput);
  const text = stripHeadings(all.slice(0, limits.maxInput).join('')).replace(NOT_CHARACTERS, ' ');
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

  return { words, chars: words.flatMap((w) => w.chars), truncated, inputCut };
}
