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
  const parsed = parseChars(spec.chars);

  // Until this render commits, the preview on screen is stale: no printing it.
  printBtn.disabled = true;

  if (parsed.chars.length === 0) {
    preview.replaceChildren();
    preview.removeAttribute('aria-busy');
    preview.classList.remove('loading');
    pageStyle.textContent = pageCss(spec.options.paper);
    say.textContent = spec.chars.trim()
      ? "I can't find any Chinese characters in that yet. Try pasting something like 大 小 山."
      : "Hi, I'm Momo! Paste your characters and I'll draw the practice grid.";
    return;
  }

  preview.setAttribute('aria-busy', 'true');
  preview.classList.add('loading');
  say.textContent = 'Drawing your sheet...';

  const entries = await Promise.all(parsed.chars.map(async (c) => [c, await strokesFor(c)] as const));
  if (token !== renderToken) return; // a newer keystroke already won
  const strokes: StrokeMap = new Map(entries);
  const sheet = buildSheet(parsed.words, strokes, spec.options);
  // Paper CSS changes together with the pages it belongs to, never before.
  pageStyle.textContent = pageCss(spec.options.paper);
  preview.replaceChildren(...renderPages(sheet, strokes).map(toDom));
  preview.removeAttribute('aria-busy');
  preview.classList.remove('loading');
  printBtn.disabled = false;

  const n = parsed.chars.length;
  const pages = sheet.pages.length;
  let msg = `${n} character${n === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'}. Ready to print!`;
  if (parsed.truncated) msg += ` (I kept the first ${n}. Make a second sheet for the rest.)`;
  if (parsed.inputCut > 0) {
    msg += ` Your paste was very long, so I skipped the last ${parsed.inputCut.toLocaleString('en-US')} letters of it.`;
  }
  if (sheet.missing.length) {
    msg += ` I don't know the stroke order for ${sheet.missing.join(' ')} yet, so ${sheet.missing.length === 1 ? 'it is' : 'they are'} drawn plain.`;
  }
  say.textContent = msg;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  // The preview is stale from the first keystroke, not only once the redraw starts.
  printBtn.disabled = true;
  preview.classList.add('loading');
  clearTimeout(timer);
  timer = setTimeout(() => void render(), DEBOUNCE_MS);
}

input.addEventListener('input', schedule);
document.querySelectorAll('.controls input').forEach((el) => el.addEventListener('change', () => void render()));
printBtn.addEventListener('click', () => {
  if (!printBtn.disabled) window.print();
});

// The browser bar colour comes from the theme, so theme.css stays the only palette.
const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--cream').trim();
if (themeColor) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

void render();
