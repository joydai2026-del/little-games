// Sheet model -> SVG element trees, one <svg> per printed page.
// Colors are CSS classes whose values live in public/theme.css; line weights
// and dash patterns come from config.ts. No color literals here.

import { LAYOUT, SHEET_TEXT } from './config';
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
  const [dash, gap] = layout.diagDash;
  const w = layout.diagWidth;
  const out: SvgNode[] = [];
  for (let pos = 0; pos < length; pos += dash + gap) {
    const seg = Math.min(dash, length - pos);
    const px = x1 + (dx / length) * pos;
    const py = y1 + (dy / length) * pos;
    out.push(
      h('rect', {
        x: r2(px),
        y: r2(py - w / 2),
        width: r2(seg),
        height: w,
        class: 'g-diag',
        transform: `rotate(${r2(angle)} ${r2(px)} ${r2(py)})`,
      }),
    );
  }
  return out;
}

export function gridCell(x: number, y: number, diagonals: boolean, layout = LAYOUT): SvgNode {
  const s = layout.cell;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const guide = {
    class: 'g-guide',
    'stroke-width': layout.guideWidth,
    'stroke-dasharray': layout.guideDash.join(' '),
  };
  const parts: SvgNode[] = [];
  // Diagonals first, then the cross, then the border, so the quieter lines sit underneath.
  if (diagonals) parts.push(...dashedDiagonal(x, y, x + s, y + s, layout), ...dashedDiagonal(x + s, y, x, y + s, layout));
  parts.push(h('line', { x1: x, y1: cy, x2: x + s, y2: cy, ...guide }));
  parts.push(h('line', { x1: cx, y1: y, x2: cx, y2: y + s, ...guide }));
  parts.push(h('rect', { x, y, width: s, height: s, class: 'g-border', 'stroke-width': layout.borderWidth }));
  return h('g', {}, parts);
}

export function glyph(paths: string[], upto: number, x: number, y: number, inkClass: string, layout = LAYOUT): SvgNode {
  const inset = layout.glyphInset;
  const pad = Math.round((MMH_BOX * inset) / (1 - 2 * inset));
  const box = MMH_BOX + 2 * pad;
  return h('svg', { x, y, width: layout.cell, height: layout.cell, viewBox: `${-pad} ${-pad} ${box} ${box}` }, [
    h(
      'g',
      { transform: MMH_TRANSFORM, class: inkClass },
      paths.slice(0, upto).map((d) => h('path', { d })),
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

function cellContent(cell: Cell, char: string, paths: string[] | null, x: number, y: number, layout = LAYOUT): SvgNode | null {
  if (cell.kind === 'empty') return null;
  const ink = INK[cell.kind];
  if (!paths) return cell.kind === 'build' ? null : fontGlyph(char, x, y, ink, layout);
  const upto = cell.kind === 'build' ? cell.upto ?? paths.length : paths.length;
  return glyph(paths, upto, x, y, ink, layout);
}

function textLine(label: string, x: number, y: number, lineW: number, size: number): SvgNode[] {
  return [
    h('text', { x, y, 'font-size': r2(size), class: 'sheet-label' }, [label]),
    h('line', { x1: r2(x + size * 2.4), y1: r2(y + size * 0.15), x2: r2(x + size * 2.4 + lineW), y2: r2(y + size * 0.15), class: 'sheet-rule', 'stroke-width': 1.2 }),
  ];
}

export function renderPages(sheet: Sheet, strokes: StrokeMap, layout = LAYOUT): SvgNode[] {
  const { width: W, height: H, header, footer } = sheet;
  const labelSize = header * 0.42;
  const footSize = footer * 0.5;
  return sheet.pages.map((page, pageIndex) => {
    const children: SvgNode[] = [];
    // Name and date line.
    const baseY = header * 0.62;
    children.push(...textLine(SHEET_TEXT.name, 0, baseY, W * 0.36, labelSize));
    children.push(...textLine(SHEET_TEXT.date, W * 0.56, baseY, W * 0.3, labelSize));

    for (const block of page.blocks) {
      const paths = strokes.get(block.char) ?? null;
      const top = header + block.y;
      block.rows.forEach((row, r) => {
        const y = top + r * layout.cell * (1 + layout.rowGap);
        row.forEach((cell, c) => {
          const x = c * layout.cell;
          // The model cell is always 米字格 (STYLE-LOCK); practice cells follow the teacher's pick.
          const diagonals = cell.kind === 'model' || sheet.options.grid === 'mi';
          children.push(gridCell(x, y, diagonals, layout));
          const content = cellContent(cell, block.char, paths, x, y, layout);
          if (content) children.push(content);
        });
      });
    }

    const footY = H - footer * 0.3;
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
