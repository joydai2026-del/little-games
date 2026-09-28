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
import type { CharList, RoomState } from '../src/shared/types';

const T0 = 1_800_000_000_000;
const GO = T0 + GAME.countdownSeconds * 1000;
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

function trace(s: RoomState, id: string, charIndex: number, strokes: number, at: number): RoomState {
  for (let i = 0; i < strokes; i++) {
    const r = submitStroke(s, id, { charIndex, strokeIndex: i, result: 'correct' }, at);
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
});

describe('race', () => {
  it('start sets the countdown, the clock and the characters', () => {
    const s = racing();
    expect(s.phase).toBe('racing');
    expect(s.roundChars).toEqual(['人', '口']);
    expect(s.goAt).toBe(GO);
    expect(s.endsAt).toBe(GO + 2 * 20 * 1000);
    expect(nextAlarmAt(s, T0)).toBe(s.endsAt);
  });

  it('refuses strokes before GO, out of order, and past the stroke count', () => {
    const s = racing();
    expect(submitStroke(s, 'k1', { charIndex: 0, strokeIndex: 0, result: 'correct' }, T0).error).toMatch(/GO/);
    expect(submitStroke(s, 'k1', { charIndex: 0, strokeIndex: 1, result: 'correct' }, GO).error).toMatch(/order/);
    expect(submitStroke(s, 'k1', { charIndex: 1, strokeIndex: 0, result: 'correct' }, GO).error).toMatch(/first/);
    expect(submitStroke(s, 'k1', { charIndex: 0, strokeIndex: 5, result: 'mistake' }, GO).status).toBe(400);
    expect(submitStroke(s, 't', { charIndex: 0, strokeIndex: 0, result: 'correct' }, GO).status).toBe(403);
  });

  it('correct strokes advance, finishing a character moves to the next, mistakes count', () => {
    let s = racing();
    s = submitStroke(s, 'k1', { charIndex: 0, strokeIndex: 0, result: 'mistake' }, GO).state;
    s = trace(s, 'k1', 0, 2, GO + 100);
    expect(s.progress.k1).toMatchObject({ charIndex: 1, strokeIndex: 0, charsDone: 1, mistakes: 1 });
  });

  it('a repeated stroke (retry or reload) changes nothing and is not an error', () => {
    let s = trace(racing(), 'k1', 0, 1, GO);
    const r = submitStroke(s, 'k1', { charIndex: 0, strokeIndex: 0, result: 'correct' }, GO + 5);
    expect(r.error).toBeUndefined();
    expect(r.duplicate).toBe(true);
    expect(r.state).toBe(s);
  });

  it('ends when every kid finishes', () => {
    let s = racing();
    s = trace(s, 'k1', 0, 2, GO + 10);
    s = trace(s, 'k1', 1, 3, GO + 20);
    expect(s.phase).toBe('racing');
    expect(s.progress.k1.finishedAt).toBe(GO + 20);
    s = trace(s, 'k2', 0, 2, GO + 30);
    s = trace(s, 'k2', 1, 3, GO + 40);
    expect(s.phase).toBe('done');
  });

  it('ends when the clock runs out, and not before', () => {
    const s = racing();
    expect(advanceIfDue(s, s.endsAt! - 1)).toBe(s);
    const done = advanceIfDue(s, s.endsAt!);
    expect(done.phase).toBe('done');
    expect(submitStroke(done, 'k1', { charIndex: 0, strokeIndex: 0, result: 'correct' }, s.endsAt!).status).toBe(409);
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

  it('kids who join mid-race can race', () => {
    let s = join(racing(), { id: 'k3', name: 'Ava', agent: true }, GO).state;
    s = trace(s, 'k3', 0, 1, GO + 1);
    expect(s.progress.k3.strokeIndex).toBe(1);
    expect(s.players.find((p) => p.id === 'k3')?.agent).toBe(true);
  });
});

describe('scoring', () => {
  it('more characters first, then fewer mistakes, then earlier', () => {
    let s = join(racing(), { id: 'k3', name: 'Ava' }, T0).state;
    s = trace(s, 'k2', 0, 2, GO + 50); // Leo: 1 char, 0 mistakes, later
    s = trace(s, 'k1', 0, 2, GO + 10); // Mia: 1 char, 0 mistakes, earlier
    s = submitStroke(s, 'k3', { charIndex: 0, strokeIndex: 0, result: 'mistake' }, GO).state;
    s = trace(s, 'k3', 0, 2, GO + 5); // Ava: 1 char, 1 mistake
    const board = standings(s);
    expect(board.map((r) => r.name)).toEqual(['Mia', 'Leo', 'Ava']);
    expect(board.map((r) => r.place)).toEqual([1, 2, 3]);
    s = trace(s, 'k3', 1, 3, GO + 60); // Ava finishes both: wins despite the mistake
    expect(standings(s)[0].name).toBe('Ava');
    expect(standings(s)[0].finished).toBe(true);
  });

  it('parses stroke input strictly', () => {
    expect(parseStrokeInput({ charIndex: 0, strokeIndex: 1, result: 'correct' })).toEqual({ charIndex: 0, strokeIndex: 1, result: 'correct' });
    expect(parseStrokeInput({ charIndex: '0', strokeIndex: 1, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ charIndex: 0, strokeIndex: 1.5, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ charIndex: 0, strokeIndex: 1, result: 'win' })).toBeNull();
  });
});
