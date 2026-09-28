import { describe, expect, it } from 'vitest';
import { buildSheet, cellsFor, pageSize } from '../src/shared/layout';
import { DEFAULT_OPTIONS, LAYOUT, normalizeOptions, type Options } from '../src/shared/config';
import { parseChars } from '../src/shared/parse';
import { readStrokes, type StrokeMap } from '../src/shared/strokes';

import da from './fixtures/大.json';
import ren from './fixtures/人.json';
import shan from './fixtures/山.json';
import xue from './fixtures/学.json';
import xiao from './fixtures/校.json';
import hua from './fixtures/画.json';
import she from './fixtures/蛇.json';
import tian from './fixtures/添.json';
import zu from './fixtures/足.json';

const FIX: Record<string, unknown> = { 大: da, 人: ren, 山: shan, 学: xue, 校: xiao, 画: hua, 蛇: she, 添: tian, 足: zu };

function real(char: string): string[] {
  const s = readStrokes(FIX[char]);
  if (!s) throw new Error(`fixture ${char} is not valid stroke data`);
  return s;
}

const STROKES: StrokeMap = new Map([
  ['大', real('大')],
  ['人', real('人')],
  ['山', real('山')],
  ['学', real('学')],
  ['校', real('校')],
  ['画', real('画')],
  ['蛇', real('蛇')],
  ['添', real('添')],
  ['足', real('足')],
]);

const opts = (o: Partial<Options> = {}): Options => ({ ...DEFAULT_OPTIONS, ...o });

describe('cellsFor: the locked grid order', () => {
  it('model, one build-up cell per stroke, trace cells, then empty to the row end', () => {
    const cells = cellsFor(3, opts({ trace: 2, perRow: 8 }));
    expect(cells.map((c) => c.kind)).toEqual(['model', 'build', 'build', 'build', 'trace', 'trace', 'empty', 'empty']);
    expect(cells.filter((c) => c.kind === 'build').map((c) => c.upto)).toEqual([1, 2, 3]);
  });

  it('wraps a many-stroke character across rows and fills the last row', () => {
    const cells = cellsFor(8, opts({ trace: 2, perRow: 6 })); // 学 has 8 strokes
    expect(cells.length % 6).toBe(0);
    expect(cells.length).toBe(18); // 1 + 8 + 2 + minEmpty 2 = 13 -> 18
    expect(cells.slice(13).every((c) => c.kind === 'empty')).toBe(true);
  });

  it('always leaves room to write the whole character', () => {
    const cells = cellsFor(6, opts({ trace: 1, perRow: 8 })); // 1+6+1 = 8, needs minEmpty more
    expect(cells.filter((c) => c.kind === 'empty').length).toBeGreaterThanOrEqual(LAYOUT.minEmpty);
  });
});

describe('buildSheet', () => {
  it('uses real stroke counts (大 3, 人 2, 学 8)', () => {
    const { words } = parseChars('大 人 学');
    const sheet = buildSheet(words, STROKES, opts());
    const blocks = sheet.pages.flatMap((p) => p.blocks);
    expect(blocks.map((b) => [b.char, b.strokeCount])).toEqual([['大', 3], ['人', 2], ['学', 8]]);
  });

  it('draws a character with no stroke data plain and reports it', () => {
    const { words } = parseChars('大 㐀');
    const sheet = buildSheet(words, new Map([...STROKES, ['㐀', null]]), opts());
    expect(sheet.missing).toEqual(['㐀']);
    const block = sheet.pages[0].blocks.find((b) => b.char === '㐀')!;
    expect(block.hasData).toBe(false);
    expect(block.rows.flat().some((c) => c.kind === 'build')).toBe(false);
    expect(block.rows[0][0].kind).toBe('model');
  });

  it('fills every page: no room left for another row anywhere', () => {
    for (const perRow of [6, 8, 10]) {
      for (const paper of ['letter', 'a4'] as const) {
        const o = opts({ perRow, paper });
        const { words } = parseChars('大 人 山 学校');
        const sheet = buildSheet(words, STROKES, o);
        const size = pageSize(o);
        const pitch = LAYOUT.cell * (1 + LAYOUT.rowGap);
        for (const page of sheet.pages) {
          const last = page.blocks[page.blocks.length - 1];
          const bottom = last.y + last.rows.length * pitch - LAYOUT.rowGap * LAYOUT.cell;
          expect(bottom).toBeLessThanOrEqual(size.avail + 1e-6);
          expect(size.avail - bottom).toBeLessThan(pitch);
        }
      }
    }
  });

  it('breaks pages between characters, never inside one, for a long list', () => {
    const list = '大人山学校'.repeat(1);
    const { words } = parseChars([...list].join(' '));
    const many: typeof words = [];
    for (let i = 0; i < 6; i++) many.push(...words);
    const sheet = buildSheet(many, STROKES, opts({ perRow: 6 }));
    expect(sheet.pages.length).toBeGreaterThan(1);
    const size = pageSize(opts({ perRow: 6 }));
    for (const page of sheet.pages) {
      for (const b of page.blocks) expect(b.y).toBeGreaterThanOrEqual(0);
      const last = page.blocks[page.blocks.length - 1];
      expect(last.y + last.rows.length * LAYOUT.cell).toBeLessThanOrEqual(size.avail + LAYOUT.cell * LAYOUT.rowGap * last.rows.length);
    }
  });

  it('keeps the two grids of a word together, with the word gap only before the word', () => {
    const { words } = parseChars('学校 大');
    const sheet = buildSheet(words, STROKES, opts());
    const [xue, xiao, da] = sheet.pages[0].blocks;
    expect([xue.char, xiao.char, da.char]).toEqual(['学', '校', '大']);
    expect(xue.firstInWord).toBe(true);
    expect(xiao.firstInWord).toBe(false);
    expect(da.firstInWord).toBe(true);
  });
});

describe('words stay together across page breaks', () => {
  it('a 4-character idiom is never split, wherever the page boundary falls', () => {
    let boundaryHits = 0;
    for (const perRow of [6, 8, 10]) {
      for (const paper of ['letter', 'a4'] as const) {
        for (let before = 0; before <= 14; before++) {
          const lead = Array.from({ length: before }, (_, i) => '大人山'[i % 3]).join(' ');
          // Same single characters repeat, so disable whole-word dedupe by building words directly.
          const leadWords = lead ? lead.split(' ').map((c) => ({ text: c, chars: [c] })) : [];
          const words = [...leadWords, { text: '画蛇添足', chars: ['画', '蛇', '添', '足'] }, { text: '学校', chars: ['学', '校'] }];
          const sheet = buildSheet(words, STROKES, opts({ perRow, paper }));
          const pageOf = (ch: string) => sheet.pages.findIndex((p) => p.blocks.some((b) => b.char === ch && b.isReference));
          const idiomPages = new Set(['画', '蛇', '添', '足'].map(pageOf));
          // A word taller than a whole page (4 many-stroke characters at 6 a row) has to
          // break between its characters; every word that fits on a page stays whole.
          const idiomAlone = buildSheet([words[words.length - 2]], STROKES, opts({ perRow, paper }));
          const fitsOnePage = idiomAlone.pages.length === 1;
          if (fitsOnePage) expect(idiomPages.size, `${perRow}/${paper}/${before}`).toBe(1);
          expect(pageOf('学'), `${perRow}/${paper}/${before}`).toBe(pageOf('校'));
          if (pageOf('画') > 0 && sheet.pages[pageOf('画')].blocks[0].char === '画') boundaryHits++;
        }
      }
    }
    // The sweep really did push the idiom onto a new page in some cases.
    expect(boundaryHits).toBeGreaterThan(0);
  });
});

describe('page fill', () => {
  it('gives spare rows to the characters with the most strokes first', () => {
    const { words } = parseChars('大 人 学');
    const sheet = buildSheet(words, STROKES, opts());
    const base = (n: number) => Math.ceil((1 + n + DEFAULT_OPTIONS.trace + LAYOUT.minEmpty) / DEFAULT_OPTIONS.perRow);
    const extra = Object.fromEntries(sheet.pages[0].blocks.map((b) => [b.char, b.rows.length - base(b.strokeCount)]));
    // 学 (8 strokes) >= 大 (3) >= 人 (2), and they differ by at most one row.
    expect(extra['学']).toBeGreaterThanOrEqual(extra['大']);
    expect(extra['大']).toBeGreaterThanOrEqual(extra['人']);
    expect(extra['学'] - extra['人']).toBeLessThanOrEqual(1);
  });
});

describe('normalizeOptions', () => {
  it('clamps anything unknown to the defaults and accepts numeric strings', () => {
    expect(normalizeOptions({ grid: 'x', trace: 99, perRow: '10', paper: 'a4' })).toEqual({
      grid: DEFAULT_OPTIONS.grid,
      trace: DEFAULT_OPTIONS.trace,
      perRow: 10,
      paper: 'a4',
    });
    expect(normalizeOptions(null)).toEqual(DEFAULT_OPTIONS);
  });
});
