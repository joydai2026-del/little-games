import { describe, expect, it } from 'vitest';
import {
  advanceIfDue,
  createRoom,
  join,
  markHeard,
  nextAlarmAt,
  nextRoundChars,
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
import type { RoomState, WordList } from '../src/shared/types';
import { GEOM, asPairs, backwards, other, right } from './geom';

const T0 = 1_800_000_000_000;
const GO = T0 + GAME.countdownSeconds * 1000;
const counts = (chars: string) => Object.fromEntries([...chars].map((c) => [c, GEOM[c].strokes.length]));
const LIST: WordList = { words: ['人口', '大', '上下'], missing: [], tooLong: [], skipped: [], strokeCounts: counts('人口大上下'), repeats: 0, overflow: [] };

function lobby(options: Record<string, unknown> = { wordsPerRound: 2, secondsPerWord: 20 }): RoomState {
  let s = createRoom('ABCD', { id: 't', name: 'Ms. Li' }, 'class', options, LIST, T0);
  s = join(s, { id: 'k1', name: 'Mia' }, T0).state;
  s = join(s, { id: 'k2', name: 'Leo' }, T0).state;
  return s;
}
const racing = (opts?: Record<string, unknown>) => startRound(lobby(opts), 't', T0).state;
/** Round on, and both kids have heard word 0 at GO. */
const heard = (opts?: Record<string, unknown>) => markHeard(markHeard(racing(opts), 'k1', 0, GO), 'k2', 0, GO);

/** Writes the right strokes for `id`, `gap` ms apart from `from`, `n` times. */
function write(s: RoomState, id: string, n: number, from: number, gap = 300): { s: RoomState; at: number } {
  let at = from;
  for (let i = 0; i < n; i++) {
    const p = s.progress[id];
    if (p.heardAt == null) s = markHeard(s, id, p.wordIndex, at);
    const q = s.progress[id];
    const ch = [...s.roundWords[q.wordIndex]][q.charIndex];
    const r = submitStroke(s, id, { race: s.round, seq: q.seq + 1, wordIndex: q.wordIndex, charIndex: q.charIndex, points: right(ch, q.strokeIndex) }, GEOM, at);
    expect(r.error).toBeUndefined();
    expect(r.verdict).toBe('correct');
    s = r.state;
    at += gap;
  }
  return { s, at };
}
const stroke = (s: RoomState, id: string, points: { x: number; y: number }[], at: number, seq = s.progress[id].seq + 1) =>
  submitStroke(s, id, { race: s.round, seq, wordIndex: s.progress[id].wordIndex, charIndex: s.progress[id].charIndex, points }, GEOM, at);

describe('the room grades strokes from their points (shared matcher)', () => {
  it('right, wrong, backwards', () => {
    const s = heard();
    expect(stroke(s, 'k1', right('人', 0), GO + 500).verdict).toBe('correct');
    expect(stroke(s, 'k1', other('人', 0, 1), GO + 500).verdict).toBe('mistake');
    expect(stroke(s, 'k1', backwards('人', 0), GO + 500).verdict).toBe('mistake');
    const wrong = stroke(s, 'k1', backwards('人', 0), GO + 500).state;
    expect(wrong.progress.k1).toMatchObject({ mistakes: 1, strokeIndex: 0, strokesDone: 0, scoreStrokes: 0 });
  });
  it('an assertion-only body (a verdict, no points) is refused; junk points are refused', () => {
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' })).toMatch(/send the points/);
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: [[1, 2]] })).toMatch(/points must be/);
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: [[1, 2], ['x', 3]] })).toMatch(/points must be/);
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: Array.from({ length: GAME.maxStrokePoints + 1 }, (_, i) => [i, i]) })).toMatch(/points must be/);
    const ok = parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: asPairs(right('人', 0)) });
    expect(typeof ok).toBe('object');
  });
  it('walks stroke by stroke through each character, then to the next word', () => {
    let s = heard();
    ({ s } = write(s, 'k1', 2, GO + 1000)); // 人 done
    expect(s.progress.k1).toMatchObject({ wordIndex: 0, charIndex: 1, strokeIndex: 0, strokesDone: 2, wordsDone: 0 });
    ({ s } = write(s, 'k1', 3, GO + 2000)); // 口 done -> 人口 written
    expect(s.progress.k1).toMatchObject({ wordIndex: 1, charIndex: 0, wordsDone: 1, heardAt: null, deadlineAt: null, results: ['written'] });
  });
});

describe('the word clock belongs to the room', () => {
  it('no stroke before the room served the audio; the first serve starts the clock; replays do not restart it', () => {
    const s = racing();
    expect(stroke(s, 'k1', right('人', 0), GO + 500).error).toBe('listen to the word first');
    expect(markHeard(s, 'k1', 0, GO - 1)).toBe(s); // not before GO
    const h1 = markHeard(s, 'k1', 0, GO + 100);
    expect(h1.progress.k1).toMatchObject({ heardAt: GO + 100, deadlineAt: GO + 100 + 20_000 });
    expect(markHeard(h1, 'k1', 0, GO + 5000)).toBe(h1);
    expect(markHeard(h1, 'k1', 1, GO + 5000)).toBe(h1); // not ahead
  });
  it('a stroke after the deadline is refused, and the word closes as skipped (strokes taken back)', () => {
    let s = heard();
    ({ s } = write(s, 'k1', 1, GO + 1000));
    const late = GO + 20_000;
    expect(stroke(s, 'k1', right('人', 1), late).error).toBe('time is up for that word');
    const settled = advanceIfDue(s, late);
    expect(settled.progress.k1).toMatchObject({ wordIndex: 1, wordsSkipped: 1, scoreStrokes: 0, strokesDone: 1, results: ['skipped'] });
    expect(nextAlarmAt(s, GO)).toBe(GO + 20_000);
  });
});

describe('levels: Easy sends the outline after hearing, Hard never does', () => {
  it('Easy', () => {
    const s = racing({ level: 'easy', wordsPerRound: 2 });
    expect(publicView(s, 'k1', GO, GEOM).me!.outline).toBeNull();
    const v = publicView(markHeard(s, 'k1', 0, GO), 'k1', GO, GEOM).me!;
    expect(v.outline).toEqual(GEOM['人'].strokes);
  });
  it('Hard', () => {
    let s = markHeard(racing({ level: 'hard', wordsPerRound: 2 }), 'k1', 0, GO);
    expect(publicView(s, 'k1', GO, GEOM).me!.outline).toBeNull();
    s = write(s, 'k1', 1, GO + 500).s;
    const v = publicView(s, 'k1', GO + 600, GEOM).me!;
    expect(v.outline).toBeNull();
    expect(v.accepted).toEqual([[GEOM['人'].strokes[0]]]); // only what was accepted, as geometry
  });
});

describe('a writer cannot recover the word or its stroke count', () => {
  it('no word text, no list, no stroke counts, no other round words anywhere in the payload', () => {
    let s = heard({ level: 'hard', wordsPerRound: 2 });
    s = write(s, 'k1', 1, GO + 500).s;
    const json = JSON.stringify(publicView(s, 'k1', GO + 600, GEOM));
    for (const w of ['人', '口', '大', '上', '下']) expect(json).not.toContain(w);
    expect(json).not.toContain('strokeCounts');
    expect(json).not.toContain(GEOM['人'].strokes[1]); // the next stroke's shape
    expect(json).not.toContain(GEOM['口'].strokes[0]);
    const me = publicView(s, 'k1', GO + 600, GEOM).me!;
    expect(me.charCount).toBe(2);
    expect(me.audio).toBe('/api/rooms/ABCD/say?r=1&w=0');
    // The stroke count of the current character is not derivable: only accepted strokes are there.
    expect(me.accepted[0]).toHaveLength(1);
  });
  it('closed words only: your own closed words during the round, all words once it is done', () => {
    let s = heard({ level: 'hard', wordsPerRound: 2 });
    s = write(s, 'k1', 5, GO + 500).s; // k1 wrote 人口
    const k1 = JSON.stringify(publicView(s, 'k1', GO + 5000, GEOM));
    expect(k1).toContain('人口');
    expect(k1).not.toContain('"大"');
    expect(JSON.stringify(publicView(s, 'k2', GO + 5000, GEOM))).not.toContain('人');
    const done = advanceIfDue(s, s.endsAt!);
    expect(publicView(done, 'k2', s.endsAt!, GEOM).roundWords).toEqual(['人口', '大']);
  });
  it('the teacher sees the list and the round; a solo writer sees neither', () => {
    const s = racing();
    expect(publicView(s, 't', GO, GEOM).list.words).toEqual(LIST.words);
    expect(publicView(s, 't', GO, GEOM).roundWords).toEqual(['人口', '大']);
    const solo = startRound(createRoom('SOLO', { id: 'me', name: '' }, 'solo', {}, LIST, T0), 'me', T0).state;
    const v = publicView(solo, 'me', GO, GEOM);
    expect(v.list.words).toEqual([]);
    expect(v.list.count).toBe(3);
    expect(v.roundWords).toEqual([]);
  });
});

describe('help and hints', () => {
  it('after hintAfterMisses misses the room shows that stroke; on Hard the helped stroke scores half, on Easy full', () => {
    for (const [level, score] of [['hard', 0.5], ['easy', 1]] as const) {
      let s = heard({ level, wordsPerRound: 2 });
      for (let i = 0; i < GAME.hintAfterMisses; i++) s = stroke(s, 'k1', backwards('人', 0), GO + 500 + i).state;
      expect(publicView(s, 'k1', GO + 600, GEOM).me!.hint).toBe(GEOM['人'].strokes[0]);
      s = stroke(s, 'k1', right('人', 0), GO + 1000).state;
      expect(s.progress.k1.scoreStrokes).toBe(score);
      expect(standings(s).find((r) => r.playerId === 'k1')!.helped).toBe(level === 'hard' ? 1 : 0);
      expect(publicView(s, 'k1', GO + 1100, GEOM).me!.hint).toBeNull();
    }
  });
});

describe('sequence numbers', () => {
  it('a retried send is a no-op; two tabs reusing one seq with DIFFERENT points: the second changes nothing', () => {
    const s = heard();
    const a = stroke(s, 'k1', right('人', 0), GO + 500, 1).state; // tab A: right
    const b = stroke(a, 'k1', backwards('人', 0), GO + 600, 1); // tab B: same seq, wrong points
    expect(b.duplicate).toBe(true);
    expect(b.state).toBe(a);
    expect(a.progress.k1).toMatchObject({ strokeIndex: 1, mistakes: 0, seq: 1 });
    // And the other way round: a wrong stroke first, then a right one with the same seq.
    const c = stroke(s, 'k1', backwards('人', 0), GO + 500, 1).state;
    expect(stroke(c, 'k1', right('人', 0), GO + 600, 1).state.progress.k1).toMatchObject({ strokeIndex: 0, mistakes: 1 });
  });
  it('refuses another round, the teacher, out-of-order indices, too-far seqs, and the pace floor', () => {
    const s = heard();
    const base = { race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: right('人', 0) };
    expect(submitStroke(s, 'k1', { ...base, race: 2 }, GEOM, GO + 1000).status).toBe(409);
    expect(submitStroke(s, 't', base, GEOM, GO + 1000).status).toBe(403);
    expect(submitStroke(s, 'k1', { ...base, wordIndex: 1 }, GEOM, GO + 1000).error).toBe('that is not the word you are on');
    expect(submitStroke(s, 'k1', { ...base, charIndex: 1 }, GEOM, GO + 1000).error).toBe('that is not the character you are on');
    expect(submitStroke(s, 'k1', { ...base, seq: 5000 }, GEOM, GO + 1000).status).toBe(400);
    expect(submitStroke(s, 'k1', base, GEOM, GO + GAME.minStrokeMs - 1).status).toBe(429);
    expect(submitStroke(s, 'k1', base, {}, GO + 1000).status).toBe(503);
  });
});

describe('skips score 0', () => {
  it('a skip takes back the strokes earned on that word, so partial-then-skip never beats an immediate skip', () => {
    let s = heard();
    ({ s } = write(s, 'k1', 3, GO + 1000)); // 3 strokes into 人口
    s = skipWord(s, 'k1', { race: 1, seq: 4, wordIndex: 0 }, GO + 3000).state;
    s = skipWord(s, 'k2', { race: 1, seq: 1, wordIndex: 0 }, GO + 3000).state;
    expect(s.progress.k1).toMatchObject({ wordsSkipped: 1, scoreStrokes: 0, lastProgressAt: null, results: ['skipped'] });
    const b = standings(s);
    expect(b.map((r) => r.place)).toEqual([1, 1]); // a tie: the partial strokes bought nothing
    expect(skipWord(s, 'k1', { race: 1, seq: 4, wordIndex: 0 }, GO + 3100).duplicate).toBe(true);
    expect(parseSkipInput({ race: 1, seq: 1 })).toBeNull();
  });
  it('skipping the last word finishes', () => {
    let s = racing();
    s = skipWord(s, 'k1', { race: 1, seq: 1, wordIndex: 0 }, GO + 100).state;
    s = skipWord(s, 'k1', { race: 1, seq: 2, wordIndex: 1 }, GO + 200).state;
    expect(s.progress.k1.finishedAt).toBe(GO + 200);
  });
});

describe('scoring and ties', () => {
  it('more words written wins; then scoring strokes; then who got there first; exact ties share a place', () => {
    let s = heard();
    ({ s } = write(s, 'k1', 5, GO + 1000));
    ({ s } = write(s, 'k2', 4, GO + 1000));
    expect(standings(s).map((r) => [r.playerId, r.place])).toEqual([['k1', 1], ['k2', 2]]);
    let t = heard();
    ({ s: t } = write(t, 'k1', 2, GO + 1000));
    ({ s: t } = write(t, 'k2', 2, GO + 1000));
    expect(standings(t).map((r) => r.place)).toEqual([1, 1]);
  });
});

describe('rounds, lists and settings', () => {
  it('a solo room: the host writes, joins refused', () => {
    const solo = createRoom('SOLO', { id: 'me', name: '' }, 'solo', { level: 'hard' }, LIST, T0);
    expect(solo.players[0]).toMatchObject({ role: 'kid', name: 'Me' });
    expect(join(solo, { id: 'x', name: 'Zed' }, T0).status).toBe(409);
    expect(Object.keys(startRound(solo, 'me', T0).state.progress)).toEqual(['me']);
  });
  it('only the host changes things, never mid-round; junk settings keep the current value', () => {
    const s = lobby();
    expect(startRound(s, 'k1', T0).status).toBe(403);
    expect(setOptions(s, 'k1', { level: 'hard' }).status).toBe(403);
    const hard = setOptions(s, 't', { level: 'hard', secondsPerWord: 9999, wordsPerRound: 'x' }).state;
    expect(hard.options).toEqual({ level: 'hard', secondsPerWord: 120, wordsPerRound: 2 });
    expect(setOptions(racing(), 't', { level: 'easy' }).status).toBe(409);
    expect(setList(racing(), 't', LIST).status).toBe(409);
  });
  it('rounds follow a cursor: changing words-per-round never skips or repeats; a new list starts at its top', () => {
    let s = racing(); // 人口 大
    s = advanceIfDue(s, s.endsAt!);
    const at = s.endsAt! + 1000;
    s = touch(touch(s, 'k1', at), 'k2', at);
    s = setOptions(s, 't', { wordsPerRound: 1 }).state;
    expect(nextRoundChars(s)).toEqual(['上', '下']);
    const r2 = startRound(s, 't', at).state;
    expect(r2.roundWords).toEqual(['上下']);
    let r3 = advanceIfDue(r2, r2.endsAt!);
    r3 = setList(r3, 't', { ...LIST, words: ['大', '人口'] }).state;
    expect(r3.cursor).toBe(0);
    r3 = touch(touch(r3, 'k1', r2.endsAt! + 10), 'k2', r2.endsAt! + 10);
    const next = startRound(r3, 't', r2.endsAt! + 10).state;
    expect(next.roundWords).toEqual(['大']);
    expect(next.round).toBe(3); // the send id only goes up
    expect(wordsForRound(['a', 'b', 'c'], 2, 2)).toEqual(['c', 'a']);
  });
  it('the round clock, round end, late joiners', () => {
    let s = racing();
    expect(s.endsAt).toBe(GO + roundMs(s.options, 2));
    s = join(s, { id: 'late', name: 'Late Leo' }, GO + 100).state;
    expect(publicView(s, 'late', GO + 100, GEOM).me).toBeNull();
    expect(markHeard(s, 'late', 0, GO)).toBe(s);
    expect(submitStroke(s, 'late', { race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: right('人', 0) }, GEOM, GO + 1000).status).toBe(409);
    expect(standings(s).map((r) => r.playerId)).not.toContain('late');
    const done = advanceIfDue(s, s.endsAt!);
    expect(done.phase).toBe('done');
  });
  it('join rate limit per room', () => {
    let s = createRoom('ABCD', { id: 't', name: 'T' }, 'class', {}, LIST, T0);
    for (let i = 0; i < GAME.joinsPerMinute; i++) s = join(s, { id: `k${i}`, name: `K${i}` }, T0 + i).state;
    const r = join(s, { id: 'x', name: 'X' }, T0 + 100);
    expect(GAME.joinsPerMinute >= GAME.maxKids ? [409, 429] : [429]).toContain(r.status);
  });
  it('what may be spoken: only words of a started round', () => {
    expect(wordToSay(lobby(), 0)).toBeNull();
    expect(wordToSay(racing(), 1)).toBe('大');
    expect(wordToSay(racing(), 2)).toBeNull();
  });
});

describe('matcher cost guards (a crafted stroke cannot freeze the room)', () => {
  it('a stroke that returns to its own centre, and a dot-sized scribble, grade as mistakes in under 20 ms', async () => {
    const { gradeStroke } = await import('../src/shared/matcher');
    // Out, back past the centre, and home: both ends at the centre, so scale is ~0.
    const loop: { x: number; y: number }[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      loop.push({ x: 500 + 200 * Math.sin(t), y: 400 + 0.01 * Math.cos(t) });
    }
    const target = GEOM['一'] ? '一' : '大';
    for (const pts of [loop, [{ x: 500, y: 500 }, { x: 501, y: 501 }, { x: 500, y: 502 }]]) {
      const t0 = performance.now();
      expect(gradeStroke(pts, GEOM[target].medians, 0)).toBe('mistake');
      expect(performance.now() - t0).toBeLessThan(20);
    }
    // Normal grading still works and stays cheap.
    const t1 = performance.now();
    expect(gradeStroke(right('大', 0), GEOM['大'].medians, 0)).toBe('correct');
    expect(performance.now() - t1).toBeLessThan(20);
    // Non-finite and oversized inputs are refused before grading.
    expect(gradeStroke([{ x: NaN, y: 1 }, { x: 2, y: 3 }], GEOM['大'].medians, 0)).toBe('mistake');
    expect(parseStrokeInput({ race: 1, seq: 1, wordIndex: 0, charIndex: 0, points: [[1e308 * 10, 1], [2, 3]] })).toMatch(/points must be/);
  });
});
