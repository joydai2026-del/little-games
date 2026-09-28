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

  it('never drops by keyword: 练习 日期 姓名 are vocabulary', () => {
    const out = parseChars('学校 练习 日期 姓名');
    expect(out.words.map((w) => w.text)).toEqual(['学校', '练习', '日期', '姓名']);
    expect(out.skipped).toEqual([]);
  });

  it('keeps a colon-ended line when no Chinese line follows it', () => {
    const out = parseChars('学校：\nschool');
    expect(out.chars.join('')).toBe('学校');
    expect(out.skipped).toEqual([]);
  });

  it('第三课 生字：校 skips the lesson marker and reports it', () => {
    const out = parseChars('第三课 生字：校');
    expect(out.chars.join('')).toBe('生字校');
    expect(out.skipped).toEqual(['第三课']);
  });

  it('skips a lesson marker alone on a line and a colon line over more Chinese lines, and reports both', () => {
    const out = parseChars('第三课\n我的家人：\n爸 妈');
    expect(out.chars.join('')).toBe('爸妈');
    expect(out.skipped).toEqual(['第三课', '我的家人']);
    expect(isHeading('第二单元')).toBe(true);
    expect(isHeading('第一')).toBe(false);
    expect(isHeading('生字')).toBe(false);
  });

  it('strips list numbering at line start instead of practising it', () => {
    expect(parseChars('一、生字 大 小\n二、词语 学校').chars.join('')).toBe('生字大小词语学校');
    expect(parseChars('（一）大\n(二) 小').chars.join('')).toBe('大小');
    expect(parseChars('㈠ 大\n㈡ 小').chars.join('')).toBe('大小');
    // Only the LINE-START number is a marker; a mid-line ㈡ normalizes to 二 (accepted trade,
    // the extra grid is visible in the preview).
    expect(parseChars('㈠ 大 ㈡ 小').chars.join('')).toBe('大二小');
    // Line breaks are not "content after": each ㊀ on its own line is the character.
    expect(parseChars('㊀\n㊁\n㊂').chars.join('')).toBe('一二三');
    expect(parseChars('㊀大\n㊁小').words.map((w) => w.text)).toEqual(['大', '小']);
    expect(parseChars('一 二 三').chars.join('')).toBe('一二三');
  });

  it('the common textbook layout: numbered colon labels over their lists are skipped', () => {
    const out = parseChars('一、生字：\n大 小 多\n二、词语：\n学校 老师');
    expect(out.chars.join('')).toBe('大小多学校老师');
    expect(out.skipped).toEqual(['生字', '词语']);
    // Still true: a list item without a colon is vocabulary, and a glossary keeps both words.
    expect(parseChars('1. 第五课').chars.join('')).toBe('第五课');
    expect(parseChars('学校：\nschool\n老师：\nteacher').chars.join('')).toBe('学校老师');
  });

  it('a numeral followed by 、 is vocabulary unless it prefixes a Chinese item', () => {
    const list = parseChars('一、二、三、四、五');
    expect(list.chars.join('')).toBe('一二三四五');
    expect(list.skipped).toEqual([]);
    expect(parseChars('一、\n二、\n三、').chars.join('')).toBe('一二三');
    expect(parseChars('十、百、千、万').chars.join('')).toBe('十百千万');
    expect(parseChars('一、生字 大').chars.join('')).toBe('生字大');
    expect(parseChars('一、学校\n（二）老师\n㊀大').chars.join('')).toBe('学校老师大');
  });

  it('a colon line is a heading only when the NEXT non-blank line has Chinese, and it is short', () => {
    const glossary = parseChars('学校：\nschool\n老师：\nteacher');
    expect(glossary.words.map((w) => w.text)).toEqual(['学校', '老师']);
    expect(glossary.skipped).toEqual([]);
    const sentence = parseChars('今天早上妈妈对我说：\n你要好好学习');
    expect(sentence.skipped).toEqual([]);
    const label = parseChars('我的家人：\n\n爸 妈');
    expect(label.skipped).toEqual(['我的家人']);
    expect(label.chars.join('')).toBe('爸妈');
  });

  it('a list item that looks like a heading is vocabulary, not a heading', () => {
    for (const paste of ['1. 第五课', '一、第五课', '• 第五课', '㊄ 第五课', '(3) 第五课']) {
      const out = parseChars(paste);
      expect(out.words.map((w) => w.text), paste).toEqual(['第五课']);
      expect(out.skipped, paste).toEqual([]);
    }
    // Without a marker it is still a heading shape.
    expect(parseChars('第五课\n大').skipped).toEqual(['第五课']);
  });

  it('enclosed ideographs are only numbering at line start; elsewhere they normalize', () => {
    expect(parseChars('我爱㊀').chars.join('')).toBe('我爱一');
    expect(parseChars('㊊ ㊋ ㊥ ㊤ ㊦').chars.join('')).toBe('月火中上下');
    expect(parseChars('㊀').chars.join('')).toBe('一'); // alone, no content after: it is the character
  });

  it('keeps a list that ends in a colon on the last line', () => {
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
