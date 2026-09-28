// Every number the sheet layout uses lives here. Layout code reads these and
// never carries its own literals. Teacher-facing options are the `Options`
// fields; the rest is house policy that a later version (or a saved teacher
// list) can change without touching layout code.

export type GridStyle = 'tian' | 'mi';
export type PaperId = 'letter' | 'a4';

/** What the teacher can change. Serializable as-is (a future "saved list"). */
export interface Options {
  /** Grid for the practice cells. The first (model) cell is always 米字格 (STYLE-LOCK). */
  grid: GridStyle;
  /** How many light-gray full characters to trace after the stroke build-up. */
  trace: number;
  /** Squares across one row. */
  perRow: number;
  paper: PaperId;
}

/** The whole sheet request. Plain JSON, so it can be saved and replayed later. */
export interface SheetSpec {
  version: 1;
  chars: string;
  options: Options;
}

export const DEFAULT_OPTIONS: Options = {
  grid: 'tian',
  trace: 2,
  perRow: 8,
  paper: 'letter',
};

/** Allowed values for each teacher option. Anything else falls back to the default. */
export const OPTION_CHOICES = {
  grid: ['tian', 'mi'] as GridStyle[],
  trace: [0, 1, 2, 3],
  perRow: [6, 8, 10],
  paper: ['letter', 'a4'] as PaperId[],
};

export interface Paper {
  id: PaperId;
  /** CSS @page size keyword. */
  cssSize: string;
  unit: 'in' | 'mm';
  width: number;
  height: number;
  margin: number;
}

export const PAPERS: Record<PaperId, Paper> = {
  letter: { id: 'letter', cssSize: 'letter', unit: 'in', width: 8.5, height: 11, margin: 0.5 },
  a4: { id: 'a4', cssSize: 'A4', unit: 'mm', width: 210, height: 297, margin: 12.7 },
};

export const LAYOUT = {
  /** SVG units per cell. Everything else below is a fraction of one cell. */
  cell: 100,
  /** Gap between two rows of the same character. */
  rowGap: 0.12,
  /** Gap before a new character inside the same word. */
  charGap: 0.12,
  /** Gap before a new word. */
  wordGap: 0.4,
  /** Name/date line at the top of every page (fraction of page width). */
  headerFrac: 0.05,
  /** Brand line and page number at the foot (fraction of page width). */
  footerFrac: 0.035,
  /** Always leave at least this many empty cells to write the whole character. */
  minEmpty: 2,
  /** Glyph inset inside a cell, so ink never touches the border. */
  glyphInset: 0.06,
  /** Line weights and dash patterns, in SVG units (one cell = `cell` units). */
  borderWidth: 2.4,
  guideWidth: 1.6,
  guideDash: [5, 4],
  /** 米字格 diagonals are QUIETER than the centre cross (STYLE-LOCK): thinner, finer dashes. */
  diagWidth: 1.2,
  diagDash: [3, 4.2],
  /** Font size of a character with no stroke data, as a fraction of the cell. */
  fallbackGlyph: 0.78,
};

/** The student page carries no English (STYLE-LOCK). These are the only words on it. */
export const SHEET_TEXT = {
  name: '姓名',
  date: '日期',
  brand: 'Avery Studio · 墨墨',
};

export const LIMITS = {
  /** Most characters on one sheet. Also caps the upstream fetches of one /api/sheet call. */
  maxChars: 40,
  /** Longest paste we read at all. */
  maxInput: 4000,
  /** A run of Han characters this long or shorter is kept together as one word. */
  maxWordLen: 4,
};

/** Clamp any incoming options object to the allowed choices. */
export function normalizeOptions(input: unknown): Options {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const num = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);
  return {
    grid: pick(o.grid, OPTION_CHOICES.grid, DEFAULT_OPTIONS.grid),
    trace: pick(num(o.trace), OPTION_CHOICES.trace, DEFAULT_OPTIONS.trace),
    perRow: pick(num(o.perRow), OPTION_CHOICES.perRow, DEFAULT_OPTIONS.perRow),
    paper: pick(o.paper, OPTION_CHOICES.paper, DEFAULT_OPTIONS.paper),
  };
}
