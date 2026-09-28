import './styles.css';
import { normalizeOptions, type Options, type SheetSpec } from '../shared/config';
import { buildSheet } from '../shared/layout';
import { pageCss } from '../shared/pagecss';
import { parseChars } from '../shared/parse';
import { renderPages } from '../shared/render';
import type { StrokeMap } from '../shared/strokes';
import { toDom } from './dom';
import { strokesFor } from './strokes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('chars');
const preview = $<HTMLElement>('preview');
const say = $<HTMLElement>('momo-says');
const printBtn = $<HTMLButtonElement>('print');
const pageStyle = $<HTMLStyleElement>('page-css');

const DEBOUNCE_MS = 200;

function readOptions(): Options {
  const raw: Record<string, string> = {};
  document.querySelectorAll<HTMLInputElement>('.controls input[type=radio]:checked').forEach((el) => {
    raw[el.name] = el.value;
  });
  return normalizeOptions(raw);
}

/** The whole sheet as plain JSON. A saved teacher list later is just this. */
export function currentSpec(): SheetSpec {
  return { version: 1, chars: input.value, options: readOptions() };
}

let renderToken = 0;

async function render(): Promise<void> {
  const token = ++renderToken;
  const spec = currentSpec();
  pageStyle.textContent = pageCss(spec.options.paper);
  const parsed = parseChars(spec.chars);

  if (parsed.chars.length === 0) {
    preview.replaceChildren();
    printBtn.disabled = true;
    say.textContent = spec.chars.trim()
      ? "I can't find any Chinese characters in that yet. Try pasting something like 大 小 山."
      : "Hi, I'm Momo! Paste your characters and I'll draw the practice grid.";
    return;
  }

  const entries = await Promise.all(parsed.chars.map(async (c) => [c, await strokesFor(c)] as const));
  if (token !== renderToken) return; // a newer keystroke already won
  const strokes: StrokeMap = new Map(entries);
  const sheet = buildSheet(parsed.words, strokes, spec.options);
  preview.replaceChildren(...renderPages(sheet, strokes).map(toDom));
  printBtn.disabled = false;

  const n = parsed.chars.length;
  const pages = sheet.pages.length;
  let msg = `${n} character${n === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'}. Ready to print!`;
  if (parsed.truncated) msg += ` (I kept the first ${n}. Make a second sheet for the rest.)`;
  if (sheet.missing.length) {
    msg += ` I don't know the stroke order for ${sheet.missing.join(' ')} yet, so ${sheet.missing.length === 1 ? 'it is' : 'they are'} drawn plain.`;
  }
  say.textContent = msg;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void render(), DEBOUNCE_MS);
}

input.addEventListener('input', schedule);
document.querySelectorAll('.controls input').forEach((el) => el.addEventListener('change', () => void render()));
printBtn.addEventListener('click', () => window.print());

void render();
