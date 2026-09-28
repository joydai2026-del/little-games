import { describe, expect, it } from 'vitest';
import {
  advanceIfDue,
  createRoom,
  join,
  nextAlarmAt,
  parseSkipInput,
  parseStrokeInput,
  publicView,
  roundMs,
  setList,
  setOptions,
  skipWord,
  standings,
  startRound,
  submitStroke,
  touch,
  wordToSay,
  wordsForRound,
} from '../src/shared/dash';
import { GAME } from '../src/shared/config';
import type { RoomState, StrokeResult, WordList } from '../src/shared/types';

const T0 = 1_800_000_000_000;
const GO = T0 + GAME.countdownSeconds * 1000;
// Real stroke counts from hanzi-writer-data 2.0.1: 人 2, 口 3, 大 3, 上 3, 下 3.
const LIST: WordList = {
  words: ['人口', '大', '上下'],
  missing: [],
  tooLong: [],
  strokeCounts: { 人: 2, 口: 3, 大: 3, 上: 3, 下: 3 },
  repeats: 0,
  overflow: [],
};

function lobby(options: Record<string, unknown> = { wordsPerRound: 2, secondsPerWord: 20 }): RoomState {
  let s = createRoom('ABCD', { id: 't', name: 'Ms. Li' }, 'class', options, LIST, T0);
  s = join(s, { id: 'k1', name: 'Mia' }, T0).state;
  s = join(s, { id: 'k2', name: 'Leo' }, T0).state;
  return s;
}
const racing = () => startRound(lobby(), 't', T0).state;

/** Writes strokes for one player, `gap` ms apart from `from`. Returns the state and the next time. */
function write(s: RoomState, id: string, n: number, from: number, gap = 300, result: StrokeResult = 'correct'): { s: RoomState; at: number } {
  let at = from;
  for (let i = 0; i < n; i++) {
    const p = s.progress[id];
    const r = submitStroke(s, id, { race: s.round, seq: p.seq + 1, wordIndex: p.wordIndex, charIndex: p.charIndex, strokeIndex: p.strokeIndex, result }, at);
    expect(r.error).toBeUndefined();
    s = r.state;
    at += gap;
  }
  return { s, at };
}

describe('rooms and rounds', () => {
  it('a class room has a teacher; a solo room has one writer who is the host, and refuses joins', () => {
    const solo = createRoom('SOLO', { id: 'me', name: '' }, 'solo', { level: 'hard' }, LIST, T0);
    expect(solo.players[0]).toMatchObject({ role: 'kid', name: 'Me' });
    expect(solo.options.level).toBe('hard');
    expect(join(solo, { id: 'x', name: 'Zed' }, T0).status).toBe(409);
    const r = startRound(solo, 'me', T0);
    expect(r.state.phase).toBe('racing');
    expect(Object.keys(r.state.progress)).toEqual(['me']);
  });

  it('only the host starts, sets the level and the list; nothing changes mid-round', () => {
    const s = lobby();
    expect(startRound(s, 'k1', T0).status).toBe(403);
    expect(setOptions(s, 'k1', { level: 'hard' }).status).toBe(403);
    const hard = setOptions(s, 't', { level: 'hard', secondsPerWord: 9999, wordsPerRound: 'x' }).state;
    expect(hard.options).toEqual({ level: 'hard', secondsPerWord: 120, wordsPerRound: 2 });
    expect(setOptions(hard, 't', { level: 'impossible' }).state.options.level).toBe('hard');
    const r = racing();
    expect(setOptions(r, 't', { level: 'easy' }).status).toBe(409);
    expect(setList(r, 't', LIST).status).toBe(409);
  });

  it('rounds take the next words in order, wrapping, never repeating inside a round', () => {
    expect(wordsForRound(['a', 'b', 'c'], 0, 2)).toEqual(['a', 'b']);
    expect(wordsForRound(['a', 'b', 'c'], 1, 2)).toEqual(['c', 'a']);
    expect(wordsForRound(['a'], 3, 5)).toEqual(['a']);
    expect(wordsForRound([], 0, 5)).toEqual([]);
  });

  it('the round clock is (seconds per word + hearing slack) x words, after the countdown', () => {
    const s = racing();
    expect(s.roundWords).toEqual(['人口', '大']);
    expect(s.goAt).toBe(GO);
    expect(s.endsAt).toBe(GO + roundMs(s.options, 2));
    expect(roundMs(s.options, 2)).toBe((20 + GAME.hearSlackSeconds) * 2000);
    expect(nextAlarmAt(s, T0)).toBe(s.endsAt);
  });

  it('refuses to start with no words or nobody here', () => {
    const empty = createRoom('ABCD', { id: 't', name: 'T' }, 'class', {}, { ...LIST, words: [] }, T0);
    expect(startRound(join(empty, { id: 'k', name: 'K' }, T0).state, 't', T0).status).toBe(409);
    expect(startRound(createRoom('ABCD', { id: 't', name: 'T' }, 'class', {}, LIST, T0), 't', T0).status).toBe(409);
    // A kid whose phone went quiet is not in the roster.
    const stale = lobby();
    const r = startRound(touch(stale, 'k1', T0 + GAME.rosterActiveMs + 1), 't', T0 + GAME.rosterActiveMs + 1).state;
    expect(Object.keys(r.progress)).toEqual(['k1']);
  });
});

describe('per-character progress and stroke accounting', () => {
  it('walks stroke by stroke through each character of a word, then to the next word', () => {
    let s = racing();
    ({ s } = write(s, 'k1', 2, GO + 1000)); // 人 done
    expect(s.progress.k1).toMatchObject({ wordIndex: 0, charIndex: 1, strokeIndex: 0, strokesDone: 2, wordsDone: 0 });
    ({ s } = write(s, 'k1', 3, GO + 2000)); // 口 done -> word 1 (人口) written
    expect(s.progress.k1).toMatchObject({ wordIndex: 1, charIndex: 0, strokeIndex: 0, wordsDone: 1 });
  });

  it('a wrong stroke counts as a mistake and nothing else (no penalty beyond the wiggle)', () => {
    let s = racing();
    const r = submitStroke(s, 'k1', { race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'mistake' }, GO + 500);
    s = r.state;
    expect(s.progress.k1).toMatchObject({ mistakes: 1, strokeIndex: 0, strokesDone: 0 });
    // Same key as a kid who never missed.
    let a = write(racing(), 'k1', 2, GO + 1000).s;
    let b = write(s, 'k1', 2, GO + 1000).s;
    expect(standings(a).find((x) => x.playerId === 'k1')!.place).toBe(standings(b).find((x) => x.playerId === 'k1')!.place);
    expect(a.progress.k1.lastProgressAt).toBe(b.progress.k1.lastProgressAt);
  });

  it('a retried send (same seq) is a no-op; an out-of-order stroke is refused', () => {
    let s = write(racing(), 'k1', 1, GO + 1000).s;
    const again = submitStroke(s, 'k1', { race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' }, GO + 1100);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(s);
    expect(submitStroke(s, 'k1', { race: 1, seq: 2, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' }, GO + 1200).status).toBe(409);
    expect(submitStroke(s, 'k1', { race: 1, seq: 2, wordIndex: 1, charIndex: 0, strokeIndex: 1, result: 'correct' }, GO + 1200).error).toBe('that is not the word you are on');
    expect(submitStroke(s, 'k1', { race: 1, seq: 2, wordIndex: 0, charIndex: 1, strokeIndex: 1, result: 'correct' }, GO + 1200).error).toBe('that is not the character you are on');
    expect(submitStroke(s, 'k1', { race: 1, seq: 2, wordIndex: 0, charIndex: 0, strokeIndex: 9, result: 'correct' }, GO + 1200).status).toBe(400);
    expect(submitStroke(s, 'k1', { race: 1, seq: 5000, wordIndex: 0, charIndex: 0, strokeIndex: 1, result: 'correct' }, GO + 1200).status).toBe(400);
  });

  it('refuses strokes before GO, from another round, from the teacher, and faster than the pace floor', () => {
    const s = racing();
    const m = { race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' as const };
    expect(submitStroke(s, 'k1', m, GO - 1).error).toBe('wait for GO');
    expect(submitStroke(s, 'k1', { ...m, race: 2 }, GO + 1000).status).toBe(409);
    expect(submitStroke(s, 't', m, GO + 1000).status).toBe(403);
    expect(submitStroke(s, 'k1', m, GO + GAME.minStrokeMs - 1).status).toBe(429);
    expect(submitStroke(s, 'k1', m, GO + GAME.minStrokeMs).error).toBeUndefined();
  });

  it('parses only well-formed sends', () => {
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' })).not.toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 0, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: -1, charIndex: 0, strokeIndex: 0, result: 'correct' })).toBeNull();
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'yes' })).toBeNull();
    expect(parseSkipInput({ race: 1, seq: 1, wordIndex: 0 })).toEqual({ race: 1, seq: 1, wordIndex: 0 });
    expect(parseSkipInput({ race: 1, seq: 1 })).toBeNull();
  });
});

describe('skips', () => {
  it('a skip moves on, scores nothing, and shares the seq counter (a retried skip is a no-op)', () => {
    let s = write(racing(), 'k1', 1, GO + 1000).s;
    const r = skipWord(s, 'k1', { race: 1, seq: 2, wordIndex: 0 }, GO + 2000);
    s = r.state;
    expect(s.progress.k1).toMatchObject({ wordIndex: 1, charIndex: 0, strokeIndex: 0, wordsDone: 0, wordsSkipped: 1, seq: 2 });
    expect(skipWord(s, 'k1', { race: 1, seq: 2, wordIndex: 0 }, GO + 2100).duplicate).toBe(true);
    expect(skipWord(s, 'k1', { race: 1, seq: 3, wordIndex: 0 }, GO + 2100).status).toBe(409);
  });
  it('skipping the last word finishes; skipping can never lift anyone above a writer', () => {
    let s = racing();
    s = skipWord(s, 'k1', { race: 1, seq: 1, wordIndex: 0 }, GO + 100).state;
    s = skipWord(s, 'k1', { race: 1, seq: 2, wordIndex: 1 }, GO + 200).state;
    expect(s.progress.k1.finishedAt).toBe(GO + 200);
    s = write(s, 'k2', 1, GO + 5000).s;
    const b = standings(s);
    expect(b[0].playerId).toBe('k2');
    expect(b[1]).toMatchObject({ playerId: 'k1', finished: true, wordsSkipped: 2, wordsDone: 0 });
  });
});

describe('scoring and ties', () => {
  it('more words written wins; then more correct strokes; then who got there first', () => {
    let s = racing();
    ({ s } = write(s, 'k1', 5, GO + 1000)); // word 1 written
    ({ s } = write(s, 'k2', 4, GO + 1000)); // one stroke short
    expect(standings(s).map((r) => [r.playerId, r.place])).toEqual([['k1', 1], ['k2', 2]]);
    ({ s } = write(s, 'k2', 1, GO + 9000)); // k2 catches up, later
    expect(standings(s).map((r) => [r.playerId, r.place])).toEqual([['k1', 1], ['k2', 2]]);
  });
  it('an exact tie shares a place', () => {
    let s = racing();
    ({ s } = write(s, 'k1', 2, GO + 1000));
    ({ s } = write(s, 'k2', 2, GO + 1000));
    expect(standings(s).map((r) => r.place)).toEqual([1, 1]);
    expect(standings(racing()).map((r) => r.place)).toEqual([1, 1]);
  });
});

describe('round end and late joiners', () => {
  it('ends when everyone has finished', () => {
    let s = racing();
    for (const id of ['k1', 'k2']) {
      ({ s } = write(s, id, 8, GO + 1000)); // 人口 (5) + 大 (3)
      expect(s.progress[id].finishedAt).not.toBeNull();
    }
    expect(s.phase).toBe('done');
    expect(standings(s).every((r) => r.finished && r.wordsDone === 2)).toBe(true);
  });
  it('ends on the clock, and a stroke after the end is refused', () => {
    const s = racing();
    expect(advanceIfDue(s, s.endsAt! - 1)).toBe(s);
    const done = advanceIfDue(s, s.endsAt!);
    expect(done.phase).toBe('done');
    expect(done.expiresAt).toBeGreaterThanOrEqual(s.endsAt! + GAME.roomTtlMinutes * 60_000);
    expect(submitStroke(done, 'k1', { race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' }, s.endsAt! + 1).status).toBe(409);
  });
  it('a kid who joins mid-round watches, is not on the board, and writes the next round', () => {
    let s = racing();
    s = join(s, { id: 'late', name: 'Late Leo' }, GO + 100).state;
    expect(submitStroke(s, 'late', { race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' }, GO + 1000).status).toBe(409);
    expect(standings(s).map((r) => r.playerId)).not.toContain('late');
    s = advanceIfDue(s, s.endsAt!);
    const at = s.endsAt! + 1000;
    for (const id of ['k1', 'k2', 'late']) s = touch(s, id, at);
    const next = startRound(s, 't', at).state;
    expect(next.round).toBe(2);
    expect(next.roundWords).toEqual(['上下', '人口']);
    expect(Object.keys(next.progress).sort()).toEqual(['k1', 'k2', 'late']);
    // A send from round 1 is refused in round 2.
    expect(submitStroke(next, 'k1', { race: 1, seq: 9, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' }, next.goAt! + 1000).error).toBe('that was for a different round');
  });
});

describe('what may be spoken', () => {
  it('only words of a started round', () => {
    expect(wordToSay(lobby(), 0)).toBeNull();
    const s = racing();
    expect(wordToSay(s, 0)).toBe('人口');
    expect(wordToSay(s, 1)).toBe('大');
    expect(wordToSay(s, 2)).toBeNull();
    expect(wordToSay(s, -1)).toBeNull();
    expect(wordToSay(s, 0.5)).toBeNull();
  });
  it('the public view never carries a secret and says who is here', () => {
    const v = publicView(racing(), 'k1', T0);
    expect(v.role).toBe('kid');
    expect(v.present.sort()).toEqual(['k1', 'k2']);
  });
});
