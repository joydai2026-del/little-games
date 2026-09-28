// DOM helpers. Nothing in src/client assigns raw markup: every name and every
// character reaches the page as a text node (npm run check:xss keeps it so).

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

export function momo(extraClass = ''): HTMLImageElement {
  return h('img', { class: `momo ${extraClass}`.trim(), src: '/momo.svg', alt: 'Momo the ink drop' });
}

export function brand(subtitle: string): HTMLElement {
  return h('div', { class: 'brand' }, [
    h('img', { src: '/momo.svg', alt: '' }),
    h('div', {}, [h('h1', { text: 'Trace Race 笔顺比赛' }), h('p', { class: 'sub', text: subtitle })]),
  ]);
}

/** The Avery header links home, except on screens where leaving loses progress
 *  (a kid mid-race): there it is plain text, so a stray tap cannot pull a kid out. */
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

/** Reads a colour token from theme.css so no colour literal lives in TS. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
