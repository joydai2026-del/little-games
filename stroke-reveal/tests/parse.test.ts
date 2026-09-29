// The messy-paste parser (copied from tianzige-generator): skip-and-report
// headings by shape, never delete by keyword; words become cards.
import { describe, expect, it } from 'vitest';
import { drawnChar, isHeading, parseWords } from '../src/shared/parse';
import { GAME } from '../src/shared/config';
import { PASTES } from './fixtures/pastes';

describe('parseWords on real messy pastes', () => {
  for (const c of PASTES) {
    it(c.name, () => {
      expect(parseWords(c.paste).words).toEqual(c.words);
    });
  }
});

describe('parseWords edges', () => {
  it('returns nothing for pinyin and English only', () => {
    expect(parseWords('nǐ hǎo, hello 123').words).toEqual([]);
  });

  it('keeps words whole and draws their first character', () => {
    expect(parseWords('1. 妈妈 māma mom\n2. 学校 xuéxiào').words).toEqual(['妈妈', '学校']);
    expect(drawnChar('学校')).toBe('学');
    expect(drawnChar('𠮷野')).toBe('𠮷');
  });

  it('counts whole-word repeats and cuts past the cap, listing the overflow', () => {
    const out = parseWords('大 小 大 山', { maxWords: 2, maxInput: 100, maxWordLen: 4, headingLineMax: 8 });
    expect(out.words).toEqual(['大', '小']);
    expect(out.repeats).toBe(1);
    expect(out.overflow).toEqual(['山']);
  });

  it('ignores input past the paste limit and says how much was cut', () => {
    const out = parseWords('a'.repeat(GAME.maxPasteLength) + '大小');
    expect(out.words).toEqual([]);
    expect(out.inputCut).toBe(2);
  });

  it('never drops by keyword: 练习 日期 姓名 are vocabulary', () => {
    const out = parseWords('学校 练习 日期 姓名');
    expect(out.words).toEqual(['学校', '练习', '日期', '姓名']);
    expect(out.skipped).toEqual([]);
  });

  it('skips a lesson marker and a colon label over more Chinese lines, and reports both', () => {
    const out = parseWords('第三课\n我的家人：\n爸爸 妈妈');
    expect(out.words).toEqual(['爸爸', '妈妈']);
    expect(out.skipped).toEqual(['第三课', '我的家人']);
    expect(isHeading('第二单元')).toBe(true);
    expect(isHeading('生字')).toBe(false);
  });

  it('a long unbroken run becomes single characters', () => {
    expect(parseWords('一二三四五').words).toEqual(['一', '二', '三', '四', '五']);
  });
});
