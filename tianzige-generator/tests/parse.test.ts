import { describe, expect, it } from 'vitest';
import { parseChars } from '../src/shared/parse';
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

  it('ignores input past LIMITS.maxInput', () => {
    const out = parseChars('a'.repeat(LIMITS.maxInput) + '大');
    expect(out.chars).toEqual([]);
  });

  it('handles characters outside the Basic Multilingual Plane as one character', () => {
    const out = parseChars('𠀀 大');
    expect(out.chars).toEqual(['𠀀', '大']);
  });
});
