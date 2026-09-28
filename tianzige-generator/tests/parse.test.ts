import { describe, expect, it } from 'vitest';
import { isHeading, parseChars } from '../src/shared/parse';
import { LIMITS } from '../src/shared/config';
import { PASTES } from './fixtures/pastes';

describe('parseChars on real messy pastes', () => {
  for (const c of PASTES) {
    it(c.name, () => {
      const out = parseChars(c.paste);
      expect(out.words.map((w) => w.text)).toEqual(c.words);
      expect(out.chars.join('')).toBe(c.chars);
      expect(out.truncated).toBe(false);
    });
  }
});

describe('parseChars edges', () => {
  it('returns nothing for pinyin and English only', () => {
    expect(parseChars('nǐ hǎo, hello 123').chars).toEqual([]);
  });

  it('keeps a word together and gives each distinct character one grid', () => {
    const out = parseChars('妈妈');
    expect(out.words).toEqual([{ text: '妈妈', chars: ['妈'] }]);
  });

  it('caps the sheet at LIMITS.maxChars and says so', () => {
    const many = '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感见明问力理尔点文几定本公特做外孩相西果走将月十实向声车全信重三机工物气每并别真打太新比才便夫再书部水像眼等体却加电主界门利海受听表德少克代员许稜先口由死安写性马光白或住难望教命花结乐色';
    const out = parseChars(many);
    expect(out.chars.length).toBe(LIMITS.maxChars);
    expect(out.truncated).toBe(true);
  });

  it('ignores input past LIMITS.maxInput and says how much was cut', () => {
    const out = parseChars('a'.repeat(LIMITS.maxInput) + '大小');
    expect(out.chars).toEqual([]);
    expect(out.inputCut).toBe(2);
    expect(parseChars('大').inputCut).toBe(0);
  });

  it('dedupes the same way in either order', () => {
    expect(parseChars('大 大人').chars.join('')).toBe('大大人');
    expect(parseChars('大人 大').chars.join('')).toBe('大人大');
    expect(parseChars('学校 学生').chars.join('')).toBe('学校学生');
  });

  it('recognises five real heading lines and leaves real words alone', () => {
    for (const h of ['第三课', '生字', '第三课 生字', '本周生字', '第二单元 词语']) expect(isHeading(h), h).toBe(true);
    for (const w of ['学校', '第一', '大 小', '练习 学习']) expect(isHeading(w), w).toBe(false);
  });

  it('drops a short colon-ended heading line but keeps a long list that ends in a colon', () => {
    expect(parseChars('我的家人：\n爸 妈').chars.join('')).toBe('爸妈');
    expect(parseChars('大 小 多 少 上 下 左 右 山 水：').chars.join('')).toBe('大小多少上下左右山水');
  });

  it('drops iteration marks, keeps 〇', () => {
    expect(parseChars('人々 〇').chars.join('')).toBe('人〇');
  });

  it('handles characters outside the Basic Multilingual Plane as one character', () => {
    const out = parseChars('𠀀 大');
    expect(out.chars).toEqual(['𠀀', '大']);
  });
});
