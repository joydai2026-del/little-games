import { describe, expect, it } from 'vitest';
import { hanRuns, isWritableChar, parseWordList } from '../src/shared/parse';
import { GAME } from '../src/shared/config';

describe('parseWordList (messy paste, skip-and-report)', () => {
  it('keeps each run of Chinese characters as one word, in order, once', () => {
    const paste = '第一课\n1. 朋友 péngyou friend\n2) 学校，xuéxiào (school)\n3.\t老师 lǎoshī\n4. 朋友 again!\n5. 🍎苹果🍎';
    const r = parseWordList(paste);
    expect(r.words).toEqual(['第一课', '朋友', '学校', '老师', '苹果']);
    expect(r.repeats).toBe(1);
    expect(r.tooLong).toEqual([]);
  });
  it('splits on Chinese punctuation and spaces, drops iteration marks', () => {
    expect(hanRuns('天天、上学。 你好々')).toEqual(['天天', '上学', '你好']);
    expect(isWritableChar('々')).toBe(false);
    expect(isWritableChar('a')).toBe(false);
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
