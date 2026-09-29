// THE ONLY FILE THAT KNOWS ABOUT THE DRAWING LIBRARY. Swap the library here and
// nothing else changes.
//
// Library: hanzi-writer 3.7.3 (MIT), loaded from jsDelivr pinned to that exact
// version with Subresource Integrity, so the browser refuses any other bytes.
// Security scan 2026-09-28 (Trace Race): WARN, mitigations applied (exact pin,
// SRI, crossorigin=anonymous, custom charDataLoader so browsers never call the
// data CDN: stroke JSON comes from this site's /api/strokes/:char).
//
// Stroke Reveal only ANIMATES: Momo draws one stroke at a time on the big
// screen, in step with the room's clock (strokesShown on the server).

import { GAME } from '../shared/config';
import { h, svg, token } from './ui';

export const HANZI_WRITER_VERSION = '3.7.3';
export const HANZI_WRITER_URL = `https://cdn.jsdelivr.net/npm/hanzi-writer@${HANZI_WRITER_VERSION}/dist/hanzi-writer.min.js`;
export const HANZI_WRITER_SRI = 'sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2';

// The small slice of the library's surface this game uses.
interface WriterStatic {
  create(el: HTMLElement, char: string, options: Record<string, unknown>): WriterInstance;
}
interface WriterInstance {
  animateStroke(strokeNum: number): Promise<unknown>;
  showCharacter(): Promise<unknown>;
}

let loading: Promise<WriterStatic> | null = null;

export function loadDrawer(): Promise<WriterStatic> {
  const existing = (window as unknown as { HanziWriter?: WriterStatic }).HanziWriter;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;
  loading = new Promise<WriterStatic>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HANZI_WRITER_URL;
    script.integrity = HANZI_WRITER_SRI;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      const lib = (window as unknown as { HanziWriter?: WriterStatic }).HanziWriter;
      if (lib) resolve(lib);
      else reject(new Error('drawer did not load'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('drawer did not load'));
    };
    document.head.append(script);
  });
  return loading;
}

function loadCharData(char: string, onLoad: (data: unknown) => void, onError: (err?: unknown) => void): void {
  fetch(`/api/strokes/${encodeURIComponent(char)}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`no stroke data for ${char}`))))
    .then(onLoad, onError);
}

/** The 田字格: dashed centre cross, drawn behind the writer. */
function grid(size: number): SVGElement {
  const dash = { stroke: token('--grid'), 'stroke-width': 2, 'stroke-dasharray': '10 8' };
  return svg('svg', { class: 'grid', width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    svg('line', { x1: size / 2, y1: 0, x2: size / 2, y2: size, ...dash }),
    svg('line', { x1: 0, y1: size / 2, x2: size, y2: size / 2, ...dash }),
  ]);
}

export interface DrawHandle {
  root: HTMLElement;
  /** Animate strokes, one after another, until `count` are on the pad. */
  showUpTo(count: number): void;
  /** Show the whole character at once (the answer). */
  showAll(): void;
  destroy(): void;
}

export function startDrawing(char: string, size: number, onError: (message: string) => void): DrawHandle {
  const writerEl = h('div', { class: 'writer', 'data-char': char });
  const root = h('div', { class: 'pad-wrap', style: `width:${size}px;height:${size}px` }, [writerEl]);
  root.prepend(grid(size));
  let writer: WriterInstance | null = null;
  let dead = false;
  let drawn = 0;
  let target = 0;
  let busy = false;
  let all = false;

  const pump = () => {
    if (dead || !writer || busy || all || drawn >= target) return;
    busy = true;
    const n = drawn;
    writer.animateStroke(n).then(() => {
      busy = false;
      drawn = Math.max(drawn, n + 1);
      root.dataset.drawn = String(drawn);
      pump();
    });
  };

  loadDrawer()
    .then((HanziWriter) => {
      if (dead) return;
      writer = HanziWriter.create(writerEl, char, {
        width: size,
        height: size,
        padding: Math.round(size * 0.06),
        showCharacter: false,
        showOutline: false,
        strokeColor: token('--ink'),
        strokeAnimationSpeed: GAME.strokeAnimationSpeed,
        charDataLoader: loadCharData,
        onLoadCharDataError: () => onError('Momo could not find this character. Check the internet.'),
      });
      if (all) void writer.showCharacter();
      else pump();
    })
    .catch(() => onError('The drawing did not load. Check the internet and reload.'));

  return {
    root,
    showUpTo(count: number) {
      target = Math.max(target, count);
      pump();
    },
    showAll() {
      if (all) return;
      all = true;
      root.dataset.drawn = 'all';
      if (writer) void writer.showCharacter();
    },
    destroy() {
      dead = true;
      root.remove();
    },
  };
}
