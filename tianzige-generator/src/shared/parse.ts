// Turns a messy teacher paste into an ordered list of words, each word a list
// of Chinese characters.
//
// The rule is deliberately simple: a Chinese character is anything in the Han
// script. Everything else (numbering, punctuation, pinyin with or without tone
// marks, English glosses, emoji, spaces) is a separator. So:
//   "1. 学校 xuéxiào school"  ->  [学校]
//   "大、小、多"               ->  [大] [小] [多]
// A run of Han characters no longer than LIMITS.maxWordLen stays together as
// one word (it gets one grid per character, drawn together). A longer run,
// like "一二三四五六", is a list of single characters that nobody separated.
//
// Duplicates: a word that already appeared is dropped (first one wins), and a
// character repeated inside one word (妈妈) gets one grid, not two.

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
}

const HAN_RUN = /\p{Script=Han}+/gu;

export function parseChars(input: string, limits = LIMITS): ParseResult {
  const text = String(input ?? '').slice(0, limits.maxInput);
  const words: ParsedWord[] = [];
  const seenWords = new Set<string>();
  let count = 0;
  let truncated = false;

  const addWord = (chars: string[]) => {
    if (truncated) return;
    const unique = chars.filter((c, i) => chars.indexOf(c) === i);
    const key = chars.join('');
    if (seenWords.has(key)) return;
    // A single character that already has a grid inside an earlier word is a
    // duplicate too (a list of 大人 then 大 does not need a second 大).
    if (unique.length === 1 && words.some((w) => w.chars.includes(unique[0]))) return;
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

  return { words, chars: words.flatMap((w) => w.chars), truncated };
}
