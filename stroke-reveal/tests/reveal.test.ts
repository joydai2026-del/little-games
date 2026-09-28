// The pure reducer: scoring by reveal progress, lock rules, ties, question and
// round end, late joiners, and round id + seq idempotency.
import { describe, expect, it } from 'vitest';
import { GAME, LEVELS, SCORING } from '../src/shared/config';
import {
  advanceIfDue,
  buildQuestion,
  createRoom,
  join,
  nextAlarmAt,
  parseGuessInput,
  pointsAt,
  publicView,
  setOptions,
  standings,
  startRound,
  strokesShown,
  submitGuess,
  touch,
  wordsForRound,
} from '../src/shared/reveal';
import type { RoomState, WordList } from '../src/shared/types';

const T0 = 1_800_000_000_000;
const seeded = (seed = 1) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

function list(words: string[], counts: Record<string, number> = {}): WordList {
  const strokeCounts: Record<string, number> = {};
  for (const w of words) strokeCounts[Array.from(w)[0]] = counts[Array.from(w)[0]] ?? 3;
  return { words, missing: [], strokeCounts, repeats: 0, overflow: [], skipped: [] };
}

function room(opts: { level?: 'k2' | 'g35'; per?: number; words?: string[] } = {}) {
  let s = createRoom('ABCD', { id: 'T', name: 'Ms. Li' }, { level: opts.level ?? 'g35', charsPerRound: opts.per ?? 2 }, list(opts.words ?? ['大', '小', '山', '人', '口']), T0);
  s = join(s, { id: 'A', name: 'Ava' }, T0).state;
  s = join(s, { id: 'B', name: 'Ben', agent: true }, T0).state;
  const started = startRound(s, 'T', T0, seeded(7));
  expect(started.error).toBeUndefined();
  return started.state;
}

const answerOf = (s: RoomState) => s.questions[s.qIndex].answer;
const wrongOf = (s: RoomState) => (answerOf(s) + 1) % s.questions[s.qIndex].cards.length;
const guess = (s: RoomState, who: string, seq: number, card: number, at: number, question = s.qIndex, race = s.round) =>
  submitGuess(s, who, { race, question, seq, card }, at);

describe('questions and cards', () => {
  it('takes the next chunk of the list each round, wrapping', () => {
    expect(wordsForRound(['a', 'b', 'c'], 0, 2)).toEqual(['a', 'b']);
    expect(wordsForRound(['a', 'b', 'c'], 1, 2)).toEqual(['c', 'a']);
    expect(wordsForRound(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('builds cards from the list: one right card, wrong cards never start with the drawn character', () => {
    const l = list(['大', '大人', '小', '山', '人', '口'], { 大: 3 });
    for (let seed = 1; seed < 30; seed++) {
      const q = buildQuestion('大人', l, seeded(seed))!;
      expect(q.char).toBe('大');
      expect(q.cards[q.answer]).toBe('大人');
      expect(q.cards).toHaveLength(GAME.cardsPerQuestion);
      expect(q.cards.filter((c) => c.startsWith('大'))).toEqual(['大人']);
      expect(new Set(q.cards).size).toBe(q.cards.length);
    }
  });

  it('uses fewer cards when the list is short, and refuses a list with one starting character', () => {
    const q = buildQuestion('大', list(['大', '小']), seeded(1))!;
    expect(q.cards.sort()).toEqual(['大', '小'].sort());
    expect(buildQuestion('大', list(['大', '大人']), seeded(1))).toBeNull();
    let s = createRoom('ABCD', { id: 'T', name: '' }, {}, list(['大', '大人']), T0);
    s = join(s, { id: 'A', name: 'Ava' }, T0).state;
    expect(startRound(s, 'T', T0, seeded(1))).toMatchObject({ status: 409, error: 'add at least 2 words that start with different characters' });
  });

  it('only the teacher starts, and not with nobody here', () => {
    const s = createRoom('ABCD', { id: 'T', name: '' }, {}, list(['大', '小']), T0);
    expect(startRound(s, 'T', T0, seeded(1)).status).toBe(409);
    const j = join(s, { id: 'A', name: 'Ava' }, T0).state;
    expect(startRound(j, 'A', T0, seeded(1)).status).toBe(403);
  });
});

describe('guessing and scoring', () => {
  it('refuses guesses before Momo starts drawing', () => {
    const s = room();
    expect(guess(s, 'A', 1, answerOf(s), T0 + 1000)).toMatchObject({ status: 409, error: 'wait for Momo to start drawing' });
  });

  it('an earlier right guess scores more: max at the first stroke, min once fully drawn', () => {
    const s = room();
    const go = s.qStartAt!;
    const drawn = s.questions[0].strokes * LEVELS.g35.strokeMs;
    expect(pointsAt(s, go)).toBe(SCORING.maxPoints);
    expect(pointsAt(s, go + drawn)).toBe(SCORING.minPoints);
    expect(pointsAt(s, go + drawn + 5000)).toBe(SCORING.minPoints);
    const early = guess(s, 'A', 1, answerOf(s), go + 100).state;
    const late = guess(early, 'B', 1, answerOf(s), go + drawn - 100).state;
    expect(late.scores.A.points).toBeGreaterThan(late.scores.B.points);
    expect(late.scores.A.points).toBe(pointsAt(s, go + 100));
    expect(standings(late).map((r) => [r.name, r.place, r.status])).toEqual([['Ava', 1, 'got'], ['Ben', 2, 'got']]);
  });

  it('Grades 3-5: a wrong guess locks you out of that character', () => {
    const s = room({ level: 'g35' });
    const go = s.qStartAt!;
    const w = guess(s, 'A', 1, wrongOf(s), go + 100).state;
    expect(w.attempts.A).toMatchObject({ locked: true, tried: [wrongOf(s)] });
    expect(w.scores.A.wrong).toBe(1);
    expect(guess(w, 'A', 2, answerOf(s), go + 200)).toMatchObject({ status: 409, error: 'you are out for this word, wait for the next one' });
    expect(standings(w).find((r) => r.name === 'Ava')!.status).toBe('out');
  });

  it('K-2: a wrong guess only greys the cards for a moment, then you can still get it', () => {
    const s = room({ level: 'k2' });
    const go = s.qStartAt!;
    const wrong = wrongOf(s);
    const w = guess(s, 'A', 1, wrong, go + 100).state;
    expect(w.attempts.A).toMatchObject({ locked: false, coolUntil: go + 100 + LEVELS.k2.wrongCooldownMs });
    expect(guess(w, 'A', 2, answerOf(s), go + 200)).toMatchObject({ status: 429 });
    expect(guess(w, 'A', 2, wrong, go + 100 + LEVELS.k2.wrongCooldownMs)).toMatchObject({ status: 409, error: 'you already tried that card' });
    const ok = guess(w, 'A', 2, answerOf(s), go + 100 + LEVELS.k2.wrongCooldownMs).state;
    expect(ok.attempts.A.correctAt).not.toBeNull();
    expect(ok.scores.A).toMatchObject({ correct: 1, wrong: 1 });
  });

  it('a retried guess (same seq) changes nothing; a guess for another round or question is refused', () => {
    const s = room();
    const go = s.qStartAt!;
    const first = guess(s, 'A', 1, answerOf(s), go + 100);
    const again = guess(first.state, 'A', 1, answerOf(s), go + 300);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(first.state);
    expect(guess(first.state, 'B', 1, answerOf(s), go + 100, 0, 99)).toMatchObject({ status: 409, error: 'that guess was for a different round' });
    expect(guess(first.state, 'B', 1, answerOf(s), go + 100, 1)).toMatchObject({ status: 409, error: 'time is up for that word' });
    expect(guess(first.state, 'B', 5000, answerOf(s), go + 100)).toMatchObject({ status: 400 });
    expect(guess(first.state, 'B', 1, 9, go + 100)).toMatchObject({ status: 400 });
    expect(guess(first.state, 'A', 2, answerOf(s), go + 400)).toMatchObject({ status: 409, error: 'you already got this one' });
  });

  it('parses guess bodies strictly', () => {
    expect(parseGuessInput({ race: 1, question: 0, seq: 1, card: 2 })).toEqual({ race: 1, question: 0, seq: 1, card: 2 });
    for (const bad of [{}, { race: 1, question: 0, seq: 0, card: 1 }, { race: 1, question: 0, seq: 1, card: -1 }, { race: '1', question: 0, seq: 1, card: 1 }, { race: 1, question: 0.5, seq: 1, card: 1 }]) {
      expect(parseGuessInput(bad as never)).toBeNull();
    }
  });

  it('equal points and right answers share a place', () => {
    const s = room();
    const go = s.qStartAt!;
    const a = guess(s, 'A', 1, answerOf(s), go + 100).state;
    const b = guess(a, 'B', 1, answerOf(s), go + 100).state;
    expect(standings(b).map((r) => r.place)).toEqual([1, 1]);
  });
});

describe('timeline', () => {
  it('a question closes early when every kid is done, shows the answer, then the next one starts', () => {
    const s = room();
    const go = s.qStartAt!;
    const a = guess(s, 'A', 1, answerOf(s), go + 100).state;
    expect(a.qClosedAt).toBeNull();
    const b = guess(a, 'B', 1, wrongOf(s), go + 200).state; // g35: Ben is locked out, so everyone is done
    expect(b.qClosedAt).toBe(go + 200);
    expect(advanceIfDue(b, go + 200 + GAME.answerShowMs - 1)).toBe(b);
    const next = advanceIfDue(b, go + 200 + GAME.answerShowMs);
    expect(next.qIndex).toBe(1);
    expect(next.qStartAt).toBe(go + 200 + GAME.answerShowMs);
    expect(next.attempts).toEqual({});
    expect(next.scores.A.correct).toBe(1);
  });

  it('closes on the clock, and a late alarm catches up through several questions to the round end', () => {
    const s = room({ per: 2 });
    const go = s.qStartAt!;
    expect(nextAlarmAt(s, T0)).toBe(s.qEndsAt);
    const closed = advanceIfDue(s, s.qEndsAt!);
    expect(closed.qClosedAt).toBe(s.qEndsAt);
    expect(nextAlarmAt(closed, s.qEndsAt!)).toBe(s.qEndsAt! + GAME.answerShowMs);
    const done = advanceIfDue(s, go + 10 * 60_000);
    expect(done.phase).toBe('done');
    expect(done.qIndex).toBe(1);
    expect(done.version).toBe(s.version + 1);
    const q1Start = s.qEndsAt! + GAME.answerShowMs;
    const q1End = q1Start + s.questions[1].strokes * LEVELS.g35.strokeMs + GAME.holdAfterDrawnMs;
    expect(done.endedAt).toBe(q1End + GAME.answerShowMs);
  });

  it('strokes appear one per strokeMs from the start, all of them once closed', () => {
    const s = room({ level: 'k2' });
    const go = s.qStartAt!;
    const ms = LEVELS.k2.strokeMs;
    expect(strokesShown(s, go - 1)).toBe(0);
    expect(strokesShown(s, go)).toBe(1);
    expect(strokesShown(s, go + ms)).toBe(2);
    expect(strokesShown(s, go + 100 * ms)).toBe(s.questions[0].strokes);
  });

  it('late joiners watch this round and play the next one', () => {
    const s = room();
    const late = join(s, { id: 'L', name: 'Leo' }, T0 + 500).state;
    expect(guess(late, 'L', 1, 0, late.qStartAt! + 100)).toMatchObject({ status: 409, error: 'this round started before you joined, you play the next one' });
    expect(standings(late).map((r) => r.name)).not.toContain('Leo');
    expect(publicView(late, 'L', T0 + 500).inRound).toBe(false);
    const later = T0 + 60 * 60_000;
    let done = advanceIfDue(late, later);
    for (const id of ['A', 'B', 'L']) done = touch(done, id, later);
    const again = startRound(done, 'T', later, seeded(2)).state;
    expect(again.round).toBe(2);
    expect(Object.keys(again.scores).sort()).toEqual(['A', 'B', 'L']);
  });

  it('settings cannot change mid-round', () => {
    const s = room();
    expect(setOptions(s, 'T', { level: 'k2' }).status).toBe(409);
  });
});

describe('what each viewer sees', () => {
  it('kids never see the drawn character or the right card while the question is open; the teacher does', () => {
    const s = room();
    const kid = publicView(s, 'A', T0);
    expect(kid.question).toMatchObject({ char: null, answer: null, strokes: null, index: 0 });
    expect(JSON.stringify(kid)).not.toContain('"answer":' + answerOf(s) + ',"word"');
    expect(JSON.stringify(kid)).not.toContain('questions');
    expect(JSON.stringify(kid)).not.toContain('attempts');
    const teacher = publicView(s, 'T', T0);
    expect(teacher.question).toMatchObject({ char: s.questions[0].char, answer: answerOf(s) });
    const closed = advanceIfDue(s, s.qEndsAt!);
    expect(publicView(closed, 'A', s.qEndsAt!).question).toMatchObject({ char: s.questions[0].char, answer: answerOf(s) });
    expect(publicView(closed, 'A', s.qEndsAt!).history).toEqual([{ word: s.questions[0].word, char: s.questions[0].char }]);
  });

  it('a kid sees their own tries, never another kid\'s', () => {
    const s = room({ level: 'k2' });
    const w = guess(s, 'A', 1, wrongOf(s), s.qStartAt! + 50).state;
    expect(publicView(w, 'A', T0).mine?.tried).toEqual([wrongOf(s)]);
    const ben = publicView(w, 'B', T0);
    expect(ben.mine).toBeNull();
    expect(ben.standings.find((r) => r.name === 'Ava')!.status).toBe('thinking');
  });
});
