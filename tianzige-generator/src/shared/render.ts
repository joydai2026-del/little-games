// Sheet model -> SVG element trees, one <svg> per printed page.
// Colors are CSS classes whose values live in public/theme.css; line weights
// and dash patterns come from config.ts. No color literals here.

import { LAYOUT, SHEET_GEOM, SHEET_TEXT } from './config';
import type { Cell, Sheet } from './layout';
import type { StrokeMap } from './strokes';
import { h, r2, type SvgNode } from './svg';

/** Make Me a Hanzi paths live in a 1024 box with y up; this flips them into SVG space. */
const MMH_BOX = 1024;
const MMH_TRANSFORM = 'scale(1, -1) translate(0, -900)';

/** Dashed diagonal as small FILLED rotated rects, never a stroked line.
 *  Ported from hanzi_svg.py: Chromium's PDF writer lays a black path under
 *  non-axis-aligned stroked lines, which printed a pale 米字格 guide as a solid
 *  black cross (2026-08-24). Filled geometry is never stroke-converted. */
function dashedDiagonal(x1: number, y1: number, x2: number, y2: number, layout = LAYOUT): SvgNode[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const pattern = layout.diagDashDot; // dash, gap, dot, gap
  const w = layout.guideWidth * layout.diagWidthRatio;
  const out: SvgNode[] = [];
  let pos = 0;
  let k = 0;
  while (pos < length) {
    const len = pattern[k % pattern.length];
    if (k % 2 === 0) {
      const seg = Math.min(len, length - pos);
      const px = x1 + (dx / length) * pos;
      const py = y1 + (dy / length) * pos;
      out.push(
        h('rect', {
          x: r2(px),
          y: r2(py - w / 2),
          width: r2(seg),
          height: r2(w),
          class: 'g-diag',
          transform: `rotate(${r2(angle)} ${r2(px)} ${r2(py)})`,
        }),
      );
    }
    pos += len;
    k++;
  }
  return out;
}

/** One grid cell drawn at the origin. Defined once per page and reused with <use>. */
export function gridCell(diagonals: boolean, layout = LAYOUT): SvgNode[] {
  const s = layout.cell;
  const guide = {
    class: 'g-guide',
    'stroke-width': layout.guideWidth,
    'stroke-dasharray': layout.guideDash.join(' '),
  };
  const parts: SvgNode[] = [];
  // Diagonals first, then the cross, then the border, so the quieter lines sit underneath.
  if (diagonals) parts.push(...dashedDiagonal(0, 0, s, s, layout), ...dashedDiagonal(s, 0, 0, s, layout));
  parts.push(h('line', { x1: 0, y1: s / 2, x2: s, y2: s / 2, ...guide }));
  parts.push(h('line', { x1: s / 2, y1: 0, x2: s / 2, y2: s, ...guide }));
  parts.push(h('rect', { x: 0, y: 0, width: s, height: s, fill: 'none', class: 'g-border', 'stroke-width': layout.borderWidth }));
  return parts;
}

/** A glyph showing the first `upto` strokes, each a <use> of the page's stroke defs. */
export function glyph(ids: string[], upto: number, x: number, y: number, inkClass: string, layout = LAYOUT): SvgNode {
  const inset = layout.glyphInset;
  const pad = Math.round((MMH_BOX * inset) / (1 - 2 * inset));
  const box = MMH_BOX + 2 * pad;
  return h('svg', { x, y, width: layout.cell, height: layout.cell, viewBox: `${-pad} ${-pad} ${box} ${box}` }, [
    h(
      'g',
      { transform: MMH_TRANSFORM, class: inkClass },
      ids.slice(0, upto).map((id) => h('use', { href: `#${id}` })),
    ),
  ]);
}

function fontGlyph(char: string, x: number, y: number, inkClass: string, layout = LAYOUT): SvgNode {
  const s = layout.cell;
  return h(
    'text',
    {
      x: x + s / 2,
      y: y + s / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': r2(s * layout.fallbackGlyph),
      class: `glyph-font ${inkClass}`,
    },
    [char],
  );
}

const INK: Record<Cell['kind'], string> = {
  model: 'ink-model',
  build: 'ink-build',
  trace: 'ink-trace',
  empty: '',
};

function cellContent(cell: Cell, char: string, ids: string[] | null, x: number, y: number, layout = LAYOUT): SvgNode | null {
  if (cell.kind === 'empty') return null;
  const ink = INK[cell.kind];
  if (!ids) return cell.kind === 'build' ? null : fontGlyph(char, x, y, ink, layout);
  const upto = cell.kind === 'build' ? cell.upto ?? ids.length : ids.length;
  return glyph(ids, upto, x, y, ink, layout);
}

function textLine(label: string, x: number, y: number, lineW: number, size: number, g = SHEET_GEOM): SvgNode[] {
  const x1 = r2(x + size * g.ruleIndent);
  const ry = r2(y + size * g.ruleDrop);
  return [
    h('text', { x, y, 'font-size': r2(size), class: 'sheet-label' }, [label]),
    h('line', { x1, y1: ry, x2: r2(x1 + lineW), y2: ry, class: 'sheet-rule', 'stroke-width': g.ruleWidth }),
  ];
}

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1..99 as a Chinese numeral: 8 -> 八, 10 -> 十, 14 -> 十四, 20 -> 二十, 23 -> 二十三. */
export function chineseNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

export function strokeCountLabel(n: number): string {
  return `${SHEET_TEXT.countPrefix}${chineseNumber(n)}${SHEET_TEXT.countSuffix}`;
}

export function renderPages(sheet: Sheet, strokes: StrokeMap, layout = LAYOUT): SvgNode[] {
  const { width: W, height: H, header, footer } = sheet;
  const g = SHEET_GEOM;
  const labelSize = header * g.labelSize;
  const footSize = footer * g.footSize;
  return sheet.pages.map((page, pageIndex) => {
    const children: SvgNode[] = [];
    // Name and date line.
    const baseY = header * g.labelBaseline;
    children.push(...textLine(SHEET_TEXT.name, 0, baseY, W * g.nameWidth, labelSize));
    children.push(...textLine(SHEET_TEXT.date, W * g.dateX, baseY, W * g.dateWidth, labelSize));

    // Every shape used more than once is defined once per page: the two grid
    // cells and each stroke path. Keeps a 40-character sheet small.
    const defs: SvgNode[] = [];
    const prefix = `p${pageIndex}`;
    const gridId = { tian: `${prefix}-tian`, mi: `${prefix}-mi` };
    defs.push(h('g', { id: gridId.tian }, gridCell(false, layout)));
    defs.push(h('g', { id: gridId.mi }, gridCell(true, layout)));
    const strokeIds = new Map<string, string[] | null>();
    for (const block of page.blocks) {
      if (strokeIds.has(block.char)) continue;
      const paths = strokes.get(block.char) ?? null;
      if (!paths) {
        strokeIds.set(block.char, null);
        continue;
      }
      const base = `${prefix}-c${block.char.codePointAt(0)!.toString(16)}`;
      const ids = paths.map((_, k) => `${base}-${k}`);
      paths.forEach((d, k) => defs.push(h('path', { id: ids[k], d })));
      strokeIds.set(block.char, ids);
    }
    children.push(h('defs', {}, defs));

    for (const block of page.blocks) {
      const ids = strokeIds.get(block.char) ?? null;
      const top = header + block.y;
      // 共N画 over the reference cell (STYLE-LOCK: stroke counts in Chinese numerals).
      if (block.isReference && block.hasData) {
        children.push(
          h(
            'text',
            {
              x: 0,
              y: r2(top - layout.cell * layout.countLabelLift),
              'font-size': r2(layout.cell * layout.countLabelSize),
              class: 'sheet-count',
            },
            [strokeCountLabel(block.strokeCount)],
          ),
        );
      }
      block.rows.forEach((row, r) => {
        const y = r2(top + r * layout.cell * (1 + layout.rowGap));
        row.forEach((cell, c) => {
          const x = c * layout.cell;
          // The model cell is always 米字格 (STYLE-LOCK); practice cells follow the teacher's pick.
          const diagonals = cell.kind === 'model' || sheet.options.grid === 'mi';
          children.push(h('use', { href: `#${diagonals ? gridId.mi : gridId.tian}`, x, y }));
          const content = cellContent(cell, block.char, ids, x, y, layout);
          if (content) children.push(content);
        });
      });
    }

    const footY = H - footer + footer * g.footBaseline;
    children.push(h('text', { x: 0, y: r2(footY), 'font-size': r2(footSize), class: 'sheet-foot' }, [SHEET_TEXT.brand]));
    children.push(
      h('text', { x: W, y: r2(footY), 'font-size': r2(footSize), 'text-anchor': 'end', class: 'sheet-foot' }, [
        `${pageIndex + 1} / ${sheet.pages.length}`,
      ]),
    );

    return h(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `0 0 ${W} ${r2(H)}`,
        class: 'sheet-page',
        role: 'img',
        'aria-label': `田字格 ${pageIndex + 1}/${sheet.pages.length}`,
      },
      children,
    );
  });
}
