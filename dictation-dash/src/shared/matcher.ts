// Stroke grading, shared by the room (Worker), solo mode and tests. The room
// grades every answer: a phone or an agent sends the POINTS it drew, never a
// verdict.
//
// This is a port of Hanzi Writer 3.7.3's stroke matcher (MIT, Copyright (c)
// 2014 David Chanin, https://github.com/chanind/hanzi-writer), unchanged in
// its thresholds, so a stroke that passed on the old in-browser pad passes
// here. One deliberate change: the "a different stroke fits better" guard
// checks EVERY other stroke of the character, not only later ones, because in
// Missing Stroke all the other strokes are already on screen, and tracing one
// of them is a wrong answer.
//
// Coordinates are the stroke data's own (1024 wide, y up), the same space as
// the medians in hanzi-writer-data.

import { GAME } from './config';

export interface Point {
  x: number;
  y: number;
}

const COSINE_SIMILARITY_THRESHOLD = 0; // -1 to 1, smaller = more lenient
const START_AND_END_DIST_THRESHOLD = 250; // bigger = more lenient
const FRECHET_THRESHOLD = 0.4; // bigger = more lenient
const MIN_LEN_THRESHOLD = 0.35; // smaller = more lenient
const AVERAGE_DISTANCE_THRESHOLD = 350;
const SHAPE_FIT_ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, (-1 * Math.PI) / 32, (-1 * Math.PI) / 16];

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const magnitude = (p: Point) => Math.sqrt(p.x * p.x + p.y * p.y);
const distance = (a: Point, b: Point) => magnitude(subtract(a, b));
const equals = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const average = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const last = <T>(xs: T[]): T => xs[xs.length - 1];

function length(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i], points[i - 1]);
  return total;
}

function cosineSimilarity(a: Point, b: Point): number {
  return (a.x * b.x + a.y * b.y) / magnitude(a) / magnitude(b);
}

function extendPointOnLine(p1: Point, p2: Point, dist: number): Point {
  const v = subtract(p2, p1);
  const norm = dist / magnitude(v);
  return { x: p2.x + norm * v.x, y: p2.y + norm * v.y };
}

function frechetDist(curve1: Point[], curve2: Point[]): number {
  const longCurve = curve1.length >= curve2.length ? curve1 : curve2;
  const shortCurve = curve1.length >= curve2.length ? curve2 : curve1;
  let prev: number[] = [];
  for (let i = 0; i < longCurve.length; i++) {
    const cur: number[] = [];
    for (let j = 0; j < shortCurve.length; j++) {
      const d = distance(longCurve[i], shortCurve[j]);
      if (i === 0 && j === 0) cur.push(d);
      else if (i > 0 && j === 0) cur.push(Math.max(prev[0], d));
      else if (i === 0 && j > 0) cur.push(Math.max(cur[cur.length - 1], d));
      else cur.push(Math.max(Math.min(prev[j], prev[j - 1], cur[cur.length - 1]), d));
    }
    prev = cur;
  }
  return prev[shortCurve.length - 1];
}

function subdivideCurve(curve: Point[], maxLen = 0.05): Point[] {
  const out = curve.slice(0, 1);
  for (const point of curve.slice(1)) {
    const prevPoint = last(out);
    const segLen = distance(point, prevPoint);
    if (segLen > maxLen) {
      const n = Math.ceil(segLen / maxLen);
      const newSegLen = segLen / n;
      for (let i = 0; i < n; i++) out.push(extendPointOnLine(point, prevPoint, -1 * newSegLen * (i + 1)));
    } else out.push(point);
  }
  return out;
}

function outlineCurve(curve: Point[], numPoints = 30): Point[] {
  const segmentLen = length(curve) / (numPoints - 1);
  const outline = [curve[0]];
  const endPoint = last(curve);
  const remaining = curve.slice(1);
  for (let i = 0; i < numPoints - 2; i++) {
    let lastPoint = last(outline);
    let remainingDist = segmentLen;
    for (;;) {
      if (remaining.length === 0) break;
      const nextDist = distance(lastPoint, remaining[0]);
      if (nextDist < remainingDist) {
        remainingDist -= nextDist;
        lastPoint = remaining.shift()!;
      } else {
        outline.push(extendPointOnLine(lastPoint, remaining[0], remainingDist - nextDist));
        break;
      }
    }
  }
  outline.push(endPoint);
  return outline;
}

function normalizeCurve(curve: Point[]): Point[] {
  const outlined = outlineCurve(curve);
  const mean = { x: average(outlined.map((p) => p.x)), y: average(outlined.map((p) => p.y)) };
  const translated = outlined.map((p) => subtract(p, mean));
  const scale = Math.sqrt(average([translated[0].x ** 2 + translated[0].y ** 2, last(translated).x ** 2 + last(translated).y ** 2]));
  return subdivideCurve(translated.map((p) => ({ x: p.x / scale, y: p.y / scale })));
}

function rotate(curve: Point[], theta: number): Point[] {
  return curve.map((p) => ({ x: Math.cos(theta) * p.x - Math.sin(theta) * p.y, y: Math.sin(theta) * p.x + Math.cos(theta) * p.y }));
}

function stripDuplicates(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (const p of points.slice(1)) if (!equals(p, last(out))) out.push(p);
  return out;
}

const averageDistanceTo = (stroke: Point[], points: Point[]) =>
  points.reduce((acc, p) => acc + Math.min(...stroke.map((s) => distance(s, p))), 0) / points.length;

function shapeFit(a: Point[], b: Point[], leniency: number): boolean {
  const na = normalizeCurve(a);
  const nb = normalizeCurve(b);
  let min = Infinity;
  for (const theta of SHAPE_FIT_ROTATIONS) min = Math.min(min, frechetDist(na, rotate(nb, theta)));
  return min <= FRECHET_THRESHOLD * leniency;
}

function directionMatches(points: Point[], stroke: Point[]): boolean {
  const edges = points.slice(1).map((p, i) => subtract(p, points[i]));
  const vectors = stroke.slice(1).map((p, i) => subtract(p, stroke[i]));
  const sims = edges.map((e) => Math.max(...vectors.map((v) => cosineSimilarity(v, e))));
  return average(sims) > COSINE_SIMILARITY_THRESHOLD;
}

interface MatchData {
  isMatch: boolean;
  avgDist: number;
  backwards: boolean;
}

function matchData(points: Point[], stroke: Point[], strokeNum: number, leniency: number, checkBackwards = true): MatchData {
  const avgDist = averageDistanceTo(stroke, points);
  const distMod = strokeNum > 0 ? 0.5 : 1;
  if (avgDist > AVERAGE_DISTANCE_THRESHOLD * distMod * leniency) return { isMatch: false, avgDist, backwards: false };
  const startEnd =
    distance(stroke[0], points[0]) <= START_AND_END_DIST_THRESHOLD * leniency &&
    distance(last(stroke), last(points)) <= START_AND_END_DIST_THRESHOLD * leniency;
  const isMatch =
    startEnd &&
    directionMatches(points, stroke) &&
    shapeFit(points, stroke, leniency) &&
    (leniency * (length(points) + 25)) / (length(stroke) + 25) >= MIN_LEN_THRESHOLD;
  if (checkBackwards && !isMatch && matchData([...points].reverse(), stroke, strokeNum, leniency, false).isMatch) {
    return { isMatch: false, avgDist, backwards: true };
  }
  return { isMatch, avgDist, backwards: false };
}

export type Verdict = 'correct' | 'mistake';

/**
 * Is `points` (the drawn stroke) the stroke `target` of a character whose
 * strokes' medians are `medians`? A backwards stroke is a mistake.
 */
export function gradeStroke(points: Point[], medians: number[][][], target: number, leniency: number = GAME.leniency): Verdict {
  const strokes = medians.map((m) => m.map(([x, y]) => ({ x, y })));
  const drawn = stripDuplicates(points);
  if (drawn.length < 2 || !strokes[target]) return 'mistake';
  const main = matchData(drawn, strokes[target], target, leniency);
  if (!main.isMatch) return 'mistake';
  // If another stroke fits the drawing better, it was probably that stroke: try again, stricter.
  let closest = main.avgDist;
  strokes.forEach((s, i) => {
    if (i === target) return;
    const other = matchData(drawn, s, i, leniency, false);
    if (other.isMatch && other.avgDist < closest) closest = other.avgDist;
  });
  if (closest < main.avgDist) {
    const adjust = (0.6 * (closest + main.avgDist)) / (2 * main.avgDist);
    return matchData(drawn, strokes[target], target, leniency * adjust).isMatch ? 'correct' : 'mistake';
  }
  return 'correct';
}

/** Checks an untrusted list of points: 2..GAME.maxStrokePoints finite [x, y] pairs inside a loose box. */
export function parsePoints(raw: unknown): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > GAME.maxStrokePoints) return null;
  const out: Point[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(x) > 4096 || Math.abs(y) > 4096) return null;
    out.push({ x, y });
  }
  return out;
}

/**
 * The same placement Hanzi Writer uses: every character sits in the box from
 * (0, -124) to (1024, 900), scaled to fit `size` minus `padding`, y flipped.
 */
export function placement(size: number, padding: number): { scale: number; x: number; y: number; transform: string } {
  const from = { x: 0, y: -124 };
  const pre = 1024;
  const eff = size - 2 * padding;
  const scale = eff / pre;
  const x = -from.x * scale + padding + (eff - scale * pre) / 2;
  const yOff = -from.y * scale + padding + (eff - scale * pre) / 2;
  return { scale, x, y: size - yOff, transform: `translate(${x}, ${size - yOff}) scale(${scale}, ${-scale})` };
}

/** Screen point on the pad -> stroke data coordinates. */
export function toCharPoint(px: number, py: number, size: number, padding: number): Point {
  const p = placement(size, padding);
  return { x: (px - p.x) / p.scale, y: (p.y - py) / p.scale };
}
