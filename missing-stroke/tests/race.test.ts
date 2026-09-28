import { describe, expect, it } from 'vitest';
import { GAME, LEVELS, normalizeOptions } from '../src/shared/config';
import {
  advanceIfDue,
  charsForRound,
  createRoom,
  hiddenStrokeFor,
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
import type { CharList, RoomState } from '../src/shared/types';

const T0 = 1_800_000_000_000;
const SEED = 12345;
const LIST: CharList = { chars: ['山', '水', '火'], missing: [], strokeCounts: { 山: 3, 水: 4, 火: 4 }, repeats: 0, overflow: [] };

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
const send = (s: RoomState, id: string, seq: number, result: 'correct' | 'mistake', at: number, turn = s.turn!.index) =>
  submitStroke(s, id, { race: s.round, seq, turn, result }, at);

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
    expect(charsForRound(['a', 'b', 'c'], 1, 2)).toEqual(['c', 'a']);
    expect(charsForRound(['a'], 3, 5)).toEqual(['a']);
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

describe('start', () => {
  it('needs the teacher, a list and a kid who is here', () => {
    expect(startRace(withKids(room(), 'A'), 'A', T0, SEED).status).toBe(403);
    expect(startRace(room(), 'T', T0, SEED).status).toBe(409);
    const empty = room({}, { chars: [], missing: ['𠮷'], strokeCounts: {}, repeats: 0, overflow: [] });
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
    expect(submitStroke(s, 'A', { race: 9, seq: 1, turn: 0, result: 'correct' }, goAt() + 1000).error).toMatch(/different race/);
    expect(send(s, 'A', 1, 'correct', goAt() + 1000, 1).error).toBe('that character is over');
    expect(send(s, 'T', 1, 'correct', goAt() + 1000).status).toBe(403);
    expect(parseStrokeInput({ race: 1, seq: 0, turn: 0, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: -1, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, result: 'yes' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, turn: 0, result: 'mistake' })).toEqual({ race: 1, seq: 1, turn: 0, result: 'mistake' });
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
