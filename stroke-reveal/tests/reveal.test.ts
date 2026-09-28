// The pure reducer: scoring by reveal progress, the minimum reveal, lock and
// pause rules, blind tapping, ties, AI ranked apart, question and round end,
// late joiners, round id + seq idempotency, and what each viewer may see.
import { describe, expect, it } from 'vitest';
import { GAME, LEVELS, SCORING } from '../src/shared/config';
import {
  advanceIfDue,
  buildQuestion,
  createRoom,
  drawMs,
  join,
  nextAlarmAt,
  openAt,
  parseGuessInput,
  pickWord,
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
// mulberry32: a small seeded generator with well-mixed output (a plain LCG with small
// seeds gives correlated first draws, which skews the chance-level attack tests).
const seeded = (seed = 1) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
  it('picks each word independently from the whole list: no immediate repeat (when the list is long enough), and that word stays off the cards', () => {
    const long = list(['大', '小', '山', '人', '口', '火']);
    const counts: Record<string, number> = {};
    const rnd = seeded(9);
    for (let seed = 1; seed <= 600; seed++) {
      const { word, avoid } = pickWord(long, '山', rnd);
      expect(word).not.toBe('山');
      expect(avoid).toBe('山');
      counts[word] = (counts[word] ?? 0) + 1;
      const q = buildQuestion(word, long, rnd, [], avoid)!;
      expect(q.cards).not.toContain('山');
    }
    expect(Object.keys(counts).sort()).toEqual(['人', '口', '大', '小', '火'].sort());
    // Too short to keep the last word off the cards: fully independent, a repeat is allowed.
    const short = list(['大', '小', '山', '人']);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) seen.add(pickWord(short, '山', rnd).word);
    expect(seen.has('山')).toBe(true);
    expect(pickWord(short, '山', seeded(1)).avoid).toBeNull();
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

  it('K-2: a wrong guess takes no points away, only a pause; a right tap after it earns half', () => {
    const s = room({ level: 'k2' });
    const at = openAt(s);
    const w = guess(s, 'A', 1, wrongOf(s), at).state;
    const pause = LEVELS.k2.wrongCooldownMs;
    expect(w.attempts.A).toMatchObject({ locked: false, coolUntil: at + pause });
    expect(w.scores.A.points).toBe(0);
    expect(guess(w, 'A', 2, answerOf(s), at + 100)).toMatchObject({ status: 429 });
    expect(guess(w, 'A', 2, wrongOf(s), at + pause)).toMatchObject({ status: 409, error: 'you already tried that card' });
    const ok = guess(w, 'A', 2, answerOf(s), at + pause).state;
    expect(ok.scores.A).toMatchObject({ correct: 1, wrong: 1, points: Math.round(pointsAt(s, at + pause) * LEVELS.k2.rightAfterMissFactor) });
  });

  it('K-2: the pause is the same for every character (it never tells the stroke count), and 3 tries fit after the drawing', () => {
    const pauses = [2, 8, 20].map((n) => {
      const s = room({ level: 'k2', counts: Object.fromEntries(WORDS.map((w) => [w, n])) });
      return guess(s, 'A', 1, wrongOf(s), openAt(s)).state.attempts.A.coolUntil! - openAt(s);
    });
    expect(new Set(pauses).size).toBe(1);
    expect(3 * LEVELS.k2.wrongCooldownMs).toBeLessThanOrEqual(GAME.holdAfterDrawnMs);
    // A kid who first taps when the drawing is complete still reaches the fourth card in time.
    const s = room({ level: 'k2', counts: Object.fromEntries(WORDS.map((w) => [w, 20])) });
    const q = q0(s);
    const wrong = q.cards.map((_, i) => i).filter((i) => i !== q.answer);
    let st = s;
    let at = s.qStartAt! + drawMs(s, q);
    let seq = 0;
    for (const card of [...wrong, q.answer]) {
      const r = guess(st, 'A', ++seq, card, at);
      expect(r.error, `tap ${seq}`).toBeUndefined();
      st = r.state;
      at = st.attempts.A.coolUntil ?? at;
    }
    expect(st.attempts.A.correctAt).not.toBeNull();
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
      for (const k of ['questions', 'lastWord', 'attempts', 'orders', 'strokeCounts', '"word"']) expect(text).not.toContain(k);
      // No word outside this question's cards appears anywhere (the next words cannot be read off).
      const visible = new Set(view.question!.cards);
      for (const w of EIGHT) if (!visible.has(w)) expect(text, `${w} leaked to ${who}`).not.toContain(JSON.stringify(w));
    }
    const teacher = publicView(s, 'T', T0);
    expect(teacher.list?.words).toEqual(EIGHT);
    expect(teacher.question).toMatchObject({ char: q0(s).char, answer: answerOf(s) });
  });

  it('the old attack fails: guessing from anything in the kid payload (pasted order, card position) is right no more than chance', () => {
    const tries = 300;
    const hits = { pastedOrder: 0, firstCard: 0, sameAsBigScreen: 0 };
    for (let seed = 1; seed <= tries; seed++) {
      const s = room({ words: EIGHT, per: 3, seed });
      const kid = publicView(s, 'A', T0).question!;
      const screen = publicView(s, 'T', T0).question!;
      const right = kid.cards[q0(s).orders.A.indexOf(answerOf(s))];
      const byPaste = [...kid.cards].sort((x, y) => EIGHT.indexOf(x) - EIGHT.indexOf(y))[0];
      if (byPaste === right) hits.pastedOrder++;
      if (kid.cards[0] === right) hits.firstCard++;
      if (kid.cards[screen.cards.indexOf(right)] === right) hits.sameAsBigScreen++;
    }
    for (const [how, n] of Object.entries(hits)) expect(n / tries, how).toBeLessThan(0.4);
  });

  // The elimination attack (Codex round 2): remember every word that already played (the
  // closed-word history on the phone, this round and earlier rounds) and tap a card that has
  // NOT played yet, preferring the one that played longest ago. It must stay near 1 in 4.
  const nextWord = (s: RoomState) => advanceIfDue(advanceIfDue(s, s.qEndsAt!), s.qEndsAt! + GAME.answerShowMs);
  function eliminationGuess(cards: string[], played: string[]): string {
    const rank = (w: string) => (played.includes(w) ? played.lastIndexOf(w) : -1);
    return [...cards].sort((x, y) => rank(x) - rank(y))[0];
  }
  const within = (rate: number) => rate > 0.18 && rate < 0.32;

  it('elimination fails on a 4-word list at question 4 (about 1 in 4 over 500 rooms)', () => {
    let hits = 0;
    for (let seed = 1; seed <= 500; seed++) {
      let s = room({ words: ['大', '山', '人', '口'], per: 4, seed });
      for (let i = 0; i < 3; i++) s = nextWord(s);
      expect(s.qIndex).toBe(3);
      const view = publicView(s, 'A', s.qStartAt!);
      expect(view.history).toHaveLength(3);
      const pick = eliminationGuess(view.question!.cards, view.history.map((h) => h.word));
      if (pick === q0(s).word) hits++;
    }
    expect(within(hits / 500), `hit rate ${hits / 500}`).toBe(true);
  });

  it('elimination fails on a 41-word list at round 3 question 1, using rounds 1 and 2 (about 1 in 4 over 500 rooms)', () => {
    const FORTY_ONE = Array.from('的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会');
    expect(new Set(FORTY_ONE).size).toBe(41);
    let hits = 0;
    for (let seed = 1; seed <= 500; seed++) {
      let s = room({ words: FORTY_ONE, per: 20, seed });
      const played: string[] = [];
      let t = T0;
      for (let round = 1; round <= 2; round++) {
        while (s.phase === 'playing') {
          const next = nextWord(s);
          if (next.phase === 'done') played.push(...publicView(next, 'A', next.endedAt!).history.map((h) => h.word));
          t = s.qEndsAt! + GAME.answerShowMs;
          s = next;
        }
        for (const id of ['A', 'B']) s = touch(s, id, t);
        s = startRound(s, 'T', t, seeded(seed * 7 + round)).state;
      }
      expect(s.round).toBe(3);
      expect(played).toHaveLength(40);
      const pick = eliminationGuess(publicView(s, 'A', s.qStartAt!).question!.cards, played);
      if (pick === q0(s).word) hits++;
    }
    expect(within(hits / 500), `hit rate ${hits / 500}`).toBe(true);
  });

  it('ruling out drawn words across every question of 3 rounds stays near 1 in 4, and scores below a mid-reveal reader', () => {
    let first = 0;
    let asked = 0;
    let attacker = 0;
    let reader = 0;
    for (let seed = 1; seed <= 150; seed++) {
      let s = room({ level: 'k2', words: EIGHT, per: 5, seed });
      const played: string[] = [];
      let t = T0;
      for (let round = 1; round <= 3; round++) {
        while (s.phase === 'playing') {
          const view = publicView(s, 'A', s.qStartAt!);
          const seen = [...played, ...view.history.map((h) => h.word)];
          const cards = view.question!.cards;
          const rank = (w: string) => (seen.includes(w) ? seen.lastIndexOf(w) : -1);
          const order = [...cards].sort((x, y) => rank(x) - rank(y));
          const q = q0(s);
          asked++;
          if (order[0] === q.word) first++;
          // Attacker: tap in that order as fast as the rules allow.
          let st = s;
          let at = openAt(s);
          let seq = st.scores.A.seq;
          for (const w of order) {
            const r = submitGuess(st, 'A', { race: st.round, question: st.qIndex, seq: ++seq, card: cards.indexOf(w) }, at);
            if (r.error) break;
            st = r.state;
            if (st.attempts.A.correctAt != null) break;
            at = st.attempts.A.coolUntil ?? at;
          }
          attacker += st.attempts.A?.points ?? 0;
          // Reader: taps the right card at mid-drawing.
          const end = Math.max(s.qStartAt! + drawMs(s, q), openAt(s) + LEVELS.k2.strokeMs);
          reader += pointsAt(s, Math.round(openAt(s) + (end - openAt(s)) / 2));
          const next = nextWord(s);
          if (next.phase === 'done') played.push(...publicView(next, 'A', next.endedAt!).history.map((h) => h.word));
          t = s.qEndsAt! + GAME.answerShowMs;
          s = next;
        }
        for (const id of ['A', 'B']) s = touch(s, id, t);
        if (round < 3) s = startRound(s, 'T', t, seeded(seed * 11 + round)).state;
      }
    }
    expect(asked).toBe(150 * 15);
    expect(within(first / asked), `first-tap hit rate ${first / asked}`).toBe(true);
    expect(attacker / asked, `attacker ${attacker / asked} vs reader ${reader / asked}`).toBeLessThan(reader / asked);
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
