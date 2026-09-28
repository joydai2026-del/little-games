// Messy-paste fixtures, typed by hand the way teachers actually paste lists.
import { describe, expect, it } from 'vitest';
import { parseCharList } from '../src/shared/parse';

describe('parseCharList', () => {
  it('numbered list with pinyin and English', () => {
    const r = parseCharList('1. 人 rén - person\n2. 口 kǒu - mouth\n3. 大 dà big\n4. 小 xiǎo small');
    expect(r.chars).toEqual(['人', '口', '大', '小']);
    expect(r.repeats).toBe(0);
  });

  it('mixed Chinese and English commas and the list comma', () => {
    expect(parseCharList('山，水, 火、木 ,土').chars).toEqual(['山', '水', '火', '木', '土']);
  });

  it('spreadsheet columns (tabs) with doubled words', () => {
    const r = parseCharList('妈妈\tmāma\tmom\n爸爸\tbàba\tdad\n学校\txuéxiào\tschool');
    expect(r.chars).toEqual(['妈', '爸', '学', '校']);
    expect(r.repeats).toBe(2);
  });

  it('traditional characters, corner quotes, full-width punctuation and emoji', () => {
    expect(parseCharList('今天的字：「龍」、「學」！🐉 Good job!').chars).toEqual(['今', '天', '的', '字', '龍', '學']);
  });

  it('slide bullets with parentheses and a formula line', () => {
    const r = parseCharList('• 日 (rì) sun\n• 月 (yuè) moon\n• 明 = 日 + 月');
    expect(r.chars).toEqual(['日', '月', '明']);
    expect(r.repeats).toBe(2);
  });

  it('no Chinese at all gives an empty list, not an error', () => {
    expect(parseCharList('Week 3 review: no characters yet 123').chars).toEqual([]);
    expect(parseCharList('').chars).toEqual([]);
  });

  it('ignores the iteration mark, keeps order, and caps the list', () => {
    expect(parseCharList('人々 你好').chars).toEqual(['人', '你', '好']);
    const many = Array.from({ length: 70 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join(' ');
    const r = parseCharList(many, 60);
    expect(r.chars).toHaveLength(60);
    expect(r.overflow).toHaveLength(10);
  });
});
