// Taint tests for the one DOM sink the client has: setAttribute in dom.ts.
// check:xss only greps for raw-markup APIs; these prove that pasted text can
// never become an attribute, and that URL-valued attributes stay same-page.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toDom } from '../src/client/dom';
import { DEFAULT_OPTIONS } from '../src/shared/config';
import { buildSheet } from '../src/shared/layout';
import { parseChars } from '../src/shared/parse';
import { renderPages } from '../src/shared/render';
import { readStrokes, type StrokeMap } from '../src/shared/strokes';
import { h, type SvgNode } from '../src/shared/svg';
import daJson from './fixtures/大.json';

interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  children: unknown[];
  setAttribute(k: string, v: string): void;
  appendChild(c: unknown): void;
}

const saved = (globalThis as { document?: unknown }).document;
beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElementNS: (_ns: string, tag: string): FakeEl => ({
      tag,
      attrs: {},
      children: [],
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      appendChild(c) {
        this.children.push(c);
      },
    }),
    createTextNode: (text: string) => ({ text }),
  };
});
afterEach(() => {
  (globalThis as { document?: unknown }).document = saved;
});

function walk(node: SvgNode | string, out: SvgNode[] = []): SvgNode[] {
  if (typeof node === 'string') return out;
  out.push(node);
  node.children.forEach((c) => walk(c, out));
  return out;
}

describe('toDom attribute sink', () => {
  it('drops event handlers, style, and any href that is not a same-page #id', () => {
    const el = toDom(
      h('use', {
        href: 'javascript:alert(1)',
        'xlink:href': 'https://evil.test/x.svg#a',
        onload: 'alert(1)',
        ONCLICK: 'x',
        style: 'background:url(https://evil.test)',
        x: 5,
      }),
    ) as unknown as FakeEl;
    expect(el.attrs).toEqual({ x: '5' });
    const ok = toDom(h('use', { href: '#p0-c5927-0' })) as unknown as FakeEl;
    expect(ok.attrs).toEqual({ href: '#p0-c5927-0' });
  });

  it('never puts pasted text into an attribute, even a hostile paste', () => {
    const paste = '大 "><img src=x onerror=alert(1)> javascript:alert(1) 𠀀 ⼈';
    const parsed = parseChars(paste);
    expect(parsed.chars).toEqual(['大', '𠀀', '人']);
    const strokes: StrokeMap = new Map<string, string[] | null>([['大', readStrokes(daJson)], ['𠀀', null], ['人', null]]);
    const pages = renderPages(buildSheet(parsed.words, strokes, DEFAULT_OPTIONS), strokes);
    const SAFE_VALUE = /^(-?[\d.]+|[a-z-]+( [a-z-]+)*|#?p\d+-(tian|mi|c[0-9a-f]+-\d+)|[\d. -]+|rotate\([\d. -]+\)|scale\(1, -1\) translate\(0, -900\)|http:\/\/www\.w3\.org\/2000\/svg|田字格 \d+\/\d+|[MLQCZ0-9 .-]+)$/;
    for (const page of pages) {
      for (const node of walk(page)) {
        for (const [k, v] of Object.entries(node.attrs)) {
          expect(SAFE_VALUE.test(String(v)), `${node.tag} ${k}=${v}`).toBe(true);
          expect(String(v)).not.toMatch(/javascript|onerror|<|>|"/);
        }
      }
      toDom(page); // and the client builds it without throwing
    }
  });
});
