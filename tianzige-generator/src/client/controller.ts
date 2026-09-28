// The redraw logic, with the DOM passed in so it can be tested with fakes.
//
// The one rule that matters for printing: Print is enabled ONLY by the render
// that matches the text in the box right now. Every keystroke or option change
// bumps the token immediately (not when the debounce fires), so a slow stroke
// fetch that finishes during the debounce can never re-enable Print for a stale
// sheet.

import type { SheetSpec } from '../shared/config';
import { buildSheet, type Sheet } from '../shared/layout';
import { parseChars, type ParseResult } from '../shared/parse';
import type { StrokeMap } from '../shared/strokes';

export interface View {
  readSpec(): SheetSpec;
  strokesFor(char: string): Promise<string[] | null>;
  setPrintEnabled(enabled: boolean): void;
  setLoading(loading: boolean): void;
  say(message: string): void;
  /** Draw the finished sheet (and its paper CSS) in one step. */
  commit(sheet: Sheet | null, strokes: StrokeMap, spec: SheetSpec): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export function momoMessage(parsed: ParseResult, sheet: Sheet): string {
  const n = parsed.chars.length;
  const pages = sheet.pages.length;
  let msg = `${n} character${n === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'}. Ready to print!`;
  if (parsed.truncated) msg += ` (I kept the first ${n}. Make a second sheet for the rest.)`;
  if (parsed.inputCut > 0) msg += ` Your paste was very long, so I skipped the last ${parsed.inputCut.toLocaleString('en-US')} letters of it.`;
  if (parsed.skipped.length) msg += ` I skipped these headings: ${parsed.skipped.join(', ')}.`;
  for (const w of sheet.splitWords) msg += ` ${w} is too tall for one page at this size, so it runs onto the next page.`;
  if (sheet.missing.length) {
    msg += ` I don't know the stroke order for ${sheet.missing.join(' ')} yet, so ${sheet.missing.length === 1 ? 'it is' : 'they are'} drawn plain.`;
  }
  return msg;
}

export function emptyMessage(text: string, parsed: ParseResult): string {
  if (!text.trim()) return "Hi, I'm Momo! Paste your characters and I'll draw the practice grid.";
  if (parsed.skipped.length) {
    return `I skipped these headings: ${parsed.skipped.join(', ')}, and found nothing else to practice. Paste the characters too, like 大 小 山.`;
  }
  return "I can't find any Chinese characters in that yet. Try pasting something like 大 小 山.";
}

export function createController(view: View, debounceMs: number) {
  let token = 0;
  let timer: unknown;

  /** Anything on screen is now stale: no printing until the matching render commits. */
  function invalidate(): number {
    token++;
    view.setPrintEnabled(false);
    view.setLoading(true);
    return token;
  }

  async function render(): Promise<void> {
    const mine = invalidate();
    const spec = view.readSpec();
    const parsed = parseChars(spec.chars);
    if (parsed.chars.length === 0) {
      view.commit(null, new Map(), spec);
      view.setLoading(false);
      view.say(emptyMessage(spec.chars, parsed));
      return;
    }
    view.say('Drawing your sheet...');
    const entries = await Promise.all(parsed.chars.map(async (c) => [c, await view.strokesFor(c)] as const));
    if (mine !== token) return; // a newer keystroke or option already won
    const strokes: StrokeMap = new Map(entries);
    const sheet = buildSheet(parsed.words, strokes, spec.options);
    view.commit(sheet, strokes, spec);
    view.setLoading(false);
    view.setPrintEnabled(true);
    view.say(momoMessage(parsed, sheet));
  }

  function schedule(): void {
    invalidate();
    view.clearTimer(timer);
    timer = view.setTimer(() => void render(), debounceMs);
  }

  return { render, schedule, currentToken: () => token };
}
