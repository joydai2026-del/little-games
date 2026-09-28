// THE ONLY FILE THAT KNOWS ABOUT THE WRITING LIBRARY. Copied from
// trace-race/src/client/tracer.ts (same pin, same SRI, same data loader). Swap the library here and
// nothing else changes.
//
// Library: hanzi-writer 3.7.3 (MIT), loaded from jsDelivr pinned to that exact
// version with Subresource Integrity, so the browser refuses any other bytes.
// Security scan 2026-09-28: WARN, mitigations applied (exact pin, SRI,
// crossorigin=anonymous, custom charDataLoader so kids' browsers never call
// the data CDN: stroke JSON comes from this site's /api/strokes/:char).

import { GAME, LEVEL_RULES, type Level } from '../shared/config';
import { h, svg, token } from './ui';

export const HANZI_WRITER_VERSION = '3.7.3';
export const HANZI_WRITER_URL = `https://cdn.jsdelivr.net/npm/hanzi-writer@${HANZI_WRITER_VERSION}/dist/hanzi-writer.min.js`;
export const HANZI_WRITER_SRI = 'sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2';

// The small slice of the library's surface this game uses.
interface WriterStatic {
  create(el: HTMLElement, char: string, options: Record<string, unknown>): WriterInstance;
}
interface WriterInstance {
  quiz(options: Record<string, unknown>): void;
  cancelQuiz(): void;
}
interface StrokeInfo {
  strokeNum: number;
  totalMistakes: number;
}

let loading: Promise<WriterStatic> | null = null;

export function loadWriter(): Promise<WriterStatic> {
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
      else reject(new Error('writer did not load'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('writer did not load'));
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

/** The 田字格: border plus dashed centre cross, drawn behind the writer. */
function grid(size: number): SVGElement {
  const color = token('--grid');
  const dash = { stroke: color, 'stroke-width': 2, 'stroke-dasharray': '10 8' };
  return svg('svg', { class: 'grid', width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    svg('line', { x1: size / 2, y1: 0, x2: size / 2, y2: size, ...dash }),
    svg('line', { x1: 0, y1: size / 2, x2: size, y2: size / 2, ...dash }),
  ]);
}

export interface WriteCallbacks {
  onCorrect(strokeIndex: number): void;
  onMistake(strokeIndex: number): void;
  onComplete(): void;
  onError(message: string): void;
}

export interface WriteHandle {
  root: HTMLElement;
  destroy(): void;
}

/**
 * One 田字格 the kid writes one character in, stroke by stroke.
 *
 * Feasibility check (2026-09-28, read from hanzi-writer 3.7.3 source): the
 * quiz grades each stroke against the character's stroke data (medians) with
 * the outline hidden. `showOutline` only sets the outline layer's opacity;
 * `strokeMatches` runs the same way (with no outline the FIRST stroke even
 * gets the looser distance threshold). So Hard = showOutline:false and
 * showCharacter:false, and right strokes still appear in ink as they land.
 */
export function startWrite(
  char: string,
  opts: { size: number; level: Level; startStroke: number },
  cb: WriteCallbacks
): WriteHandle {
  const rule = LEVEL_RULES[opts.level];
  const writerEl = h('div', { class: 'writer', 'data-char': char, 'data-level': opts.level, 'data-stroke': opts.startStroke });
  const root = h('div', { class: `pad-wrap pad-${opts.level}`, style: `width:${opts.size}px;height:${opts.size}px` }, [writerEl]);
  root.prepend(grid(opts.size));
  let writer: WriterInstance | null = null;
  let dead = false;

  loadWriter()
    .then((HanziWriter) => {
      if (dead) return;
      writer = HanziWriter.create(writerEl, char, {
        width: opts.size,
        height: opts.size,
        padding: Math.round(opts.size * 0.06),
        showCharacter: false,
        showOutline: rule.showOutline,
        outlineColor: token('--outline-easy'),
        strokeColor: token('--ink'),
        drawingColor: token('--ink-soft'),
        highlightColor: token('--pink'),
        drawingWidth: GAME.drawingWidth,
        charDataLoader: loadCharData,
        onLoadCharDataError: () => cb.onError('The writing box did not load. Check the internet.'),
      });
      writer.quiz({
        leniency: GAME.leniency,
        showHintAfterMisses: rule.hintAfterMisses,
        markStrokeCorrectAfterMisses: GAME.giveStrokeAfterMisses,
        highlightOnComplete: true,
        quizStartStrokeNum: opts.startStroke,
        onCorrectStroke: (d: StrokeInfo) => {
          if (dead) return;
          writerEl.dataset.stroke = String(d.strokeNum + 1); // next stroke expected (read by the live run)
          cb.onCorrect(d.strokeNum);
        },
        onMistake: (d: StrokeInfo) => {
          if (dead) return;
          root.classList.remove('wiggle');
          void root.offsetWidth;
          root.classList.add('wiggle');
          cb.onMistake(d.strokeNum);
        },
        onComplete: () => !dead && cb.onComplete(),
      });
    })
    .catch(() => cb.onError('The writing box did not load. Check the internet and reload.'));

  return {
    root,
    destroy() {
      dead = true;
      try {
        writer?.cancelQuiz();
      } catch {
        // already gone
      }
      root.remove();
    },
  };
}
