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

import { acceptState } from '../src/client/route';

describe('acceptState', () => {
  it('never lets an older poll answer replace newer state, even a forced one', () => {
    expect(acceptState(null, { version: 3 })).toBe(true);
    expect(acceptState({ version: 5 }, { version: 5 })).toBe(true);
    expect(acceptState({ version: 5 }, { version: 6 })).toBe(true);
    expect(acceptState({ version: 5 }, { version: 4 })).toBe(false);
  });
  it('room.ts uses it for every poll, with no bypass', async () => {
    const src = (await import('../src/client/screens/room.ts?raw')).default;
    expect(src).toContain('acceptState(ctx.state, res.state)');
    expect(src).not.toMatch(/version\s*>=\s*ctx\.state\.version\s*\|\|/);
  });
});
