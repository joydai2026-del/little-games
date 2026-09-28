// The locked page rules, ported from Avery Studio's print engine
// (scripts/hanzi/hanzi_svg.py writing_grid, STYLE-LOCK.md, 2026-08-24):
//
//   - ONE grid per character. Cell 1 is the finished character in solid ink.
//   - Cells 2..n+1 add one stroke each, once (the stroke build-up), in gray.
//   - Then `trace` cells with the whole character in light gray to trace over.
//   - Then empty cells to the end of the row. The grid wraps across rows, so a
//     14-stroke character behaves like a 1-stroke one.
//   - A two-character word gets two grids, kept together.
//   - Page fill: leftover space on every page becomes extra practice rows,
//     shared round-robin by the characters on that page. No dead lower half.
//
// Pure functions only. Sizes come from config.ts.

import { LAYOUT, PAPERS, type Options, type Paper } from './config';
import type { ParsedWord } from './parse';
import type { StrokeMap } from './strokes';

export type CellKind = 'model' | 'build' | 'trace' | 'empty';

export interface Cell {
  kind: CellKind;
  /** For 'build': how many strokes this cell shows. */
  upto?: number;
}

export interface Block {
  char: string;
  hasData: boolean;
  strokeCount: number;
  firstInWord: boolean;
  rows: Cell[][];
  /** Top of the block on its page, in SVG units (set by paginate). */
  y: number;
}

export interface Page {
  blocks: Block[];
}

export interface Sheet {
  options: Options;
  paper: Paper;
  width: number;
  height: number;
  header: number;
  footer: number;
  pages: Page[];
  /** Characters with no stroke data: drawn from the font, no build-up. */
  missing: string[];
}

/** The cell sequence for one character, before it is cut into rows. */
export function cellsFor(strokeCount: number, options: Options, layout = LAYOUT): Cell[] {
  const cells: Cell[] = [{ kind: 'model' }];
  for (let k = 1; k <= strokeCount; k++) cells.push({ kind: 'build', upto: k });
  for (let t = 0; t < options.trace; t++) cells.push({ kind: 'trace' });
  for (let e = 0; e < layout.minEmpty; e++) cells.push({ kind: 'empty' });
  while (cells.length % options.perRow !== 0) cells.push({ kind: 'empty' });
  return cells;
}

function toRows(cells: Cell[], perRow: number): Cell[][] {
  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow));
  return rows;
}

export function emptyRow(perRow: number): Cell[] {
  return Array.from({ length: perRow }, () => ({ kind: 'empty' as const }));
}

export function pageSize(options: Options, layout = LAYOUT) {
  const paper = PAPERS[options.paper];
  const width = options.perRow * layout.cell;
  const contentW = paper.width - 2 * paper.margin;
  const contentH = paper.height - 2 * paper.margin;
  const height = width * (contentH / contentW);
  const header = width * layout.headerFrac;
  const footer = width * layout.footerFrac;
  return { paper, width, height, header, footer, avail: height - header - footer };
}

function blockHeight(rows: number, layout = LAYOUT): number {
  return rows * layout.cell + Math.max(0, rows - 1) * layout.rowGap * layout.cell;
}

function spacingBefore(block: Block, layout = LAYOUT): number {
  return (block.firstInWord ? layout.wordGap : layout.charGap) * layout.cell;
}

/** Lay out every block and set y. Returns the used height. */
function stack(blocks: Block[], layout = LAYOUT): number {
  let y = 0;
  blocks.forEach((b, i) => {
    if (i > 0) y += spacingBefore(b, layout);
    b.y = y;
    y += blockHeight(b.rows.length, layout);
  });
  return y;
}

export function buildSheet(words: ParsedWord[], strokes: StrokeMap, options: Options, layout = LAYOUT): Sheet {
  const size = pageSize(options, layout);
  const rowPitch = layout.cell * (1 + layout.rowGap);
  const maxRows = Math.max(1, Math.floor((size.avail + layout.rowGap * layout.cell) / rowPitch));
  const missing: string[] = [];

  const blocks: Block[] = [];
  for (const word of words) {
    word.chars.forEach((char, i) => {
      const paths = strokes.get(char);
      const hasData = Array.isArray(paths) && paths.length > 0;
      if (!hasData && !missing.includes(char)) missing.push(char);
      const strokeCount = hasData ? paths!.length : 0;
      const rows = toRows(cellsFor(strokeCount, options, layout), options.perRow);
      // A grid taller than a page is split at a row boundary (rare: 60+ strokes
      // at 6 squares a row). Each piece starts its own page.
      for (let r = 0; r < rows.length; r += maxRows) {
        blocks.push({
          char,
          hasData,
          strokeCount,
          firstInWord: i === 0 && r === 0,
          rows: rows.slice(r, r + maxRows),
          y: 0,
        });
      }
    });
  }

  // Greedy pagination: a block moves to the next page if it does not fit whole.
  const pages: Page[] = [];
  let current: Block[] = [];
  for (const block of blocks) {
    if (current.length && stack([...current, block], layout) > size.avail) {
      pages.push({ blocks: current });
      current = [];
    }
    current.push(block);
  }
  if (current.length) pages.push({ blocks: current });

  // Page fill: turn leftover space into extra empty rows, shared round-robin.
  for (const page of pages) {
    let i = 0;
    let guard = 0;
    while (guard++ < 1000) {
      const b = page.blocks[i % page.blocks.length];
      b.rows.push(emptyRow(options.perRow));
      if (stack(page.blocks, layout) > size.avail) {
        b.rows.pop();
        break;
      }
      i++;
    }
    stack(page.blocks, layout);
  }

  return {
    options,
    paper: size.paper,
    width: size.width,
    height: size.height,
    header: size.header,
    footer: size.footer,
    pages,
    missing,
  };
}
