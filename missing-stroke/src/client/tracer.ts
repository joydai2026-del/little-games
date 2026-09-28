// THE ONLY FILE THAT KNOWS ABOUT THE TRACING LIBRARY. Swap the library here and
// nothing else changes.
//
// Missing Stroke (feasibility check 2026-09-28, read from the 3.7.3 source):
//   - quiz({ quizStartStrokeNum: k }) draws strokes 0..k-1 as done and checks
//     the NEXT stroke drawn against stroke k only. We stop the quiz right after
//     that one right stroke (cancelQuiz), so only stroke k is ever quizzed.
//   - The quiz HIDES strokes k+1..n and has no option to show them, so they
//     are drawn by this file in a layer under the writer, from the same stroke
//     JSON, with the library's own public HanziWriter.getScalingTransform so
//     both layers line up exactly.
//   - showOutline stays OFF: the outline would show the missing stroke.
//
// Library: hanzi-writer 3.7.3 (MIT), loaded from jsDelivr pinned to that exact
// version with Subresource Integrity, so the browser refuses any other bytes.
// Security scan 2026-09-28: WARN, mitigations applied (exact pin, SRI,
// crossorigin=anonymous, custom charDataLoader so kids' browsers never call
// the data CDN: stroke JSON comes from this site's /api/strokes/:char).

import { GAME } from '../shared/config';
import { h, svg, token } from './ui';

export const HANZI_WRITER_VERSION = '3.7.3';
export const HANZI_WRITER_URL = `https://cdn.jsdelivr.net/npm/hanzi-writer@${HANZI_WRITER_VERSION}/dist/hanzi-writer.min.js`;
export const HANZI_WRITER_SRI = 'sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2';

// The small slice of the library's surface this game uses.
interface WriterStatic {
  create(el: HTMLElement, char: string, options: Record<string, unknown>): WriterInstance;
  getScalingTransform(width: number, height: number, padding?: number): { transform: string };
}
interface WriterInstance {
  quiz(options: Record<string, unknown>): Promise<void>;
  cancelQuiz(): void;
  highlightStroke(strokeNum: number): Promise<void>;
}
interface StrokeInfo {
  strokeNum: number;
  mistakesOnStroke: number;
}
export interface CharData {
  strokes: string[];
  medians: number[][][];
}

let loading: Promise<WriterStatic> | null = null;

export function loadTracer(): Promise<WriterStatic> {
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
      else reject(new Error('tracer did not load'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('tracer did not load'));
    };
    document.head.append(script);
  });
  return loading;
}

const dataCache = new Map<string, Promise<CharData>>();

/** One character's stroke JSON from this site's hash-checked proxy (cached per page). */
export function charData(char: string): Promise<CharData> {
  let p = dataCache.get(char);
  if (!p) {
    p = fetch(`/api/strokes/${encodeURIComponent(char)}`).then((res) =>
      res.ok ? (res.json() as Promise<CharData>) : Promise.reject(new Error(`no stroke data for ${char}`))
    );
    p.catch(() => dataCache.delete(char));
    dataCache.set(char, p);
  }
  return p;
}

function loadCharData(char: string, onLoad: (data: unknown) => void, onError: (err?: unknown) => void): void {
  charData(char).then(onLoad, onError);
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

const padFor = (size: number) => Math.round(size * 0.06);

/** The strokes as filled paths, in the library's coordinates. `show(i)` picks each stroke's colour, or null to leave it out. */
function strokesLayer(lib: WriterStatic, data: CharData, size: number, show: (i: number) => string | null, cls: string): SVGElement {
  const { transform } = lib.getScalingTransform(size, size, padFor(size));
  const paths = data.strokes.flatMap((d, i) => {
    const fill = show(i);
    return fill ? [svg('path', { d, fill, 'data-stroke': i })] : [];
  });
  return svg('svg', { class: cls, width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [svg('g', { transform }, paths)]);
}

/**
 * A still picture of the character with one stroke missing (for the class
 * board), or with the missing stroke shown in pink (the answer).
 */
export function glyph(char: string, hidden: number, size: number, answer: boolean): HTMLElement {
  const box = h('div', { class: 'glyph', style: `width:${size}px;height:${size}px`, 'data-char': char, 'data-hidden': String(hidden) });
  box.append(grid(size));
  Promise.all([loadTracer(), charData(char)])
    .then(([lib, data]) => {
      const ink = token('--ink');
      const pink = token('--pink-deep');
      box.append(strokesLayer(lib, data, size, (i) => (i === hidden ? (answer ? pink : null) : ink), 'strokes'));
    })
    .catch(() => box.append(h('p', { class: 'muted', text: char })));
  return box;
}

export interface PadCallbacks {
  /** The kid drew the missing stroke. */
  onRight(): void;
  /** The kid drew something else. */
  onMistake(): void;
  onError(message: string): void;
}

export interface PadHandle {
  root: HTMLElement;
  /** Time is up: stop listening and show the missing stroke in pink. */
  reveal(): void;
  destroy(): void;
}

/**
 * The kid's pad: the character in ink with stroke `hidden` missing. Only that
 * stroke is checked; a right stroke fills in with ink and the pad stops.
 */
export function startPad(
  char: string,
  opts: { size: number; hidden: number; hintAfterMisses: number; hintNow?: boolean },
  cb: PadCallbacks
): PadHandle {
  const writerEl = h('div', { class: 'writer', 'data-char': char, 'data-hidden': String(opts.hidden) });
  const root = h('div', { class: 'pad-wrap', style: `width:${opts.size}px;height:${opts.size}px` }, [writerEl]);
  root.prepend(grid(opts.size));
  let writer: WriterInstance | null = null;
  let dead = false;
  let done = false;
  let lib: WriterStatic | null = null;
  let data: CharData | null = null;

  Promise.all([loadTracer(), charData(char)])
    .then(([HanziWriter, d]) => {
      if (dead) return;
      lib = HanziWriter;
      data = d;
      const ink = token('--ink');
      // Strokes after the missing one: the quiz hides them, so this layer draws them (under the writer).
      root.insertBefore(strokesLayer(HanziWriter, d, opts.size, (i) => (i > opts.hidden ? ink : null), 'strokes rest'), writerEl);
      writer = HanziWriter.create(writerEl, char, {
        width: opts.size,
        height: opts.size,
        padding: padFor(opts.size),
        showCharacter: false,
        showOutline: false,
        strokeColor: ink,
        drawingColor: token('--ink-soft'),
        highlightColor: token('--pink'),
        drawingWidth: GAME.drawingWidth,
        charDataLoader: loadCharData,
        onLoadCharDataError: () => cb.onError(`no stroke data for ${char}`),
      });
      const quizStarted = writer.quiz({
        leniency: GAME.leniency,
        quizStartStrokeNum: opts.hidden,
        showHintAfterMisses: opts.hintAfterMisses,
        markStrokeCorrectAfterMisses: false,
        highlightOnComplete: false,
        onCorrectStroke: (info: StrokeInfo) => {
          if (dead || done || info.strokeNum !== opts.hidden) return;
          done = true;
          root.classList.add('right');
          // Let the library fill the stroke with ink first, then stop the quiz: only this stroke is ever checked.
          setTimeout(() => {
            try {
              writer?.cancelQuiz();
            } catch {
              // already gone
            }
          }, 0);
          cb.onRight();
        },
        onMistake: () => {
          if (dead || done) return;
          root.classList.remove('wiggle');
          void root.offsetWidth;
          root.classList.add('wiggle');
          cb.onMistake();
        },
      });
      // A pad rebuilt after the kid already earned the hint shows it again right away.
      if (opts.hintNow) {
        void quizStarted.then(() => {
          if (!dead && !done) void writer?.highlightStroke(opts.hidden);
        });
      }
    })
    .catch(() => cb.onError('The drawing pad did not load. Check the internet and reload.'));

  return {
    root,
    reveal() {
      if (dead || done) return;
      done = true;
      try {
        writer?.cancelQuiz();
      } catch {
        // already gone
      }
      if (lib && data) {
        const pink = token('--pink-deep');
        root.append(strokesLayer(lib, data, opts.size, (i) => (i === opts.hidden ? pink : null), 'strokes answer'));
      }
    },
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
