import { describe, expect, it } from 'vitest';
import { GAME, LEVELS, normalizeOptions } from '../src/shared/config';
import {
  advanceIfDue,
  charsForRound,
  createRoom,
  hiddenStrokeFor,
  hintAfterMisses,
  hintMissesLeft,
  join,
  nextAlarmAt,
  parseStrokeInput,
  publicView,
  setList,
  setOptions,
  standings,
  startRace,
  submitStroke,
  turnDeadline,
  touch,
} from '../src/shared/race';
import { gradeStroke, normalizedLength } from '../src/shared/matcher';
import type { CharGeom, CharList, RoomState } from '../src/shared/types';
import { GEOM, pointsFor } from './geom';

const T0 = 1_800_000_000_000;
const SEED = 12345;
const LIST: CharList = { chars: ['山', '水', '火'], missing: [], strokeCounts: { 山: 3, 水: 4, 火: 4 }, repeats: 0, overflow: [], skipped: [] };

function room(opts: Record<string, unknown> = {}, list = LIST): RoomState {
  return createRoom('ABCD', { id: 'T', name: 'Ms. Li' }, opts, list, T0);
}
function withKids(s: RoomState, ...ids: string[]): RoomState {
  for (const id of ids) s = join(s, { id, name: id }, T0).state;
  return s;
}
function started(opts: Record<string, unknown> = { level: 'big', charsPerRound: 3 }, ...ids: string[]) {
  const s = startRace(withKids(room(opts), ...(ids.length ? ids : ['A', 'B'])), 'T', T0, SEED);
  expect(s.error).toBeUndefined();
  return s.state;
}
const goAt = () => T0 + GAME.countdownSeconds * 1000;
/** Draws for real: 'correct' = the hidden stroke's median, 'mistake' = another stroke's median. The room grades it. */
const send = (s: RoomState, id: string, seq: number, result: 'correct' | 'mistake', at: number, turn = s.turn!.index) =>
  submitStroke(s, id, { race: s.round, seq, turn, points: pointsFor(s.turn!.char, s.turn!.hidden, result) }, at, GEOM[s.turn!.char] as CharGeom);

describe('options and list', () => {
  it('normalizes level and chars per round', () => {
    expect(normalizeOptions({ level: 'nope', charsPerRound: 999 })).toEqual({ level: 'middle', charsPerRound: 20 });
    expect(normalizeOptions({ level: 'little', charsPerRound: '3' })).toEqual({ level: 'little', charsPerRound: 3 });
  });
  it('only the teacher changes settings and the list, never mid-race', () => {
    const s = withKids(room(), 'A');
    expect(setOptions(s, 'A', { level: 'big' }).status).toBe(403);
    expect(setOptions(s, 'T', { level: 'big' }).state.options.level).toBe('big');
    const r = startRace(s, 'T', T0, SEED).state;
    expect(setOptions(r, 'T', { level: 'big' }).status).toBe(409);
    expect(setList(r, 'T', LIST).status).toBe(409);
  });
  it('race chunks wrap through the list without repeats inside a race', () => {
    expect(charsForRound(['a', 'b', 'c'], 0, 2)).toEqual(['a', 'b']);
    expect(charsForRound(['a', 'b', 'c'], 2, 2)).toEqual(['c', 'a']);
    expect(charsForRound(['a'], 3, 5)).toEqual(['a']);
  });
  it('changing characters per game between games never skips a character; a new list starts at its top', () => {
    const five: CharList = { chars: ['一', '二', '三', '四', '五'], missing: [], strokeCounts: { 一: 1, 二: 2, 三: 3, 四: 5, 五: 4 }, repeats: 0, overflow: [], skipped: [] };
    let s = startRace(withKids(room({ charsPerRound: 2 }, five), 'A'), 'T', T0, SEED).state;
    expect(s.roundChars).toEqual(['一', '二']);
    s = advanceIfDue(s, T0 + 10 * 60_000);
    s = setOptions(s, 'T', { charsPerRound: 3 }).state;
    s = startRace(touch(s, 'A', T0 + 10 * 60_000), 'T', T0 + 10 * 60_000, SEED).state;
    expect(s.roundChars).toEqual(['三', '四', '五']);
    s = advanceIfDue(s, T0 + 30 * 60_000);
    s = setList(s, 'T', LIST).state;
    s = startRace(touch(s, 'A', T0 + 30 * 60_000), 'T', T0 + 30 * 60_000, SEED).state;
    expect(s.roundChars).toEqual(['山', '水', '火']);
  });
  it('a room saved before listPos existed still starts a game from the top of its list', () => {
    const old = withKids(room(), 'A') as unknown as Record<string, unknown>;
    delete old.listPos;
    const s = startRace(old as unknown as RoomState, 'T', T0, SEED).state;
    expect(s.roundChars).toEqual(['山', '水', '火']);
    expect(s.listPos).toBe(0);
  });
  it('the room cap counts kids who are here, so a kid who left frees a seat', () => {
    let s = room();
    // Kids arrive over a few minutes (the per-room join rate is its own test).
    const at = (i: number) => T0 + Math.floor(i / 10) * GAME.joinWindowMs;
    for (let i = 0; i < GAME.maxKids; i++) s = touch(join(s, { id: `k${i}`, name: `Kid ${i}` }, at(i)).state, `k${i}`, at(GAME.maxKids));
    const full = at(GAME.maxKids) + 1;
    expect(join(s, { id: 'x', name: 'Extra' }, full).status).toBe(409);
    expect(join(s, { id: 'x', name: 'Extra' }, full + GAME.rosterActiveMs + 1).error).toBeUndefined();
  });
  it('a join flood across several rate windows cannot lock a real kid out: departed seats are reclaimed', () => {
    let s = startRace(withKids(room(), 'A'), 'T', T0, SEED).state;
    s = advanceIfDue(s, T0 + 10 * 60_000);
    let t = T0 + 10 * 60_000;
    let n = 0;
    // Eight minutes of a script joining at the room's full rate, never polling again.
    for (let win = 0; win < 8; win++, t += GAME.joinWindowMs) {
      for (let i = 0; i < GAME.joinsPerRoomPerWindow; i++) {
        const r = join(s, { id: `bot${n}`, name: `Bot ${n}` }, t + i);
        n += 1;
        if (!r.error) s = r.state;
      }
    }
    expect(n).toBeGreaterThan(GAME.maxPlayersEver);
    expect(s.players.length).toBeLessThanOrEqual(GAME.maxPlayersEver);
    // A real child arrives after the flood (the last burst went quiet a minute ago) and gets in.
    const real = join(s, { id: 'mia', name: 'Mia' }, t + GAME.joinWindowMs);
    expect(real.error).toBeUndefined();
    expect(real.state.players.some((p) => p.id === 'mia')).toBe(true);
    // Seats in the last game are never reclaimed.
    expect(real.state.players.some((p) => p.id === 'A')).toBe(true);
  });
  it('a burst of joins into one room is refused with a plain message, and the window moves on', () => {
    let s = room();
    for (let i = 0; i < GAME.joinsPerRoomPerWindow; i++) s = join(s, { id: `k${i}`, name: `Kid ${i}` }, T0 + i).state;
    const burst = join(s, { id: 'x', name: 'Extra' }, T0 + 100);
    expect(burst.status).toBe(429);
    expect(burst.error).toMatch(/wait a minute/);
    expect(join(s, { id: 'x', name: 'Extra' }, T0 + GAME.joinWindowMs + 100).error).toBeUndefined();
  });
});

describe('which stroke is hidden', () => {
  it('is always a real stroke of the character, and deterministic for a seed', () => {
    for (let n = 1; n <= 30; n++) {
      for (let i = 0; i < 20; i++) {
        const k = hiddenStrokeFor(n, SEED, i);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(n);
        expect(hiddenStrokeFor(n, SEED, i)).toBe(k);
      }
    }
    expect(hiddenStrokeFor(1, 99, 4)).toBe(0);
    expect(hiddenStrokeFor(0, 99, 4)).toBe(0);
  });
  it('spreads over every stroke across seeds (not always the first or last)', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 400; seed++) seen.add(hiddenStrokeFor(8, seed, 0));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('the race stores one hidden stroke per character, and the open turn carries it', () => {
    const s = started();
    expect(s.hidden).toEqual(s.roundChars.map((c, i) => hiddenStrokeFor(LIST.strokeCounts[c], SEED, i)));
    expect(s.turn).toMatchObject({ index: 0, char: '山', hidden: s.hidden[0], opensAt: goAt(), closedAt: null });
    expect(s.turn!.closesAt).toBe(goAt() + LEVELS.big.secondsPerChar * 1000);
  });
});

describe('hint timing', () => {
  it('each level sets when the hint shows, and a rebuilt pad keeps the misses already made', () => {
    expect(hintAfterMisses(normalizeOptions({ level: 'little' }))).toBe(LEVELS.little.hintAfterMisses);
    expect(hintAfterMisses(normalizeOptions({ level: 'big' }))).toBe(LEVELS.big.hintAfterMisses);
    expect(LEVELS.little.hintAfterMisses).toBeLessThanOrEqual(LEVELS.middle.hintAfterMisses);
    expect(LEVELS.middle.hintAfterMisses).toBeLessThanOrEqual(LEVELS.big.hintAfterMisses);
    expect(hintMissesLeft(3, 0)).toBe(3);
    expect(hintMissesLeft(3, 2)).toBe(1);
    expect(hintMissesLeft(3, 7)).toBe(1);
    expect(hintMissesLeft(1, -2)).toBe(1);
  });
  it('the per-character miss count the hint reads resets when the next character opens', () => {
    let s = started();
    s = send(s, 'A', 1, 'mistake', goAt() + 500).state;
    s = send(s, 'A', 2, 'mistake', goAt() + 900).state;
    expect(s.progress.A.turnMistakes).toBe(2);
    s = advanceIfDue(s, s.turn!.closesAt + GAME.revealMs);
    expect(s.progress.A).toMatchObject({ turn: 1, turnMistakes: 0, mistakes: 2 });
  });
});

describe('start', () => {
  it('needs the teacher, a list and a kid who is here', () => {
    expect(startRace(withKids(room(), 'A'), 'A', T0, SEED).status).toBe(403);
    expect(startRace(room(), 'T', T0, SEED).status).toBe(409);
    const empty = room({}, { chars: [], missing: ['𠮷'], strokeCounts: {}, repeats: 0, overflow: [], skipped: [] });
    expect(startRace(withKids(empty, 'A'), 'T', T0, SEED).error).toMatch(/no characters/);
    const gone = withKids(room(), 'A');
    expect(startRace(gone, 'T', T0 + GAME.rosterActiveMs + 1, SEED).status).toBe(409);
  });
  it('freezes the roster: only kids here now race', () => {
    let s = withKids(room(), 'A', 'B');
    s = touch(s, 'A', T0 + GAME.rosterActiveMs);
    const r = startRace(s, 'T', T0 + GAME.rosterActiveMs + 1, SEED).state;
    expect(Object.keys(r.progress)).toEqual(['A']);
  });
});

describe('answers', () => {
  it('refuses before GO, from another race, for another character, and bad input', () => {
    const s = started();
    expect(send(s, 'A', 1, 'correct', goAt() - 1).error).toBe('wait for GO');
    expect(submitStroke(s, 'A', { race: 9, seq: 1, turn: 0, points: pointsFor('山', s.turn!.hidden, 'correct') }, goAt() + 1000, GEOM['山']).error).toMatch(/different race/);
    expect(send(s, 'A', 1, 'correct', goAt() + 1000, 1).error).toBe('that character is over');
    expect(send(s, 'T', 1, 'correct', goAt() + 1000).status).toBe(403);
    const pts = [[1, 2], [30, 40]];
    expect(parseStrokeInput({ race: 1, seq: 0, turn: 0, points: pts })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: -1, points: pts })).toBeNull();
    // An assertion without a drawing is refused: the room grades strokes, it never takes a verdict.
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, result: 'correct', points: [[1, 2]] })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, points: [[1, 'x'], [2, 3]] })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, points: Array(GAME.maxStrokePoints + 1).fill([1, 2]) })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, points: pts })).toEqual({ race: 1, seq: 1, turn: 0, points: [{ x: 1, y: 2 }, { x: 30, y: 40 }] });
  });

  it('counts a wrong stroke once, even when the same send is retried', () => {
    let s = started();
    s = send(s, 'A', 1, 'mistake', goAt() + 500).state;
    const again = send(s, 'A', 1, 'mistake', goAt() + 600);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(s);
    expect(s.progress.A).toMatchObject({ mistakes: 1, turnMistakes: 1, seq: 1, rightAt: null });
    expect(send(s, 'A', 5000, 'mistake', goAt() + 700).status).toBe(400);
  });

  it('the pace floor refuses a right stroke that is too fast, then accepts it', () => {
    const s = started();
    expect(send(s, 'A', 1, 'correct', goAt() + GAME.minAnswerMs - 1).status).toBe(429);
    const ok = send(s, 'A', 1, 'correct', goAt() + GAME.minAnswerMs);
    expect(ok.error).toBeUndefined();
    expect(ok.state.progress.A).toMatchObject({ rights: 1, wins: 1, totalMs: GAME.minAnswerMs, rightAt: goAt() + GAME.minAnswerMs });
  });

  it('the fastest right stroke wins the character; later right strokes score but do not win', () => {
    let s = started();
    s = send(s, 'B', 1, 'correct', goAt() + 2000).state;
    s = send(s, 'A', 1, 'correct', goAt() + 2500).state;
    expect(s.progress.B.wins).toBe(1);
    expect(s.progress.A).toMatchObject({ wins: 0, rights: 1 });
    // Everyone has it: the character closes at the last right stroke and the reveal starts.
    expect(s.turn!.closedAt).toBe(goAt() + 2500);
    expect(s.results[0]).toEqual({ char: '山', hidden: s.hidden[0], winners: ['B'], times: { B: 2000, A: 2500 } });
    expect(send(s, 'A', 2, 'mistake', goAt() + 2600).error).toBe('that character is over');
  });

  it('an exact same-millisecond tie shares the win', () => {
    let s = started({ level: 'big', charsPerRound: 3 }, 'A', 'B', 'C');
    s = send(s, 'A', 1, 'correct', goAt() + 1500).state;
    s = send(s, 'B', 1, 'correct', goAt() + 1500).state;
    s = send(s, 'C', 1, 'correct', goAt() + 1501).state;
    expect(s.results[0].winners).toEqual(['A', 'B']);
    expect([s.progress.A.wins, s.progress.B.wins, s.progress.C.wins]).toEqual([1, 1, 0]);
    const board = standings(s);
    expect(board.map((r) => [r.playerId, r.place])).toEqual([['A', 1], ['B', 1], ['C', 3]]);
  });

  it('after a right stroke, more answers for that character are refused', () => {
    let s = started();
    s = send(s, 'A', 1, 'correct', goAt() + 1000).state;
    expect(send(s, 'A', 2, 'correct', goAt() + 1100).error).toBe('you already got this one');
  });

  it('a late joiner watches this race and is refused politely', () => {
    let s = started();
    s = join(s, { id: 'L', name: 'Late Leo' }, goAt()).state;
    expect(send(s, 'L', 1, 'correct', goAt() + 1000).error).toMatch(/next one/);
    expect(standings(s).map((r) => r.playerId)).not.toContain('L');
    // ...and races the next one.
    const done = advanceIfDue(s, goAt() + 10 * 60_000);
    expect(done.phase).toBe('done');
    const next = startRace(touch(touch(done, 'L', goAt() + 10 * 60_000), 'A', goAt() + 10 * 60_000), 'T', goAt() + 10 * 60_000, SEED + 1).state;
    expect(next.progress.L).toBeDefined();
    expect(next.round).toBe(2);
  });
});

describe('the clock', () => {
  it('closes on the clock when nobody gets it, reveals, then opens the next character with fresh per-character counters', () => {
    let s = started();
    s = send(s, 'A', 1, 'mistake', goAt() + 1000).state;
    const close = goAt() + LEVELS.big.secondsPerChar * 1000;
    expect(advanceIfDue(s, close - 1)).toBe(s);
    s = advanceIfDue(s, close);
    expect(s.turn).toMatchObject({ index: 0, closedAt: close, winners: [] });
    expect(s.results[0]).toMatchObject({ char: '山', winners: [], times: {} });
    s = advanceIfDue(s, close + GAME.revealMs);
    expect(s.turn).toMatchObject({ index: 1, char: '水', opensAt: close + GAME.revealMs, closedAt: null });
    expect(s.progress.A).toMatchObject({ mistakes: 1, turnMistakes: 0, turn: 1, rightAt: null });
  });

  it('after the first right stroke, the others get the grace time, not the whole clock', () => {
    let s = started();
    const first = goAt() + 1000;
    s = send(s, 'A', 1, 'correct', first).state;
    expect(turnDeadline(s.turn!)).toBe(first + GAME.graceAfterFirstRightMs);
    expect(nextAlarmAt(s, first)).toBe(first + GAME.graceAfterFirstRightMs);
    s = advanceIfDue(s, first + GAME.graceAfterFirstRightMs);
    expect(s.turn!.closedAt).toBe(first + GAME.graceAfterFirstRightMs);
    expect(nextAlarmAt(s, first)).toBe(first + GAME.graceAfterFirstRightMs + GAME.revealMs);
  });

  it('one late alarm catches up on every missed step and ends the race after the last reveal', () => {
    const s = started();
    const per = LEVELS.big.secondsPerChar * 1000 + GAME.revealMs;
    const end = goAt() + 3 * per;
    const late = advanceIfDue(s, end + 60_000);
    expect(late.phase).toBe('done');
    expect(late.endedAt).toBe(end);
    expect(late.results.map((r) => r.char)).toEqual(['山', '水', '火']);
    expect(late.version).toBe(s.version + 1);
    expect(nextAlarmAt(late, end + 60_000)).toBe(late.expiresAt);
  });

  it('the room never expires mid-race', () => {
    const s = started({ level: 'little', charsPerRound: 20 });
    const longest = goAt() + s.roundChars.length * (LEVELS.little.secondsPerChar * 1000 + GAME.revealMs);
    expect(s.expiresAt).toBeGreaterThan(longest);
  });
});

describe('scoring and the board', () => {
  it('ranks wins, then rights, then fewer mistakes, then less time; trying and missing never ranks below doing nothing', () => {
    let s = started({ level: 'big', charsPerRound: 2 }, 'A', 'B', 'C', 'D');
    // Character 1: C wins, B right slower with 1 mistake, A only misses, D does nothing.
    s = send(s, 'C', 1, 'correct', goAt() + 1000).state;
    s = send(s, 'B', 1, 'mistake', goAt() + 1200).state;
    s = send(s, 'B', 2, 'correct', goAt() + 2000).state;
    s = send(s, 'A', 1, 'mistake', goAt() + 2100).state;
    let board = standings(s);
    expect(board.map((r) => r.playerId)).toEqual(['C', 'B', 'A', 'D']);
    // A (missed, 0 right) and D (nothing) share 3rd: missing is not punished.
    expect(board.map((r) => r.place)).toEqual([1, 2, 3, 3]);
    expect(board.find((r) => r.playerId === 'A')).toMatchObject({ now: 'trying', nowMs: null });
    expect(board.find((r) => r.playerId === 'B')).toMatchObject({ now: 'right', nowMs: 2000 });
    expect(board.find((r) => r.playerId === 'D')).toMatchObject({ now: 'none' });

    // Character 2: B wins. Now B and C both have 1 win and 1 right... B has 2 rights.
    s = advanceIfDue(s, goAt() + 1000 + GAME.graceAfterFirstRightMs + GAME.revealMs);
    const open2 = s.turn!.opensAt;
    s = send(s, 'B', 3, 'correct', open2 + 900).state;
    board = standings(s);
    expect(board.map((r) => [r.playerId, r.wins, r.rights])).toEqual([['B', 1, 2], ['C', 1, 1], ['A', 0, 0], ['D', 0, 0]]);
  });

  it('same wins and rights: fewer mistakes first, then faster total time', () => {
    let s = started({ level: 'big', charsPerRound: 2 }, 'A', 'B', 'C');
    s = send(s, 'A', 1, 'correct', goAt() + 1000).state; // A wins char 1
    s = send(s, 'B', 1, 'correct', goAt() + 3000).state;
    s = send(s, 'C', 1, 'mistake', goAt() + 3100).state;
    s = send(s, 'C', 2, 'correct', goAt() + 3200).state;
    let b = standings(s);
    expect(b.map((r) => r.playerId)).toEqual(['A', 'B', 'C']);
    expect(b.map((r) => r.place)).toEqual([1, 2, 3]);
    // Same everything except time: B at 3000 ms beats D at 4000 ms.
    let t = started({ level: 'big', charsPerRound: 2 }, 'A', 'B', 'D');
    t = send(t, 'A', 1, 'correct', goAt() + 1000).state;
    t = send(t, 'D', 1, 'correct', goAt() + 4000).state;
    t = send(t, 'B', 1, 'correct', goAt() + 3000).state;
    b = standings(t);
    expect(b.map((r) => r.playerId)).toEqual(['A', 'B', 'D']);
  });

  it('the public view carries you, role, present and standings, never secrets', () => {
    const s = started();
    const v = publicView(s, 'A', goAt());
    expect(v).toMatchObject({ you: 'A', role: 'kid', serverNow: goAt() });
    expect(v.present).toEqual(['A', 'B']);
    expect(v.standings).toHaveLength(2);
  });
});

describe('the room grades strokes (real stroke data)', () => {
  it('right stroke, wrong stroke, backwards stroke, and a bare assertion', () => {
    for (const ch of ['山', '水', '火', '人', '口', '十', '我']) {
      const n = GEOM[ch].medians.length;
      for (let k = 0; k < n; k++) {
        expect(gradeStroke(pointsFor(ch, k, 'correct'), GEOM[ch].medians, k), `${ch} stroke ${k}`).toBe('correct');
        expect(gradeStroke(pointsFor(ch, k, 'backwards'), GEOM[ch].medians, k), `${ch} backwards ${k}`).toBe('mistake');
        expect(gradeStroke(pointsFor(ch, k, 'mistake'), GEOM[ch].medians, k), `${ch} other ${k}`).toBe('mistake');
      }
    }
    expect(gradeStroke([{ x: 500, y: 400 }], GEOM['山'].medians, 0)).toBe('mistake');
  });
  it('a missing MIDDLE stroke crossed by later strokes can still be drawn (我 stroke 2, 十 stroke 1 is crossed by stroke 2)', () => {
    expect(gradeStroke(pointsFor('我', 1, 'correct'), GEOM['我'].medians, 1)).toBe('correct');
    expect(gradeStroke(pointsFor('十', 0, 'correct'), GEOM['十'].medians, 0)).toBe('correct');
    // A human hand is not a median: a shaky, offset copy still passes; tracing the crossing stroke does not.
    const shaky = pointsFor('我', 1, 'correct').map((p, i) => ({ x: p.x + 18 * Math.sin(i), y: p.y - 22 }));
    expect(gradeStroke(shaky, GEOM['我'].medians, 1)).toBe('correct');
    expect(gradeStroke(pointsFor('我', 4, 'correct'), GEOM['我'].medians, 1)).toBe('mistake');
  });
  it('the reducer grades: a wrong drawing is a mistake even if the phone "thinks" it is right', () => {
    let s = started();
    const r = submitStroke(s, 'A', { race: s.round, seq: 1, turn: 0, points: pointsFor('山', s.turn!.hidden, 'backwards') }, goAt() + 2000, GEOM['山']);
    expect(r.verdict).toBe('mistake');
    s = r.state;
    expect(s.progress.A).toMatchObject({ mistakes: 1, rightAt: null });
    expect(submitStroke(s, 'A', { race: s.round, seq: 2, turn: 0, points: pointsFor('山', s.turn!.hidden, 'correct') }, goAt() + 2500, null).status).toBe(503);
  });
});

describe('the answer never reaches a phone', () => {
  it('no hidden index anywhere, the visible strokes have an unlabelled gap, the answer only when earned', () => {
    let s = started();
    const hidden = s.turn!.hidden;
    const g = GEOM['山'];
    for (const at of [T0, goAt() + 10]) {
      const v = publicView(s, 'A', at, g);
      expect('hidden' in v).toBe(false);
      expect('hidden' in v.turn!).toBe(false);
      expect(v.turn!.visible).toEqual(g.strokes.filter((_, i) => i !== hidden));
      expect(v.turn!.visible).toHaveLength(g.strokes.length - 1);
      expect(v.turn!.answer).toBeNull();
      const text = JSON.stringify(v);
      expect(text).not.toContain(g.strokes[hidden]);
      expect(text).not.toContain(JSON.stringify(g.medians[hidden]));
      expect(text).not.toMatch(/"hidden"/);
    }
    // The hint, once earned by this player only.
    for (let i = 0; i < LEVELS.big.hintAfterMisses; i++) s = send(s, 'A', i + 1, 'mistake', goAt() + 1000 + i * 100).state;
    expect(publicView(s, 'A', goAt() + 2000, g).turn).toMatchObject({ answer: g.strokes[hidden], hint: true });
    expect(publicView(s, 'B', goAt() + 2000, g).turn!.answer).toBeNull();
    expect(publicView(s, 'T', goAt() + 2000, g).turn!.answer).toBeNull();
    // Right: the player sees the stroke fill in; after the close, everyone sees it.
    s = send(s, 'B', 1, 'correct', goAt() + 3000).state;
    expect(publicView(s, 'B', goAt() + 3000, g).turn).toMatchObject({ answer: g.strokes[hidden], hint: false });
    const closed = advanceIfDue(s, goAt() + 3000 + GAME.graceAfterFirstRightMs);
    expect(publicView(closed, 'T', goAt() + 3000 + GAME.graceAfterFirstRightMs, g).turn!.answer).toBe(g.strokes[hidden]);
  });
});

describe('grading cost is bounded (crafted strokes)', () => {
  const g = GEOM['我'];
  const mid = (() => {
    const m = g.medians[1];
    const [x, y] = m[Math.floor(m.length / 2)];
    return { x, y };
  })();
  /** A figure eight that starts and ends on its own centre: near-zero Procrustes scale. */
  const eight = (r: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / (n - 1)) * 2 * Math.PI;
      return { x: mid.x + r * Math.sin(t), y: mid.y + r * Math.sin(t) * Math.cos(t) };
    });
  it('a stroke that returns to its own centre grades as a miss in under 20 ms, at every size', () => {
    // Warm the JIT once (the first call of any function is slow for reasons unrelated to input size).
    gradeStroke(eight(50, GAME.maxStrokePoints), g.medians, 1);
    for (const r of [30, 80, 200, 400]) {
      for (const n of [50, GAME.maxStrokePoints]) {
        const t0 = performance.now();
        const v = gradeStroke(eight(r, n), g.medians, 1);
        const ms = performance.now() - t0;
        expect(v).toBe('mistake');
        expect(ms, `r=${r} n=${n}`).toBeLessThan(20);
      }
    }
  });
  it('every real stroke stays under the normalized-length guard (so the guard never refuses a real stroke)', () => {
    for (const ch of Object.keys(GEOM)) for (const m of GEOM[ch].medians) expect(normalizedLength(m.map(([x, y]) => ({ x, y })))).toBeLessThan(5);
  });
  it('a dense zigzag along the stroke and a tiny scribble also grade fast', () => {
    const m = pointsFor('我', 1, 'correct');
    const zig = Array.from({ length: GAME.maxStrokePoints }, (_, i) => {
      const a = m[Math.min(m.length - 1, Math.floor((i / GAME.maxStrokePoints) * m.length))];
      return { x: a.x + (i % 2 ? 60 : -60), y: a.y + (i % 2 ? 60 : -60) };
    });
    const dot = Array.from({ length: 50 }, (_, i) => ({ x: mid.x + (i % 3), y: mid.y + (i % 2) }));
    gradeStroke(zig, g.medians, 1); // JIT warm-up
    for (const pts of [zig, dot]) {
      const t0 = performance.now();
      gradeStroke(pts, g.medians, 1);
      expect(performance.now() - t0).toBeLessThan(20);
    }
    expect(gradeStroke(dot, g.medians, 1)).toBe('mistake');
    expect(gradeStroke(Array(GAME.maxStrokePoints + 1).fill(mid), g.medians, 1)).toBe('mistake');
    expect(gradeStroke([mid, { x: NaN, y: 3 }], g.medians, 1)).toBe('mistake');
  });
});
