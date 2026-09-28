import { describe, expect, it } from 'vitest';
import { buildSheet } from '../src/shared/layout';
import { DEFAULT_OPTIONS } from '../src/shared/config';
import { parseChars } from '../src/shared/parse';
import { renderPages } from '../src/shared/render';
import { readStrokes, isSingleHan, type StrokeMap } from '../src/shared/strokes';
import { h, toMarkup, type SvgNode } from '../src/shared/svg';
import { pageCss } from '../src/shared/pagecss';

import daJson from './fixtures/大.json';

const da = readStrokes(daJson)!;

function all(node: SvgNode | string, out: SvgNode[] = []): SvgNode[] {
  if (typeof node === 'string') return out;
  out.push(node);
  node.children.forEach((c) => all(c, out));
  return out;
}

describe('renderPages', () => {
  const strokes: StrokeMap = new Map([['大', da]]);
  const { words } = parseChars('大');

  it('draws the model in ink, build-up with 1..n strokes, and trace cells in light gray', () => {
    const sheet = buildSheet(words, strokes, { ...DEFAULT_OPTIONS, trace: 2 });
    const nodes = all(renderPages(sheet, strokes)[0]);
    const groups = nodes.filter((n) => n.tag === 'g' && typeof n.attrs.class === 'string' && n.attrs.class.startsWith('ink-'));
    expect(groups.map((g) => [g.attrs.class, g.children.length])).toEqual([
      ['ink-model', 3],
      ['ink-build', 1],
      ['ink-build', 2],
      ['ink-build', 3],
      ['ink-trace', 3],
      ['ink-trace', 3],
    ]);
  });

  it('puts 米字格 diagonals on the model cell only when the teacher picks 田字格', () => {
    const tian = all(renderPages(buildSheet(words, strokes, { ...DEFAULT_OPTIONS, grid: 'tian' }), strokes)[0]);
    const mi = all(renderPages(buildSheet(words, strokes, { ...DEFAULT_OPTIONS, grid: 'mi' }), strokes)[0]);
    const uses = (ns: SvgNode[], kind: string) => ns.filter((n) => n.tag === 'use' && String(n.attrs.href).endsWith(`-${kind}`)).length;
    const cells = (ns: SvgNode[]) => uses(ns, 'mi') + uses(ns, 'tian');
    // 田字格 sheet: only the one model cell per character gets the 米字格.
    expect(uses(tian, 'mi')).toBe(1);
    expect(uses(tian, 'tian')).toBe(cells(tian) - 1);
    expect(uses(mi, 'tian')).toBe(0);
    expect(uses(mi, 'mi')).toBe(cells(mi));
  });

  it('never draws diagonals as stroked lines (the Chromium PDF black-cross bug)', () => {
    const nodes = all(renderPages(buildSheet(words, strokes, { ...DEFAULT_OPTIONS, grid: 'mi' }), strokes)[0]);
    expect(nodes.filter((n) => n.attrs.class === 'g-diag').every((n) => n.tag === 'rect')).toBe(true);
    const lines = nodes.filter((n) => n.tag === 'line' && n.attrs.class === 'g-guide');
    expect(lines.every((l) => l.attrs.x1 === l.attrs.x2 || l.attrs.y1 === l.attrs.y2)).toBe(true);
  });

  it('puts no English on the student page', () => {
    const markup = renderPages(buildSheet(words, strokes, DEFAULT_OPTIONS), strokes).map(toMarkup).join('');
    const text = [...markup.matchAll(/>([^<]+)</g)].map((m) => m[1]).join(' ');
    // Only the brand line may carry Latin letters (STYLE-LOCK allows the brand line at the foot).
    expect(text.replace('Avery Studio', '')).not.toMatch(/[A-Za-z]/);
  });
});

describe('toMarkup escaping', () => {
  it('escapes text and attributes', () => {
    expect(toMarkup(h('text', { 'aria-label': '"><script>' }, ['<b>&']))).toBe(
      '<text aria-label="&quot;&gt;&lt;script&gt;">&lt;b&gt;&amp;</text>',
    );
  });
  it('refuses event handler attributes and odd tag names', () => {
    expect(() => toMarkup(h('rect', { onload: 'x' }))).toThrow();
    expect(() => toMarkup(h('img src=x', {}))).toThrow();
  });
});

describe('stroke data validation', () => {
  it('accepts real data and rejects anything that is not path data', () => {
    expect(da.length).toBe(3);
    expect(readStrokes({ strokes: ['M 1 2 Z" onload="x'] })).toBeNull();
    expect(readStrokes({ strokes: [] })).toBeNull();
    expect(readStrokes({ strokes: 'M 1 2' })).toBeNull();
    expect(readStrokes(null)).toBeNull();
  });
  it('isSingleHan', () => {
    expect(isSingleHan('大')).toBe(true);
    expect(isSingleHan('𠀀')).toBe(true);
    expect(isSingleHan('大人')).toBe(false);
    expect(isSingleHan('a')).toBe(false);
    expect(isSingleHan('../')).toBe(false);
  });
});

describe('pageCss', () => {
  it('sets Letter and A4 page sizes and printed page boxes', () => {
    expect(pageCss('letter')).toContain('size: letter; margin: 0.5in');
    expect(pageCss('letter')).toContain('width: 7.5in; height: 10in');
    expect(pageCss('a4')).toContain('size: A4; margin: 12.7mm');
    expect(pageCss('a4')).toContain('width: 184.6mm; height: 271.6mm');
  });
});

import sheetCss from '../public/sheet.css?raw';

describe('sheet.css', () => {
  it('styles the reused grid shapes without ancestor selectors (they live in <use> shadow trees)', () => {
    // Regression, 2026-09-28: `.sheet-page .g-border { fill: none }` did not match
    // the <use> clones, so every cell printed solid black.
    for (const cls of ['g-border', 'g-guide', 'g-diag']) {
      const rule = sheetCss.split('\n').find((l) => l.includes(`.${cls}`));
      expect(rule, cls).toMatch(new RegExp(`^\\.${cls} \\{`));
    }
    expect(sheetCss).toMatch(/\.g-border \{ fill: none;/);
  });
});
