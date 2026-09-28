// THE ONLY FILE THAT DRAWS CHARACTERS AND READS THE FINGER.
//
// History (feasibility check 2026-09-28): the first build used Hanzi Writer
// 3.7.3's quiz on the phone (quizStartStrokeNum + cancelQuiz) to check the
// missing stroke. Review round 1 ruled that the ROOM must grade every answer
// from the drawn points, and that a phone must never learn which stroke is
// missing. So the phone no longer runs a matcher at all: it draws the strokes
// the room sends (`turn.visible`, unlabelled), records the finger, and sends
// the points. Grading is src/shared/matcher.ts (a port of Hanzi Writer's MIT
// matcher), run by the room. No third-party script is loaded any more.
//
// Stroke data comes from this site's hash-checked /api/strokes/:char proxy.

import { GAME } from '../shared/config';
import { placement, toCharPoint, type Point } from '../shared/matcher';
import type { CharGeom } from '../shared/types';
import { h, svg, token } from './ui';
import { timeoutSignal } from './timeout';

const dataCache = new Map<string, Promise<CharGeom>>();

/** One character's stroke JSON from this site's hash-checked proxy (cached per page). */
export function charData(char: string): Promise<CharGeom> {
  let p = dataCache.get(char);
  if (!p) {
    p = fetch(`/api/strokes/${encodeURIComponent(char)}`, { signal: timeoutSignal(GAME.requestTimeoutMs) }).then((res) =>
      res.ok ? (res.json() as Promise<CharGeom>) : Promise.reject(new Error(`no stroke data for ${char}`))
    );
    p.catch(() => dataCache.delete(char));
    dataCache.set(char, p);
  }
  return p;
}

/** The 田字格: dashed centre cross, drawn behind everything. */
function grid(size: number): SVGElement {
  const color = token('--grid');
  const dash = { stroke: color, 'stroke-width': 2, 'stroke-dasharray': '10 8' };
  return svg('svg', { class: 'grid', width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    svg('line', { x1: size / 2, y1: 0, x2: size / 2, y2: size, ...dash }),
    svg('line', { x1: 0, y1: size / 2, x2: size, y2: size / 2, ...dash }),
  ]);
}

const padFor = (size: number) => Math.round(size * 0.06);

/** Filled stroke shapes (SVG paths in stroke-data coordinates) placed in a size x size box. */
function pathsLayer(paths: { d: string; fill: string }[], size: number, cls: string): SVGElement {
  const { transform } = placement(size, padFor(size));
  return svg('svg', { class: cls, width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    svg('g', { transform }, paths.map((p) => svg('path', { d: p.d, fill: p.fill }))),
  ]);
}

/** A still picture: the visible strokes in ink, and the answer stroke in pink when given. */
export function glyphFromPaths(visible: string[], answer: string | null, size: number): HTMLElement {
  const box = h('div', { class: 'glyph', style: `width:${size}px;height:${size}px` });
  const ink = token('--ink');
  const paths = visible.map((d) => ({ d, fill: ink }));
  if (answer) paths.push({ d: answer, fill: token('--pink-deep') });
  box.append(grid(size), pathsLayer(paths, size, 'strokes'));
  return box;
}

/** A finished character (after its turn closed): all strokes, the missing one in pink. */
export function glyph(char: string, hidden: number, size: number): HTMLElement {
  const box = h('div', { class: 'glyph', style: `width:${size}px;height:${size}px` });
  box.append(grid(size));
  charData(char)
    .then((d) => {
      const ink = token('--ink');
      const pink = token('--pink-deep');
      box.append(pathsLayer(d.strokes.map((p, i) => ({ d: p, fill: i === hidden ? pink : ink })), size, 'strokes'));
    })
    .catch(() => box.append(h('p', { class: 'muted', text: char })));
  return box;
}

export interface PadHandle {
  root: HTMLElement;
  /** The room said right: the stroke fills in with ink. */
  showRight(answer: string | null): void;
  /** The room said wrong: the pad wiggles. */
  wiggle(): void;
  /** The earned hint: the missing stroke flashes in pink. */
  flashHint(answer: string): void;
  /** Time is up: show the missing stroke in pink and stop listening. */
  reveal(answer: string | null): void;
  destroy(): void;
}

/** True when every point of a drag (pad pixels) stays inside the pad, give or take `margin` x size. */
export function insideBox(points: [number, number][], size: number, margin: number = GAME.padOutsideMargin): boolean {
  const m = size * margin;
  return points.every(([x, y]) => x >= -m && y >= -m && x <= size + m && y <= size + m);
}

/** Keeps at most `max` points of a long drag, evenly spread, always with both ends. */
export function thinPoints(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const out: Point[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return out;
}

/**
 * The kid's pad: the strokes the room sent, in ink, with one stroke missing.
 * The kid draws; every finished stroke's points go to `onStroke` (the room
 * grades them). The pad never knows which stroke is missing.
 */
export function startPad(opts: { size: number; visible: string[] }, onStroke: (points: Point[]) => void, onOutside: () => void = () => {}): PadHandle {
  const size = opts.size;
  const pad = padFor(size);
  const ink = token('--ink');
  const root = h('div', { class: 'pad-wrap', style: `width:${size}px;height:${size}px`, 'data-strokes-shown': String(opts.visible.length) });
  root.append(grid(size), pathsLayer(opts.visible.map((d) => ({ d, fill: ink })), size, 'strokes'));
  const penWidth = Math.max(6, GAME.drawingWidth * placement(size, pad).scale);
  const drawing = svg('svg', { class: 'drawing', width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  root.append(drawing);
  let done = false;
  let dead = false;
  let screen: [number, number][] = [];
  let line: SVGElement | null = null;
  let active: number | null = null;

  const local = (e: PointerEvent): [number, number] => {
    const r = drawing.getBoundingClientRect();
    return [((e.clientX - r.left) * size) / r.width, ((e.clientY - r.top) * size) / r.height];
  };
  const redraw = () => line?.setAttribute('points', screen.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));

  drawing.addEventListener('pointerdown', (e) => {
    if (done || dead || active !== null) return;
    e.preventDefault();
    active = e.pointerId;
    try {
      drawing.setPointerCapture(e.pointerId);
    } catch {
      // not capturable (synthetic event): still fine
    }
    for (const old of drawing.querySelectorAll('polyline')) old.remove();
    screen = [local(e)];
    line = svg('polyline', { fill: 'none', stroke: token('--ink-soft'), 'stroke-width': penWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    drawing.append(line);
    redraw();
  });
  drawing.addEventListener('pointermove', (e) => {
    if (active !== e.pointerId) return;
    e.preventDefault();
    screen.push(local(e));
    redraw();
  });
  const end = (e: PointerEvent) => {
    if (active !== e.pointerId) return;
    active = null;
    const drag = screen;
    screen = [];
    if (drag.length < 2 || done || dead) {
      line?.remove();
      return;
    }
    // A drag that wanders far off the pad is not sent (the room would refuse it): ask for one inside the box.
    if (!insideBox(drag, size)) {
      line?.remove();
      onOutside();
      return;
    }
    line?.classList.add('sent');
    onStroke(thinPoints(drag.map(([x, y]) => toCharPoint(x, y, size, pad)), GAME.maxStrokePoints));
  };
  drawing.addEventListener('pointerup', end);
  drawing.addEventListener('pointercancel', end);

  const clearLine = () => drawing.querySelectorAll('polyline').forEach((n) => n.remove());
  const showAnswer = (answer: string | null, color: string, cls: string) => {
    root.querySelectorAll(`svg.${cls}`).forEach((n) => n.remove());
    if (answer) root.insertBefore(pathsLayer([{ d: answer, fill: color }], size, `strokes ${cls}`), drawing);
  };

  return {
    root,
    showRight(answer) {
      done = true;
      clearLine();
      root.classList.add('right');
      root.querySelectorAll('svg.hint').forEach((n) => n.remove());
      showAnswer(answer, ink, 'filled');
    },
    wiggle() {
      clearLine();
      root.classList.remove('wiggle');
      void root.offsetWidth;
      root.classList.add('wiggle');
    },
    flashHint(answer) {
      showAnswer(answer, token('--pink'), 'hint');
      const layer = root.querySelector('svg.hint');
      layer?.classList.add('flash');
    },
    reveal(answer) {
      done = true;
      clearLine();
      showAnswer(answer, token('--pink-deep'), 'answer');
    },
    destroy() {
      dead = true;
      root.remove();
    },
  };
}
