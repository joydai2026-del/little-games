// DOM helpers. No framework, and nothing in src/client ever assigns raw
// markup to an element: every player-supplied string (names, captions)
// reaches the page as a text node, so a caption of
// `<img src=x onerror=alert(1)>` renders as those exact characters.
// The check:xss grep gate over this folder is what keeps it that way.

type Handler = (event: Event) => void;
type AttrValue = string | number | boolean | Handler | undefined | null;
export type Attrs = Record<string, AttrValue>;
export type Child = Node | string | null | undefined | false;

/**
 * Creates an element. Keys starting with `on` become listeners, `class`
 * becomes className, `text` becomes textContent, everything else is an
 * attribute. null/undefined/false values are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as Handler);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'value' && node instanceof HTMLInputElement) {
      node.value = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

/** A page shell: a header line and a body the screen fills. */
export function page(title: string, opts: { back?: string; subtitle?: string } = {}): {
  root: HTMLElement;
  body: HTMLElement;
} {
  const body = h('div', { class: 'page-body' });
  const root = h('div', { class: 'page' }, [
    h('header', { class: 'page-head' }, [
      opts.back ? h('a', { class: 'back', href: opts.back, text: 'Back' }) : null,
      h('h1', { text: title }),
      opts.subtitle ? h('p', { class: 'subtitle', text: opts.subtitle }) : null,
    ]),
    body,
  ]);
  return { root, body };
}

/** A short message strip. `kind` picks the colour. */
export function notice(message: string, kind: 'info' | 'warn' | 'error' = 'info'): HTMLElement {
  return h('p', { class: `notice notice-${kind}`, role: 'status', text: message });
}

/** Copies text, falling back to a hidden textarea on older mobile Safari. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A button that copies a link and says so for two seconds. */
export function copyButton(label: string, getUrl: () => string): HTMLButtonElement {
  const button = h('button', { class: 'btn btn-ghost', type: 'button', text: label });
  button.addEventListener('click', () => {
    void copyText(getUrl()).then((ok) => {
      button.textContent = ok ? 'Link copied' : 'Press and hold to copy';
      button.classList.add(ok ? 'copied' : 'copy-failed');
      window.setTimeout(() => {
        button.textContent = label;
        button.classList.remove('copied', 'copy-failed');
      }, 2000);
    });
  });
  return button;
}

/** The full page URL for a hash route, e.g. https://host/#/room/ABCD */
export function absoluteUrl(hash: string): string {
  const base = window.location.origin + window.location.pathname;
  return base + (hash.startsWith('#') ? hash : `#${hash}`);
}

let toastHost: HTMLElement | null = null;

/** A message that slides in at the bottom and leaves on its own. */
export function toast(message: string, kind: 'info' | 'error' = 'error'): void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const item = h('div', { class: `toast toast-${kind}`, text: message });
  toastHost.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

/** A labelled <select> built from a fixed list of numbers. */
export function numberSelect(
  id: string,
  label: string,
  values: number[],
  selected: number,
  suffix = ''
): { field: HTMLElement; select: HTMLSelectElement } {
  const list = values.includes(selected) ? values : [...values, selected].sort((a, b) => a - b);
  const select = h('select', { id, class: 'select' });
  for (const value of list) {
    const option = h('option', {
      value: String(value),
      text: suffix ? `${value} ${suffix}` : String(value),
    });
    if (value === selected) option.selected = true;
    select.append(option);
  }
  const field = h('div', { class: 'field' }, [h('label', { for: id, text: label }), select]);
  return { field, select };
}
