// What the kid's word cards look like and say, from the room state.
import { describe, expect, it } from 'vitest';
import { cardsView } from '../src/client/cards';
import type { Attempt, PublicQuestion } from '../src/shared/types';

const q = (over: Partial<PublicQuestion> = {}): PublicQuestion => ({
  index: 0, total: 3, cards: ['山', '大人', '学校', '人'], startAt: 1000, endsAt: 20000, closedAt: null, nextAt: null,
  strokeMs: 900, char: null, strokes: null, answer: null, ...over,
});
const att = (over: Partial<Attempt> = {}): Attempt => ({ tried: [], locked: false, coolUntil: null, correctAt: null, points: 0, rightCard: null, ...over });

describe('cardsView', () => {
  it('all cards open once Momo starts, none before', () => {
    expect(cardsView(q(), null, 500, false)).toMatchObject({ canTap: false, message: 'Get ready, Momo is picking up the brush...' });
    expect(cardsView(q(), null, 1500, false)).toMatchObject({ looks: ['open', 'open', 'open', 'open'], canTap: true });
  });
  it('a right guess lights your card and shows your points', () => {
    const v = cardsView(q(), att({ correctAt: 1500, points: 870, rightCard: 1 }), 1600, false);
    expect(v.looks).toEqual(['off', 'right', 'off', 'off']);
    expect(v.message).toBe('好棒! +870. Wait for the others.');
  });
  it('locked (Grades 3-5): tried card crossed, the rest off', () => {
    const v = cardsView(q(), att({ tried: [2], locked: true }), 1600, false);
    expect(v.looks).toEqual(['off', 'off', 'tried', 'off']);
    expect(v.canTap).toBe(false);
  });
  it('cooling (K-2): cards come back after the pause, the tried one stays crossed', () => {
    const a = att({ tried: [0], coolUntil: 3000 });
    expect(cardsView(q(), a, 2000, false)).toMatchObject({ canTap: false, message: 'Not that one. Try again in a moment!' });
    expect(cardsView(q(), a, 3000, false).looks).toEqual(['tried', 'open', 'open', 'open']);
  });
  it('closed: the right card shows for everyone', () => {
    const v = cardsView(q({ closedAt: 9000, answer: 3 }), null, 9100, false);
    expect(v.looks).toEqual(['off', 'off', 'off', 'right']);
    expect(v.message).toBe('It was 人. Next time!');
  });
  it('no double taps while a guess is on its way', () => {
    expect(cardsView(q(), null, 1500, true)).toMatchObject({ canTap: false, message: 'Sending...' });
  });
});
