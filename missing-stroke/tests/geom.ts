// Real stroke data (hanzi-writer-data 2.0.1, byte-identical, sha256 in the manifest) for tests.
import shan from './fixtures/山.json';
import shui from './fixtures/水.json';
import huo from './fixtures/火.json';
import ren from './fixtures/人.json';
import kou from './fixtures/口.json';
import shi from './fixtures/十.json';
import yi from './fixtures/一.json';
import woRaw from './fixtures/wo-6211.json?raw';
import type { CharGeom } from '../src/shared/types';
import type { Point } from '../src/shared/matcher';

export const GEOM: Record<string, CharGeom> = {
  山: shan as CharGeom,
  水: shui as CharGeom,
  火: huo as CharGeom,
  人: ren as CharGeom,
  口: kou as CharGeom,
  十: shi as CharGeom,
  一: yi as CharGeom,
  我: JSON.parse(woRaw) as CharGeom,
};

const median = (char: string, i: number): Point[] => GEOM[char].medians[i].map(([x, y]) => ({ x, y }));

/** 'correct' = the hidden stroke drawn along its median; 'mistake' = a different stroke's median; 'backwards' = the right stroke drawn the wrong way. */
export function pointsFor(char: string, hidden: number, kind: 'correct' | 'mistake' | 'backwards'): Point[] {
  const n = GEOM[char].medians.length;
  if (kind === 'correct') return median(char, hidden);
  if (kind === 'backwards') return median(char, hidden).reverse();
  return median(char, (hidden + 1) % n);
}

/** Raw fixture bytes by character, for a fake upstream. */
export const RAW: Record<string, string> = {};
