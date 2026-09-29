// DOM helpers. Nothing in src/client assigns raw markup: every name and every
// word reaches the page as a text node (npm run check:xss keeps it so).
import { LEVEL_RULES, type Level } from '../shared/config';

type Handler = (event: Event) => void;
type AttrValue = string | number | boolean | Handler | undefined | null;
export type Attrs = Record<string, AttrValue>;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value as Handler);
    else if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'value' && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) node.value = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, children: Element[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

/** 1x for ordinary screens, @2x (512 px) for retina phones and iPads. */
const MOMO_SRCSET = '/momo.png 1x, /momo@2x.png 2x';

export function momo(extraClass = ''): HTMLImageElement {
  return h('img', { class: `momo ${extraClass}`.trim(), src: '/momo.png', srcset: MOMO_SRCSET, alt: 'Momo the puppy' });
}

export function brand(subtitle: string): HTMLElement {
  return h('div', { class: 'brand' }, [
    h('img', { src: '/momo.png', srcset: MOMO_SRCSET, alt: '' }),
    h('div', {}, [h('h1', {}, ['Dictation Dash ', h('span', { class: 'nowrap', text: '听写赛跑' })]), h('p', { class: 'sub', text: subtitle })]),
  ]);
}

/** The Avery header links home, except where leaving loses progress (a kid mid-round). */
export function setHeaderLink(on: boolean): void {
  const a = document.querySelector<HTMLAnchorElement>('.avery-header a');
  if (!a) return;
  if (on) {
    a.setAttribute('href', '/');
    a.setAttribute('aria-label', 'Avery Studio home');
  } else {
    a.removeAttribute('href');
    a.removeAttribute('aria-label');
  }
}

/** Reads a colour token from the CSS so no colour literal lives in TS. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A small 田字格 picture: the sample on each level button. `outline` draws a faint 字 in it. */
function sampleBox(outline: boolean): HTMLElement {
  return h('span', { class: `sample${outline ? ' with-outline' : ''}`, 'aria-hidden': 'true' }, [outline ? h('span', { class: 'ghost', text: '字' }) : null]);
}

/**
 * THE two level buttons, used on the teacher lobby, the practice card and
 * nowhere else. Big, side by side, each with a picture of what the box will
 * look like; the chosen one is ticked and outlined. JJ: the difficulty
 * variations need to be obvious.
 */
export function levelPicker(current: Level, onPick: (level: Level) => void): HTMLElement {
  const buttons = (Object.keys(LEVEL_RULES) as Level[]).map((level) => {
    const rule = LEVEL_RULES[level];
    const chosen = level === current;
    const b = h('button', { type: 'button', class: `level level-${level}${chosen ? ' chosen' : ''}`, 'aria-pressed': chosen ? 'true' : 'false', 'data-level': level }, [
      sampleBox(rule.showOutline),
      h('span', { class: 'level-name', text: rule.label }),
      h('span', { class: 'level-blurb', text: rule.blurb }),
      h('span', { class: 'level-tick', text: chosen ? '✓ Chosen' : 'Tap to choose' }),
    ]);
    b.addEventListener('click', () => onPick(level));
    return b;
  });
  return h('div', { class: 'levels', role: 'group', 'aria-label': 'Level' }, buttons);
}

/** The level as a badge on the kid's screen and the board. */
export function levelBadge(level: Level): HTMLElement {
  const rule = LEVEL_RULES[level];
  return h('span', { class: `level-badge level-${level}`, text: `${rule.label}: ${rule.blurb}` });
}
