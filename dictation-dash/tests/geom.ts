// Real stroke data (hanzi-writer-data 2.0.1, sha256-checked against the
// manifest when the fixture was made) for the characters the tests use.
import raw from './fixtures/geom.json';
import type { CharGeom } from '../src/shared/types';

export const GEOM = (raw as unknown as { chars: Record<string, CharGeom> }).chars;

/** The right stroke: the target's own median, as a kid's points. */
export const right = (ch: string, i: number) => GEOM[ch].medians[i].map(([x, y]) => ({ x, y }));
/** The same stroke drawn backwards. */
export const backwards = (ch: string, i: number) => [...right(ch, i)].reverse();
/** A different stroke of the same character. */
export const other = (ch: string, i: number, j: number) => right(ch, j === i ? (i + 1) % GEOM[ch].medians.length : j);
export const asPairs = (pts: { x: number; y: number }[]) => pts.map((p) => [p.x, p.y]);
