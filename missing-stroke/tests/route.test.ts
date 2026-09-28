import { describe, expect, it } from 'vitest';
import { screenFor } from '../src/client/route';

describe('screenFor', () => {
  const none = () => false;
  it('home, room, and join with the code filled in', () => {
    expect(screenFor('#/', none)).toEqual({ screen: 'home', code: '' });
    expect(screenFor('#/room/abcd', none)).toEqual({ screen: 'room', code: 'ABCD' });
    expect(screenFor('#/join/abcd', none)).toEqual({ screen: 'home', code: 'ABCD' });
  });
  it('reopening the join link with a saved seat goes straight back into the room', () => {
    const has = (c: string) => c === 'ABCD';
    expect(screenFor('#/join/ABCD', has)).toEqual({ screen: 'room', code: 'ABCD' });
    expect(screenFor('#/join/WXYZ', has)).toEqual({ screen: 'home', code: 'WXYZ' });
  });
});

import { goTo } from '../src/client/route';
import { HICCUP_TEXT, kidStatusText, seconds, strokeOutcome, winnerLine } from '../src/client/status';

describe('stale seat recovery', () => {
  it('after the seat is cleared, the same join link shows the join form, and Join again re-runs routing', () => {
    const seats = new Set(['ABCD']);
    const has = (c: string) => seats.has(c);
    expect(screenFor('#/join/ABCD', has).screen).toBe('room');
    seats.delete('ABCD'); // what renderRoom does on a 403/404
    expect(screenFor('#/join/ABCD', has)).toEqual({ screen: 'home', code: 'ABCD' });

    const events: string[] = [];
    const win = { location: { hash: '#/join/ABCD' }, dispatchEvent: (e: Event) => (events.push(e.type), true) };
    goTo('#/join/ABCD', win, () => new Event('hashchange'));
    expect(events).toEqual(['hashchange']); // same fragment: routing is re-run explicitly
    goTo('#/', win, () => new Event('hashchange'));
    expect(win.location.hash).toBe('#/');
    expect(events).toHaveLength(1);
  });
});

describe('kid status line', () => {
  const base = { stage: 'drawing' as const, hiccupUntil: 10_000, error: null, missesLeftForHint: 2, hintShowing: false };
  it('the hiccup notice shows until its deadline, then clears by itself', () => {
    expect(kidStatusText({ ...base, now: 9_999 })).toBe(HICCUP_TEXT);
    expect(kidStatusText({ ...base, now: 10_000 })).toBe('Draw the one missing stroke.');
    expect(kidStatusText({ ...base, stage: 'reveal', now: 10_000 })).toBe('');
  });
  it('tells the kid the hint is one miss away, and when it is showing', () => {
    expect(kidStatusText({ ...base, now: 20_000, missesLeftForHint: 1 })).toMatch(/Momo will show you/);
    expect(kidStatusText({ ...base, now: 20_000, hintShowing: true })).toMatch(/Momo showed you/);
  });
  it('a pad error only while drawing; the right-answer line carries the time', () => {
    expect(kidStatusText({ ...base, now: 1, error: 'no stroke data' })).toBe('no stroke data');
    expect(kidStatusText({ ...base, now: 1, error: 'no stroke data', stage: 'countdown' })).toBe(HICCUP_TEXT);
    expect(kidStatusText({ ...base, now: 20_000, stage: 'right', rightMs: 1834 })).toBe('You got it in 1.8 s! Wait for the others.');
    expect(kidStatusText({ ...base, now: 20_000, stage: 'countdown' })).toBe('');
  });
});

describe('reveal words', () => {
  it('names the fastest, a tie, or nobody', () => {
    expect(winnerLine([], false)).toMatch(/Time's up/);
    expect(winnerLine(['Mia'], false)).toBe('Mia was the fastest!');
    expect(winnerLine(['Mia'], true)).toBe('You were the fastest!');
    expect(winnerLine(['Mia', 'Leo'], true)).toBe('Mia and Leo tied for fastest!');
    expect(winnerLine(['Mia', 'Leo', 'Ava'], false)).toBe('Mia, Leo and Ava tied for fastest!');
    expect(seconds(1834)).toBe('1.8 s');
    expect(seconds(-5)).toBe('0.0 s');
  });
});

describe('solo route', () => {
  it('#/solo shows the solo game only while one is running', () => {
    expect(screenFor('#/solo', () => false, () => true)).toEqual({ screen: 'solo' });
    expect(screenFor('#/solo', () => false, () => false)).toEqual({ screen: 'home', code: '' });
    expect(screenFor('#/solo', () => false)).toEqual({ screen: 'home', code: '' });
  });
});

describe('what the pad does after the room answers', () => {
  const st = (rightAt: number | null, turn = 0) => ({ progress: { me: { turn, rightAt } } });
  it('follows the room: right, wrong, or draw again (a number another tab used, or a retried miss)', () => {
    expect(strokeOutcome({ verdict: 'correct', state: st(10) }, 'me', 0)).toBe('right');
    expect(strokeOutcome({ verdict: 'mistake', state: st(null) }, 'me', 0)).toBe('wrong');
    expect(strokeOutcome({ duplicate: true, state: st(null) }, 'me', 0)).toBe('again');
    // Lost response then retry: the room already has it right, so the pad shows right.
    expect(strokeOutcome({ duplicate: true, state: st(10) }, 'me', 0)).toBe('right');
    // Right on an earlier character does not count for this one.
    expect(strokeOutcome({ verdict: 'mistake', state: st(10, 0) }, 'me', 1)).toBe('wrong');
  });
  it('the "draw again" line shows, and the hiccup notice never outlives a confirmed answer (the page zeroes it)', () => {
    const base = { stage: 'drawing' as const, hiccupUntil: 0, now: 5, error: null, missesLeftForHint: 2, hintShowing: false };
    expect(kidStatusText({ ...base, again: true })).toBe('Draw it one more time!');
    expect(kidStatusText({ ...base, stage: 'right', rightMs: 1200 })).toMatch(/You got it in 1.2 s/);
  });
});

import { insideBox } from '../src/client/tracer';

describe('draw inside the box', () => {
  it('a drag far off the pad is not sent; the kid is told to draw inside the box', () => {
    expect(insideBox([[10, 10], [290, 290]], 300)).toBe(true);
    expect(insideBox([[10, 10], [310, 300]], 300)).toBe(true); // a little over the edge is fine
    expect(insideBox([[10, 10], [900, 40]], 300)).toBe(false);
    expect(insideBox([[-200, 10], [100, 40]], 300)).toBe(false);
    const base = { stage: 'drawing' as const, hiccupUntil: 0, now: 5, error: null, missesLeftForHint: 2, hintShowing: false };
    expect(kidStatusText({ ...base, outside: true })).toBe('Draw inside the box!');
  });
});
