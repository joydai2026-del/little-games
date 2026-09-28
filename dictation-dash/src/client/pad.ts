// THE ONLY FILE THAT DRAWS STROKES AND READS THE FINGER.
//
// History: the first build ran Hanzi Writer 3.7.3's quiz on the phone, which
// needs the whole character (the answer) on the phone and let the phone decide
// what was right. Codex review of PR #20 ruled the ROOM grades every stroke
// from the drawn points and the phone never learns the word. So the phone runs
// no matcher and loads no third-party script: it draws what the room sends
// (accepted strokes in ink, Easy's faint outline, a hint after misses),
// records the finger, and sends the points. Same approach as Missing Stroke
// (missing-stroke/src/client/tracer.ts); grading is src/shared/matcher.ts.

import { GAME } from '../shared/config';
import { placement, toCharPoint, type Point } from '../shared/matcher';
import { h, svg, token } from './ui';

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
function pathsLayer(paths: string[], fill: string, size: number, cls: string): SVGElement {
  const { transform } = placement(size, padFor(size));
  return svg('svg', { class: cls, width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    svg('g', { transform }, paths.map((d) => svg('path', { d, fill }))),
  ]);
}

/** Keeps at most `max` points of a long drag, evenly spread, always with both ends. */
export function thinPoints(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const out: Point[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return out;
}

export interface PadView {
  /** Strokes the room accepted for this character, in ink. */
  ink: string[];
  /** Easy only: the whole character, faint. */
  outline: string[] | null;
  /** The hint stroke, after misses. */
  hint: string | null;
}

export interface PadHandle {
  root: HTMLElement;
  /** Redraws what the room says about this character. */
  show(view: PadView): void;
  /** The room said wrong: the pad wiggles. */
  wiggle(): void;
  /** Stop or start listening to the finger (while a stroke is being graded). */
  lock(on: boolean): void;
  destroy(): void;
}

export function startPad(opts: { size: number; level: string; view: PadView }, onStroke: (points: Point[]) => void): PadHandle {
  const size = opts.size;
  const pad = padFor(size);
  const root = h('div', { class: `pad-wrap pad-${opts.level}`, style: `width:${size}px;height:${size}px` });
  const layers = h('div', { class: 'layers' });
  const penWidth = Math.max(6, GAME.drawingWidth * placement(size, pad).scale);
  const drawing = svg('svg', { class: 'drawing', width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  root.append(grid(size), layers, drawing);
  let locked = false;
  let dead = false;
  let screen: [number, number][] = [];
  let line: SVGElement | null = null;
  let active: number | null = null;

  const show = (view: PadView) => {
    layers.replaceChildren(
      ...(view.outline ? [pathsLayer(view.outline, token('--outline-easy'), size, 'outline')] : []),
      ...(view.hint ? [pathsLayer([view.hint], token('--pink'), size, 'hint flash')] : []),
      pathsLayer(view.ink, token('--ink'), size, 'ink')
    );
    root.dataset.inked = String(view.ink.length);
  };
  show(opts.view);

  const local = (e: PointerEvent): [number, number] => {
    const r = drawing.getBoundingClientRect();
    return [((e.clientX - r.left) * size) / r.width, ((e.clientY - r.top) * size) / r.height];
  };
  const redraw = () => line?.setAttribute('points', screen.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));

  drawing.addEventListener('pointerdown', (e) => {
    if (locked || dead || active !== null) return;
    e.preventDefault();
    active = e.pointerId;
    try {
      drawing.setPointerCapture(e.pointerId);
    } catch {
      // synthetic event: still fine
    }
    drawing.querySelectorAll('polyline').forEach((n) => n.remove());
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
    const pts = screen.map(([x, y]) => toCharPoint(x, y, size, pad));
    screen = [];
    if (pts.length >= 2 && !locked && !dead) {
      locked = true;
      onStroke(thinPoints(pts, GAME.maxStrokePoints));
    } else line?.remove();
  };
  drawing.addEventListener('pointerup', end);
  drawing.addEventListener('pointercancel', end);

  return {
    root,
    show(view) {
      drawing.querySelectorAll('polyline').forEach((n) => n.remove());
      show(view);
    },
    wiggle() {
      drawing.querySelectorAll('polyline').forEach((n) => n.remove());
      root.classList.remove('wiggle');
      void root.offsetWidth;
      root.classList.add('wiggle');
    },
    lock(on) {
      locked = on;
      root.classList.toggle('busy', on);
    },
    destroy() {
      dead = true;
      root.remove();
    },
  };
}
