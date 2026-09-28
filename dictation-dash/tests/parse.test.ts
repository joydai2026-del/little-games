import { describe, expect, it } from 'vitest';
import { hanRuns, isHeading, isWritableChar, parseWordList } from '../src/shared/parse';
import { GAME } from '../src/shared/config';

const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const RLO = String.fromCharCode(0x202e);

describe('parseWordList (messy paste, skip-and-report)', () => {
  it('keeps each run of Chinese characters as one word, in order, once', () => {
    const paste = '1. 朋友 péngyou friend\n2) 学校，xuéxiào (school)\n3.\t老师 lǎoshī\n4. 朋友 again!\n5. 🍎苹果🍎';
    const r = parseWordList(paste);
    expect(r.words).toEqual(['朋友', '学校', '老师', '苹果']);
    expect(r.repeats).toBe(1);
  });
  it('skips lesson headings by SHAPE and reports them; never deletes by keyword', () => {
    // The live receipt's paste: "第三课 听写" on the first line.
    const r = parseWordList('第三课 听写\n1. 朋友\n2. 学校');
    expect(r.skipped).toEqual(['第三课']);
    expect(r.words).toEqual(['听写', '朋友', '学校']); // 听写 is also a real word: kept, and the teacher sees the list
    expect(parseWordList('第二单元\n大山').skipped).toEqual(['第二单元']);
    expect(parseWordList('生字：\n朋友 学校').skipped).toEqual(['生字']);
    // A numbered line is a list ITEM, never a heading.
    expect(parseWordList('1. 第五课\n2. 大山').words).toEqual(['第五课', '大山']);
    expect(isHeading('第十课')).toBe(true);
    expect(isHeading('练习')).toBe(false);
  });
  it('strips zero-width and bidi characters, so a word copied from a web page stays one word', () => {
    const r = parseWordList(`朋${ZWSP}友 ${BOM}学${RLO}校`);
    expect(r.words).toEqual(['朋友', '学校']);
  });
  it('splits on Chinese punctuation and spaces, drops iteration marks', () => {
    expect(hanRuns('天天、上学。 你好々')).toEqual(['天天', '上学', '你好']);
    expect(isWritableChar('々')).toBe(false);
  });
  it('reports runs longer than the box row instead of cutting them', () => {
    const r = parseWordList('中华人民共和国 大家好');
    expect(r.tooLong).toEqual(['中华人民共和国']);
    expect(r.words).toEqual(['大家好']);
  });
  it('caps the list and reports the rest', () => {
    const many = Array.from({ length: GAME.maxListWords + 2 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join(' ');
    const r = parseWordList(many);
    expect(r.words).toHaveLength(GAME.maxListWords);
    expect(r.overflow).toHaveLength(2);
  });
  it('an empty or non-Chinese paste gives no words', () => {
    expect(parseWordList('hello 123').words).toEqual([]);
    expect(parseWordList(undefined as never).words).toEqual([]);
  });
});
