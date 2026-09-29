import { describe, expect, it } from 'vitest';
import { goTo, headerLinkOn, screenFor } from '../src/client/route';

describe('screenFor', () => {
  const none = () => false;
  it('home, room, and join with the code filled in', () => {
    expect(screenFor('#/', none)).toEqual({ screen: 'home', code: '' });
    expect(screenFor('#/room/abcd', none)).toEqual({ screen: 'room', code: 'ABCD' });
    expect(screenFor('#/join/abcd', none)).toEqual({ screen: 'home', code: 'ABCD' });
  });
  it('reopening the join link with a saved seat goes straight back into the room', () => {
    expect(screenFor('#/join/ABCD', (c) => c === 'ABCD')).toEqual({ screen: 'room', code: 'ABCD' });
  });
});

describe('goTo', () => {
  it('re-runs routing when already on the hash', () => {
    let fired = 0;
    const win = { location: { hash: '#/join/ABCD' }, dispatchEvent: () => (fired++, true) };
    goTo('#/join/ABCD', win, () => ({}) as Event);
    expect(fired).toBe(1);
    goTo('/room/ABCD', win, () => ({}) as Event);
    expect(win.location.hash).toBe('#/room/ABCD');
  });
});

describe('headerLinkOn', () => {
  const s = (role: 'kid' | 'teacher', phase: 'lobby' | 'racing' | 'done', inRound: boolean) => ({ role, phase, me: inRound ? {} : null }) as never;
  it('a writer in a live round gets a plain header; everyone else keeps the link', () => {
    expect(headerLinkOn(s('kid', 'racing', true))).toBe(false);
    expect(headerLinkOn(s('kid', 'racing', false))).toBe(true);
    expect(headerLinkOn(s('teacher', 'racing', true))).toBe(true);
    expect(headerLinkOn(s('kid', 'done', true))).toBe(true);
  });
});
