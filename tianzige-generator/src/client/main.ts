import './styles.css';
import { normalizeOptions, type Options, type SheetSpec } from '../shared/config';
import { pageCss } from '../shared/pagecss';
import { renderPages } from '../shared/render';
import { createController } from './controller';
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

const controller = createController(
  {
    readSpec: currentSpec,
    strokesFor,
    setPrintEnabled: (enabled) => {
      printBtn.disabled = !enabled;
    },
    setLoading: (loading) => {
      preview.classList.toggle('loading', loading);
      if (loading) preview.setAttribute('aria-busy', 'true');
      else preview.removeAttribute('aria-busy');
    },
    say: (message) => {
      say.textContent = message;
    },
    commit: (sheet, strokes, spec) => {
      // Paper CSS changes together with the pages it belongs to, never before.
      pageStyle.textContent = pageCss(spec.options.paper);
      preview.replaceChildren(...(sheet ? renderPages(sheet, strokes).map(toDom) : []));
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  DEBOUNCE_MS,
);

input.addEventListener('input', () => controller.schedule());
document.querySelectorAll('.controls input').forEach((el) => el.addEventListener('change', () => void controller.render()));
printBtn.addEventListener('click', () => {
  if (!printBtn.disabled) window.print();
});

// The browser bar colour comes from the theme, so theme.css stays the only palette.
const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--cream').trim();
if (themeColor) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

// The tool is one page and keeps nothing between loads, so following the Avery
// header link would wipe the pasted list. Here "home" is the top of this page.
document.querySelector('.avery-header a')?.addEventListener('click', (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

void controller.render();
