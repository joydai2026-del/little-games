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
