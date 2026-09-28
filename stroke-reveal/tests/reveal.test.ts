// The pure reducer: scoring by reveal progress, the minimum reveal, lock and
// pause rules, blind tapping, ties, AI ranked apart, question and round end,
// late joiners, round id + seq idempotency, and what each viewer may see.
import { describe, expect, it } from 'vitest';
import { GAME, LEVELS, SCORING } from '../src/shared/config';
import {
  advanceIfDue,
  buildQuestion,
  createRoom,
  dealWords,
  drawMs,
  join,
  nextAlarmAt,
  openAt,
  parseGuessInput,
  pointsAt,
  publicView,
  setOptions,
  standings,
  startRound,
  strokesShown,
  submitGuess,
  touch,
} from '../src/shared/reveal';
import { drawnChar } from '../src/shared/parse';
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
  for (const w of words) strokeCounts[drawnChar(w)] = counts[drawnChar(w)] ?? 3;
  return { words, missing: [], strokeCounts, repeats: 0, overflow: [], skipped: [] };
}

const WORDS = ['大', '小', '山', '人', '口'];
function room(opts: { level?: 'k2' | 'g35'; per?: number; words?: string[]; counts?: Record<string, number>; seed?: number; agentB?: boolean } = {}) {
  let s = createRoom('ABCD', { id: 'T', name: 'Ms. Li' }, { level: opts.level ?? 'g35', charsPerRound: opts.per ?? 2 }, list(opts.words ?? WORDS, opts.counts), T0);
  s = join(s, { id: 'A', name: 'Ava' }, T0).state;
  s = join(s, { id: 'B', name: 'Ben', agent: opts.agentB ?? false }, T0).state;
  const started = startRound(s, 'T', T0, seeded(opts.seed ?? 7));
  expect(started.error).toBeUndefined();
  return started.state;
}

const q0 = (s: RoomState) => s.questions[s.qIndex];
const answerOf = (s: RoomState) => q0(s).answer;
const wrongOf = (s: RoomState) => (answerOf(s) + 1) % q0(s).cards.length;
/** A kid taps the room's card `base`, sent as THEIR OWN card index (each kid has their own order). */
const guess = (s: RoomState, who: string, seq: number, base: number, at: number, question = s.qIndex, race = s.round) =>
  submitGuess(s, who, { race, question, seq, card: q0(s).orders[who].indexOf(base) }, at);

describe('dealing words and cards', () => {
  it('deals rounds from a private shuffled deck: no repeats inside a round, every word once before any repeats', () => {
    const words = ['a', 'b', 'c', 'd', 'e'];
    const r1 = dealWords([], words, 2, seeded(3));
    const r2 = dealWords(r1.deck, words, 2, seeded(4));
    const r3 = dealWords(r2.deck, words, 2, seeded(5));
    expect(new Set([...r1.picked, ...r2.picked, r3.picked[0]]).size).toBe(5);
    expect(new Set(r3.picked).size).toBe(2);
    expect(dealWords([], ['a', 'b'], 5, seeded(1)).picked.sort()).toEqual(['a', 'b']);
  });

  it('builds cards from the list: one right card, wrong cards never start with the drawn character, each kid gets their own order', () => {
    const l = list(['大', '大人', '小', '山', '人', '口'], { 大: 3 });
    for (let seed = 1; seed < 30; seed++) {
      const q = buildQuestion('大人', l, seeded(seed), ['A', 'B'])!;
      expect(q.char).toBe('大');
      expect(q.cards[q.answer]).toBe('大人');
      expect(q.cards).toHaveLength(GAME.cardsPerQuestion);
      expect(q.cards.filter((c) => c.startsWith('大'))).toEqual(['大人']);
      expect([...q.orders.A].sort()).toEqual([0, 1, 2, 3]);
      expect([...q.orders.B].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it(`refuses a list with fewer than ${GAME.minCardsPerQuestion} words that start with different characters`, () => {
    expect(buildQuestion('大', list(['大', '小', '山']), seeded(1))).toBeNull();
    expect(buildQuestion('大', list(['大', '大人', '小', '山']), seeded(1))).toBeNull();
    let s = createRoom('ABCD', { id: 'T', name: '' }, {}, list(['大', '小', '山']), T0);
    s = join(s, { id: 'A', name: 'Ava' }, T0).state;
    expect(startRound(s, 'T', T0, seeded(1))).toMatchObject({ status: 409, error: `add at least ${GAME.minCardsPerQuestion} words that start with different characters` });
  });

  it('only the teacher starts, and not with nobody here', () => {
    const s = createRoom('ABCD', { id: 'T', name: '' }, {}, list(WORDS), T0);
    expect(startRound(s, 'T', T0, seeded(1)).status).toBe(409);
    const j = join(s, { id: 'A', name: 'Ava' }, T0).state;
    expect(startRound(j, 'A', T0, seeded(1)).status).toBe(403);
  });
});

describe('minimum reveal and scoring', () => {
  it('refuses taps before Momo starts, and until stroke 1 is fully visible plus the reveal delay', () => {
    const s = room();
    const open = s.qStartAt! + GAME.firstStrokeShowMs + GAME.minRevealDelayMs;
    expect(openAt(s)).toBe(open);
    expect(guess(s, 'A', 1, answerOf(s), T0 + 1000)).toMatchObject({ status: 409, error: 'wait for Momo to start drawing' });
    expect(guess(s, 'A', 1, answerOf(s), s.qStartAt! + 251)).toMatchObject({ status: 409, error: 'watch the first stroke, then tap' });
    expect(guess(s, 'A', 1, answerOf(s), open - 1)).toMatchObject({ status: 409 });
    expect(guess(s, 'A', 1, answerOf(s), open).state.scores.A.points).toBe(SCORING.maxPoints);
  });

  it('an earlier right guess scores more: max when guessing opens, min once fully drawn', () => {
    const s = room();
    const open = openAt(s);
    const drawnAt = s.qStartAt! + drawMs(s, q0(s));
    expect(pointsAt(s, open)).toBe(SCORING.maxPoints);
    expect(pointsAt(s, drawnAt)).toBe(SCORING.minPoints);
    expect(pointsAt(s, drawnAt + 5000)).toBe(SCORING.minPoints);
    const early = guess(s, 'A', 1, answerOf(s), open + 100).state;
    const late = guess(early, 'B', 1, answerOf(s), drawnAt - 100).state;
    expect(late.scores.A.points).toBeGreaterThan(late.scores.B.points);
    expect(standings(late).map((r) => [r.name, r.place, r.status])).toEqual([['Ava', 1, 'got'], ['Ben', 2, 'got']]);
  });

  it('blind tapping over 4 cards scores below a kid who reads at mid-reveal, at both levels, for 1 to 20 strokes', () => {
    for (const level of ['k2', 'g35'] as const) {
      for (let strokes = 1; strokes <= 20; strokes++) {
        const s = room({ level, counts: Object.fromEntries(WORDS.map((w) => [w, strokes])) });
        const q = q0(s);
        const open = openAt(s);
        const end = Math.max(s.qStartAt! + drawMs(s, q), open + LEVELS[level].strokeMs);
        const reader = guess(s, 'A', 1, q.answer, Math.round(open + (end - open) / 2)).state.scores.A.points;
        // Blind: tap cards in a random order as fast as the rules allow. Average over
        // every position the right card can have in that order.
        let total = 0;
        const wrong = q.cards.map((_, i) => i).filter((i) => i !== q.answer);
        for (let pos = 0; pos < q.cards.length; pos++) {
          let st = s;
          let at = open;
          let seq = 0;
          for (const card of [...wrong.slice(0, pos), q.answer]) {
            const r = guess(st, 'A', ++seq, card, at);
            if (r.error) break; // locked out (Grades 3-5) or the word closed
            st = r.state;
            at = st.attempts.A.coolUntil ?? at;
          }
          total += st.scores.A.points;
        }
        const blind = total / q.cards.length;
        expect(blind, `${level} ${strokes} strokes: blind ${blind} vs reader ${reader}`).toBeLessThan(reader);
      }
    }
  });

  it('Grades 3-5: a wrong guess locks you out of that character', () => {
    const s = room({ level: 'g35' });
    const w = guess(s, 'A', 1, wrongOf(s), openAt(s)).state;
    expect(w.attempts.A).toMatchObject({ locked: true, tried: [wrongOf(s)] });
    expect(w.scores.A).toMatchObject({ wrong: 1, points: 0 });
    expect(guess(w, 'A', 2, answerOf(s), openAt(s) + 100)).toMatchObject({ status: 409, error: 'you are out for this word, wait for the next one' });
    expect(standings(w).find((r) => r.name === 'Ava')!.status).toBe('out');
  });

  it('K-2: a wrong guess costs no points, only a pause, then you can still get it', () => {
    const s = room({ level: 'k2' });
    const at = openAt(s);
    const w = guess(s, 'A', 1, wrongOf(s), at).state;
    const pause = Math.max(LEVELS.k2.wrongCooldownMs, Math.round(LEVELS.k2.wrongCooldownShare * drawMs(s, q0(s))));
    expect(pause).toBe(LEVELS.k2.wrongCooldownMs); // 3 strokes: the 2 s floor applies
    expect(w.attempts.A).toMatchObject({ locked: false, coolUntil: at + pause });
    expect(w.scores.A.points).toBe(0);
    expect(guess(w, 'A', 2, answerOf(s), at + 100)).toMatchObject({ status: 429 });
    expect(guess(w, 'A', 2, wrongOf(s), at + pause)).toMatchObject({ status: 409, error: 'you already tried that card' });
    const ok = guess(w, 'A', 2, answerOf(s), at + pause).state;
    expect(ok.scores.A).toMatchObject({ correct: 1, wrong: 1, points: pointsAt(s, at + pause) });
  });

  it('K-2: the pause stretches on long characters', () => {
    const s = room({ level: 'k2', counts: Object.fromEntries(WORDS.map((w) => [w, 12])) });
    const w = guess(s, 'A', 1, wrongOf(s), openAt(s)).state;
    expect(w.attempts.A.coolUntil! - openAt(s)).toBe(Math.round(0.4 * 12 * LEVELS.k2.strokeMs));
  });
});

describe('idempotency', () => {
  it('a retried guess (same seq) changes nothing; a guess for another round or question is refused', () => {
    const s = room();
    const at = openAt(s);
    const first = guess(s, 'A', 1, answerOf(s), at + 100);
    const again = guess(first.state, 'A', 1, answerOf(s), at + 300);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(first.state);
    expect(guess(first.state, 'B', 1, answerOf(s), at, 0, 99)).toMatchObject({ status: 409, error: 'that guess was for a different round' });
    expect(guess(first.state, 'B', 1, answerOf(s), at, 1)).toMatchObject({ status: 409, error: 'time is up for that word' });
    expect(submitGuess(first.state, 'B', { race: 1, question: 0, seq: 5000, card: 0 }, at)).toMatchObject({ status: 400 });
    expect(submitGuess(first.state, 'B', { race: 1, question: 0, seq: 1, card: 9 }, at)).toMatchObject({ status: 400 });
    expect(guess(first.state, 'A', 2, answerOf(s), at + 400)).toMatchObject({ status: 409, error: 'you already got this one' });
  });

  it('two tabs on one seat: the same seq with different cards applies exactly one result', () => {
    for (const level of ['k2', 'g35'] as const) {
      const s = room({ level });
      const at = openAt(s);
      const tabOne = guess(s, 'A', 1, wrongOf(s), at);
      const tabTwo = guess(tabOne.state, 'A', 1, answerOf(s), at + 50);
      expect(tabTwo.duplicate).toBe(true);
      expect(tabTwo.state).toBe(tabOne.state);
      expect(tabTwo.state.scores.A).toMatchObject({ wrong: 1, correct: 0, seq: 1 });
      // The other order: the right card first, a wrong card with the same seq is a no-op.
      const right = guess(s, 'A', 1, answerOf(s), at);
      const stale = guess(right.state, 'A', 1, wrongOf(s), at + 50);
      expect(stale.state.scores.A).toMatchObject({ correct: 1, wrong: 0 });
      // A stale retry for an earlier question stays a no-op after the word moves on.
      const moved = advanceIfDue(right.state, right.state.qEndsAt! + GAME.answerShowMs);
      expect(guess(moved, 'A', 1, answerOf(s), moved.qStartAt!, 0).duplicate).toBe(true);
    }
  });

  it('parses guess bodies strictly', () => {
    expect(parseGuessInput({ race: 1, question: 0, seq: 1, card: 2 })).toEqual({ race: 1, question: 0, seq: 1, card: 2 });
    for (const bad of [{}, { race: 1, question: 0, seq: 0, card: 1 }, { race: 1, question: 0, seq: 1, card: -1 }, { race: '1', question: 0, seq: 1, card: 1 }, { race: 1, question: 0.5, seq: 1, card: 1 }]) {
      expect(parseGuessInput(bad as never)).toBeNull();
    }
  });

  it('equal points and right answers share a place', () => {
    const s = room();
    const a = guess(s, 'A', 1, answerOf(s), openAt(s) + 100).state;
    const b = guess(a, 'B', 1, answerOf(s), openAt(s) + 100).state;
    expect(standings(b).map((r) => r.place)).toEqual([1, 1]);
  });
});

describe('AI players are ranked apart', () => {
  it('an AI never takes a kid place and never closes a word early', () => {
    const s = room({ agentB: true });
    const at = openAt(s);
    const ai = guess(s, 'B', 1, answerOf(s), at).state;
    expect(ai.qClosedAt).toBeNull();
    const kid = guess(ai, 'A', 1, answerOf(s), at + 1000).state;
    expect(kid.qClosedAt).not.toBeNull(); // the only kid is done
    const view = publicView(kid, 'A', at + 1000);
    expect(view.standings.map((r) => [r.name, r.place])).toEqual([['Ava', 1]]);
    expect(view.robots.map((r) => [r.name, r.place, r.agent])).toEqual([['Ben', 1, true]]);
    expect(kid.scores.B.points).toBeGreaterThan(kid.scores.A.points);
  });
});

describe('timeline', () => {
  it('a question closes early when every kid is done, shows the answer, then the next one starts', () => {
    const s = room();
    const at = openAt(s);
    const a = guess(s, 'A', 1, answerOf(s), at).state;
    expect(a.qClosedAt).toBeNull();
    const b = guess(a, 'B', 1, wrongOf(s), at + 100).state; // g35: Ben is locked out, so everyone is done
    expect(b.qClosedAt).toBe(at + 100);
    expect(advanceIfDue(b, at + 100 + GAME.answerShowMs - 1)).toBe(b);
    const next = advanceIfDue(b, at + 100 + GAME.answerShowMs);
    expect(next.qIndex).toBe(1);
    expect(next.qStartAt).toBe(at + 100 + GAME.answerShowMs);
    expect(next.attempts).toEqual({});
    expect(next.scores.A.correct).toBe(1);
  });

  it('closes on the clock, and a late alarm catches up through several questions to the round end', () => {
    const s = room({ per: 2 });
    expect(nextAlarmAt(s, T0)).toBe(s.qEndsAt);
    const closed = advanceIfDue(s, s.qEndsAt!);
    expect(closed.qClosedAt).toBe(s.qEndsAt);
    expect(nextAlarmAt(closed, s.qEndsAt!)).toBe(s.qEndsAt! + GAME.answerShowMs);
    const done = advanceIfDue(s, T0 + 10 * 60_000);
    expect(done.phase).toBe('done');
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
    expect(strokesShown(s, go + 100 * ms)).toBe(q0(s).strokes);
  });

  it('late joiners watch this round and play the next one', () => {
    const s = room();
    const late = join(s, { id: 'L', name: 'Leo' }, T0 + 500).state;
    expect(submitGuess(late, 'L', { race: 1, question: 0, seq: 1, card: 0 }, openAt(late))).toMatchObject({ status: 409, error: 'this round started before you joined, you play the next one' });
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
    expect(setOptions(room(), 'T', { level: 'k2' }).status).toBe(409);
  });
});

describe('what each viewer may see', () => {
  const EIGHT = ['大人', '山', '学校', '人', '口', '火', '水', '月'];

  it('a kid or agent payload carries no list, no future words, no stroke counts, and no timing that leaks them', () => {
    const s = room({ words: EIGHT, per: 3, agentB: true });
    for (const who of ['A', 'B']) {
      const view = publicView(s, who, T0);
      const text = JSON.stringify(view);
      expect(view.list).toBeNull();
      expect(view.expiresAt).toBeNull();
      expect(view.question).toMatchObject({ char: null, answer: null, strokes: null, endsAt: null });
      for (const k of ['questions', 'deck', 'attempts', 'orders', 'strokeCounts', '"word"']) expect(text).not.toContain(k);
      // No word outside this question's cards appears anywhere (the next words cannot be read off).
      const visible = new Set(view.question!.cards);
      for (const w of EIGHT) if (!visible.has(w)) expect(text, `${w} leaked to ${who}`).not.toContain(w);
    }
    const teacher = publicView(s, 'T', T0);
    expect(teacher.list?.words).toEqual(EIGHT);
    expect(teacher.question).toMatchObject({ char: q0(s).char, answer: answerOf(s) });
  });

  it('the old attack fails: guessing from anything in the kid payload (pasted order, card position, what an earlier round showed) is right no more than chance', () => {
    const tries = 300;
    const hits = { pastedOrder: 0, firstCard: 0, sameAsBigScreen: 0 };
    for (let seed = 1; seed <= tries; seed++) {
      const s = room({ words: EIGHT, per: 3, seed });
      const kid = publicView(s, 'A', T0).question!;
      const screen = publicView(s, 'T', T0).question!;
      const right = kid.cards[q0(s).orders.A.indexOf(answerOf(s))];
      // 1. The old exploit: the answer is the card that comes first in the pasted list.
      const byPaste = [...kid.cards].sort((x, y) => EIGHT.indexOf(x) - EIGHT.indexOf(y))[0];
      if (byPaste === right) hits.pastedOrder++;
      // 2. Always tap the first card.
      if (kid.cards[0] === right) hits.firstCard++;
      // 3. A kid who copies the card POSITION of the answer from someone else's phone or the big screen
      //    (the positions differ per phone).
      if (kid.cards[screen.cards.indexOf(right)] === right) hits.sameAsBigScreen++;
    }
    for (const [how, n] of Object.entries(hits)) expect(n / tries, how).toBeLessThan(0.4);
  });

  it('once a word closes, a kid sees its answer in their own order, and history lists closed words only', () => {
    const s = room();
    const closed = advanceIfDue(s, s.qEndsAt!);
    const view = publicView(closed, 'A', s.qEndsAt!);
    expect(view.question!.cards[view.question!.answer!]).toBe(q0(s).word);
    expect(view.history).toEqual([{ word: q0(s).word, char: q0(s).char }]);
    expect(publicView(s, 'A', T0).history).toEqual([]);
  });

  it("a kid sees their own tries in their own order, never another kid's", () => {
    const s = room({ level: 'k2' });
    const w = guess(s, 'A', 1, wrongOf(s), openAt(s)).state;
    const mine = publicView(w, 'A', T0);
    expect(mine.question!.cards[mine.mine!.tried[0]]).toBe(q0(s).cards[wrongOf(s)]);
    const ben = publicView(w, 'B', T0);
    expect(ben.mine).toBeNull();
    expect(ben.standings.find((r) => r.name === 'Ava')!.status).toBe('thinking');
  });
});
