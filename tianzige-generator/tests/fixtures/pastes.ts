// Messy teacher pastes, written the way real lists arrive (from a doc, an
// email, a slide, a textbook unit list). Each lists the grids we expect.

export interface PasteCase {
  name: string;
  paste: string;
  words: string[];
  chars: string;
}

export const PASTES: PasteCase[] = [
  {
    name: 'numbered list with pinyin and English glosses',
    paste: `1. 大 dà big\n2. 小 xiǎo small\n3. 山 shān mountain\n4. 水 shuǐ water`,
    words: ['大', '小', '山', '水'],
    chars: '大小山水',
  },
  {
    name: 'Chinese enumeration comma, full-width punctuation',
    paste: '本周生字：日、月、火、木、土。',
    words: ['本周生字', '日', '月', '火', '木', '土'],
    chars: '本周生字日月火木土',
  },
  {
    name: 'words with pinyin in parentheses, one per line, duplicates',
    paste: '学校 (xuéxiào)\n老师（lǎoshī） - teacher\n同学 tóngxué\n学校 xuéxiào',
    words: ['学校', '老师', '同学'],
    chars: '学校老师同学',
  },
  {
    name: 'family words, reduplicated characters, tone numbers',
    paste: '爸爸 ba4ba, 妈妈 ma1ma, 哥哥 ge1ge; 我 wo3',
    words: ['爸爸', '妈妈', '哥哥', '我'],
    chars: '爸妈哥我',
  },
  {
    name: 'long run nobody separated becomes single characters',
    paste: 'Unit 3 numbers: 一二三四五六七八九十 (1-10)',
    words: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'],
    chars: '一二三四五六七八九十',
  },
  {
    name: 'circled numbers, bullets, emoji, tabs',
    paste: '① 春\t② 夏 ☀️\n• 秋 🍂\n- 冬 ❄️',
    words: ['春', '夏', '秋', '冬'],
    chars: '春夏秋冬',
  },
  {
    name: 'traditional characters pass through unchanged',
    paste: '龍 lóng, 學校, 馬 mǎ',
    words: ['龍', '學校', '馬'],
    chars: '龍學校馬',
  },
  {
    name: 'single character repeated after a word containing it',
    paste: '大人 dàren, 大, 人, 天',
    words: ['大人', '天'],
    chars: '大人天',
  },
];
