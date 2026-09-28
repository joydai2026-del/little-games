import { describe, expect, it } from 'vitest';
import {
  advanceIfDue,
  charsForRound,
  cleanName,
  createRoom,
  join,
  nextAlarmAt,
  parseStrokeInput,
  setList,
  setOptions,
  standings,
  startRace,
  submitStroke,
} from '../src/shared/race';
import { GAME } from '../src/shared/config';
import type { CharList, RoomState, StrokeResult } from '../src/shared/types';

const T0 = 1_800_000_000_000;
const GO = T0 + GAME.countdownSeconds * 1000;
const TTL = GAME.roomTtlMinutes * 60_000;
// Real stroke counts from hanzi-writer-data 2.0.1: 人 2, 口 3, 大 3.
const LIST: CharList = { chars: ['人', '口', '大'], missing: [], strokeCounts: { 人: 2, 口: 3, 大: 3 }, repeats: 0, overflow: [] };

function lobby(): RoomState {
  let s = createRoom('ABCD', { id: 't', name: 'Ms. Li' }, { charsPerRound: 2, secondsPerChar: 20 }, LIST, T0);
  s = join(s, { id: 'k1', name: 'Mia' }, T0).state;
  s = join(s, { id: 'k2', name: 'Leo' }, T0).state;
  return s;
}

function racing(): RoomState {
  return startRace(lobby(), 't', T0).state;
}

/** One stroke with the right race id and the next sequence number. */
function stroke(s: RoomState, id: string, charIndex: number, strokeIndex: number, result: StrokeResult, at: number, seq?: number) {
  return submitStroke(s, id, { race: s.round, seq: seq ?? (s.progress[id]?.seq ?? 0) + 1, charIndex, strokeIndex, result }, at);
}

/** Traces `n` correct strokes, one second apart from `from` (well above the pace floor). */
function trace(s: RoomState, id: string, charIndex: number, n: number, from: number): RoomState {
  for (let i = 0; i < n; i++) {
    const r = stroke(s, id, charIndex, s.progress[id].strokeIndex, 'correct', from + i * 1000);
    expect(r.error).toBeUndefined();
    s = r.state;
  }
  return s;
}

describe('lobby', () => {
  it('teacher is not a racer; kids join with clean, unique names', () => {
    let s = lobby();
    expect(s.players.map((p) => p.role)).toEqual(['teacher', 'kid', 'kid']);
    s = join(s, { id: 'k3', name: '  mia​ ' }, T0).state;
    expect(s.players[3].name).toBe('mia 2');
    expect(join(s, { id: 'k4', name: '   ' }, T0).error).toBeTruthy();
    expect(cleanName('A'.repeat(40))).toHaveLength(GAME.maxNameLength);
  });

  it('only the teacher starts, and only with a kid and a list', () => {
    expect(startRace(lobby(), 'k1', T0).status).toBe(403);
    const empty = createRoom('ABCD', { id: 't', name: '' }, undefined, LIST, T0);
    expect(startRace(empty, 't', T0).error).toMatch(/kid/);
    const noList = setList(lobby(), 't', { ...LIST, chars: [], strokeCounts: {} }).state;
    expect(startRace(noList, 't', T0).error).toMatch(/list/);
  });

  it('settings are clamped', () => {
    const s = setOptions(lobby(), 't', { secondsPerChar: 9999, charsPerRound: -3, hints: 'yes' }).state;
    expect(s.options).toEqual({ secondsPerChar: 120, charsPerRound: 1, hints: true });
    expect(setOptions(lobby(), 'k1', {}).status).toBe(403);
  });

  it('a full room refuses joins', () => {
    let s = lobby();
    for (let i = 0; s.players.length - 1 < GAME.maxKids; i++) s = join(s, { id: `x${i}`, name: `Kid ${i}` }, T0).state;
    expect(join(s, { id: 'late', name: 'Late' }, T0).error).toMatch(/full/);
  });
});

describe('race', () => {
  it('start sets the countdown, the clock, the characters, and pushes expiry past the race', () => {
    const s = racing();
    expect(s.phase).toBe('racing');
    expect(s.roundChars).toEqual(['人', '口']);
    expect(s.goAt).toBe(GO);
    expect(s.endsAt).toBe(GO + 2 * 20 * 1000);
    expect(s.expiresAt).toBe(s.endsAt! + TTL);
    expect(nextAlarmAt(s, T0)).toBe(s.endsAt);
  });

  it('refuses strokes before GO, out of order, past the stroke count, and from the teacher', () => {
    const s = racing();
    expect(stroke(s, 'k1', 0, 0, 'correct', T0).error).toMatch(/GO/);
    expect(stroke(s, 'k1', 0, 1, 'correct', GO + 1000).error).toMatch(/order/);
    expect(stroke(s, 'k1', 1, 0, 'correct', GO + 1000).error).toMatch(/character/);
    expect(stroke(s, 'k1', 0, 5, 'mistake', GO + 1000).status).toBe(400);
    expect(stroke(s, 't', 0, 0, 'correct', GO + 1000).status).toBe(403);
  });

  it('correct strokes advance, finishing a character moves to the next, mistakes count', () => {
    let s = racing();
    s = stroke(s, 'k1', 0, 0, 'mistake', GO + 500).state;
    s = trace(s, 'k1', 0, 2, GO + 1000);
    expect(s.progress.k1).toMatchObject({ charIndex: 1, strokeIndex: 0, charsDone: 1, mistakes: 1, seq: 3 });
  });

  it('a repeated sequence number is a no-op: a retried mistake counts once', () => {
    let s = racing();
    s = stroke(s, 'k1', 0, 0, 'mistake', GO + 500, 1).state;
    const again = stroke(s, 'k1', 0, 0, 'mistake', GO + 600, 1);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(s);
    expect(s.progress.k1.mistakes).toBe(1);
    const retriedCorrect = stroke(trace(s, 'k1', 0, 1, GO + 1000), 'k1', 0, 0, 'correct', GO + 2000, 2);
    expect(retriedCorrect.duplicate).toBe(true);
  });

  it('a stroke from an earlier race is refused and changes nothing', () => {
    const done = advanceIfDue(racing(), T0 + 10 ** 7);
    const race2 = startRace(done, 't', T0 + 10 ** 7).state;
    const goAt = race2.goAt!;
    const stale = submitStroke(race2, 'k1', { race: 1, seq: 1, charIndex: 0, strokeIndex: 0, result: 'correct' }, goAt + 1000);
    expect(stale.status).toBe(409);
    expect(stale.state.progress.k1.strokeIndex).toBe(0);
  });

  it('enforces the pace floor on correct strokes (a script cannot finish instantly)', () => {
    let s = racing();
    expect(stroke(s, 'k1', 0, 0, 'correct', GO).status).toBe(429);
    s = stroke(s, 'k1', 0, 0, 'correct', GO + GAME.minStrokeMs).state;
    expect(stroke(s, 'k1', 0, 1, 'correct', GO + 2 * GAME.minStrokeMs - 1).status).toBe(429);
    // A burst after a slow network is fine as long as the average pace holds.
    s = racing();
    s = stroke(s, 'k1', 0, 0, 'correct', GO + 5000).state;
    expect(stroke(s, 'k1', 0, 1, 'correct', GO + 5001).error).toBeUndefined();
  });

  it('ends when every racer finishes', () => {
    let s = racing();
    s = trace(s, 'k1', 0, 2, GO + 1000);
    s = trace(s, 'k1', 1, 3, GO + 3000);
    expect(s.phase).toBe('racing');
    expect(s.progress.k1.finishedAt).toBe(GO + 5000);
    s = trace(s, 'k2', 0, 2, GO + 1000);
    s = trace(s, 'k2', 1, 3, GO + 6000);
    expect(s.phase).toBe('done');
  });

  it('ends when the clock runs out, not before, and keeps the room alive after', () => {
    const s = racing();
    expect(advanceIfDue(s, s.endsAt! - 1)).toBe(s);
    const done = advanceIfDue(s, s.endsAt!);
    expect(done.phase).toBe('done');
    expect(done.expiresAt).toBe(s.endsAt! + TTL);
    expect(stroke(done, 'k1', 0, 0, 'correct', s.endsAt!).status).toBe(409);
  });

  it('race again takes the next characters, wrapping around the list', () => {
    expect(charsForRound(['人', '口', '大'], 0, 2)).toEqual(['人', '口']);
    expect(charsForRound(['人', '口', '大'], 1, 2)).toEqual(['大', '人']);
    expect(charsForRound(['人'], 3, 5)).toEqual(['人']);
    const done = advanceIfDue(racing(), T0 + 10 ** 7);
    const again = startRace(done, 't', T0 + 10 ** 7).state;
    expect(again.round).toBe(2);
    expect(again.roundChars).toEqual(['大', '人']);
    expect(again.progress.k1.charsDone).toBe(0);
  });

  it('a kid who joins mid-race waits for the next race and does not block the finish', () => {
    let s = join(racing(), { id: 'k3', name: 'Ava', agent: true }, GO).state;
    expect(stroke(s, 'k3', 0, 0, 'correct', GO + 1000).error).toMatch(/next one/);
    expect(standings(s).map((r) => r.name)).toEqual(['Mia', 'Leo']);
    s = trace(s, 'k1', 0, 2, GO + 1000);
    s = trace(s, 'k1', 1, 3, GO + 3000);
    s = trace(s, 'k2', 0, 2, GO + 1000);
    s = trace(s, 'k2', 1, 3, GO + 6000);
    expect(s.phase).toBe('done');
    const next = startRace(s, 't', GO + 20_000).state;
    expect(next.progress.k3).toBeDefined();
  });
});

describe('scoring', () => {
  it('characters, then strokes into the current one, then mistakes, then time', () => {
    let s = join(lobby(), { id: 'k3', name: 'Ava' }, T0).state;
    s = startRace(s, 't', T0).state;
    s = trace(s, 'k2', 0, 2, GO + 2000); // Leo: 1 char at GO+3000
    s = trace(s, 'k1', 0, 2, GO + 1000); // Mia: 1 char at GO+2000, earlier
    s = stroke(s, 'k3', 0, 0, 'mistake', GO + 500).state;
    s = trace(s, 'k3', 0, 2, GO + 1000); // Ava: 1 char at GO+2000, 1 mistake
    // Same characters and strokes: fewer mistakes beats earlier time.
    expect(standings(s).map((r) => r.name)).toEqual(['Mia', 'Leo', 'Ava']);
    // Leo keeps going: 1 stroke into 口 beats everyone who stopped, whatever the time.
    s = trace(s, 'k2', 1, 1, GO + 9000);
    const board = standings(s);
    expect(board.map((r) => r.name)).toEqual(['Leo', 'Mia', 'Ava']);
    expect(board.map((r) => r.place)).toEqual([1, 2, 3]);
  });

  it('exact ties share a place, and place uses the same key as the order', () => {
    let s = startRace(lobby(), 't', T0).state;
    const board = standings(s);
    expect(board.map((r) => r.place)).toEqual([1, 1]);
    s = trace(s, 'k1', 0, 1, GO + 1000);
    s = trace(s, 'k2', 0, 1, GO + 1000);
    expect(standings(s).map((r) => r.place)).toEqual([1, 1]);
  });

  it('parses stroke input strictly', () => {
    expect(parseStrokeInput({ race: 1, seq: 1, charIndex: 0, strokeIndex: 1, result: 'correct' })).toEqual({ race: 1, seq: 1, charIndex: 0, strokeIndex: 1, result: 'correct' });
    expect(parseStrokeInput({ charIndex: 0, strokeIndex: 1, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 0, charIndex: 0, strokeIndex: 1, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, charIndex: '0', strokeIndex: 1, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, charIndex: 0, strokeIndex: 1.5, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, charIndex: 0, strokeIndex: 1, result: 'win' })).toBeNull();
  });
});
