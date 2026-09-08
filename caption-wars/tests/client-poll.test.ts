// The pure parts of the client: how often it polls, what the countdown says,
// and where a player's identity is filed. No DOM, no jsdom: these functions
// are deliberately free of both so they can be checked here.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLL_MS,
  HIDDEN_POLL_MS,
  JITTER_RATIO,
  MIN_POLL_MS,
  countdownMs,
  countdownSeconds,
  jitter,
  pollDelay,
} from '../src/client/poll';
import {
  identityKey,
  normalizeCode,
  readIdentity,
  writeIdentity,
  forgetIdentity,
  type StorageLike,
} from '../src/client/state';

/** A stand-in for sessionStorage that records exactly what was written. */
function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('jitter', () => {
  it('spreads a delay by exactly +/- 20 percent', () => {
    expect(jitter(1000, () => 0)).toBe(1000 * (1 - JITTER_RATIO));
    expect(jitter(1000, () => 1)).toBe(1000 * (1 + JITTER_RATIO));
    expect(jitter(1000, () => 0.5)).toBe(1000);
  });

  it('never leaves the band for any random value', () => {
    for (let i = 0; i <= 20; i += 1) {
      const value = jitter(2000, () => i / 20);
      expect(value).toBeGreaterThanOrEqual(1600);
      expect(value).toBeLessThanOrEqual(2400);
    }
  });
});

describe('pollDelay', () => {
  it('follows the cadence the server asked for', () => {
    expect(pollDelay(2000, false, () => 0.5)).toBe(2000);
    expect(pollDelay(3000, false, () => 0)).toBe(2400);
    expect(pollDelay(3000, false, () => 1)).toBe(3600);
  });

  it('backs off to 10 seconds when the tab is hidden', () => {
    expect(pollDelay(2000, true, () => 0.5)).toBe(HIDDEN_POLL_MS);
    expect(pollDelay(2000, true, () => 0)).toBe(HIDDEN_POLL_MS * 0.8);
    expect(pollDelay(2000, true, () => 1)).toBe(HIDDEN_POLL_MS * 1.2);
  });

  it('does not speed up a slow room just because the tab is hidden', () => {
    expect(pollDelay(30000, true, () => 0.5)).toBe(30000);
  });

  it('stops for good on nextPollMs 0', () => {
    expect(pollDelay(0, false, () => 0.5)).toBe(0);
    expect(pollDelay(0, true, () => 0.5)).toBe(0);
  });

  it('falls back to the default cadence when the server says nothing', () => {
    expect(pollDelay(undefined, false, () => 0.5)).toBe(DEFAULT_POLL_MS);
    expect(pollDelay(Number.NaN, false, () => 0.5)).toBe(DEFAULT_POLL_MS);
  });

  it('never polls faster than the floor', () => {
    expect(pollDelay(10, false, () => 0)).toBe(MIN_POLL_MS);
  });
});

describe('countdownMs', () => {
  const endsAt = 1_000_000;

  it('uses the server clock, not the device clock', () => {
    // Phone is 30s BEHIND the server: offset = serverTime - Date.now() = +30000.
    expect(countdownMs(endsAt, 30_000, endsAt - 45_000)).toBe(15_000);
    // Phone is 30s AHEAD of the server: offset = -30000.
    expect(countdownMs(endsAt, -30_000, endsAt - 15_000)).toBe(45_000);
    // Clocks agree.
    expect(countdownMs(endsAt, 0, endsAt - 20_000)).toBe(20_000);
  });

  it('clamps at zero once the deadline has passed', () => {
    expect(countdownMs(endsAt, 0, endsAt)).toBe(0);
    expect(countdownMs(endsAt, 0, endsAt + 60_000)).toBe(0);
    expect(countdownMs(endsAt, 5_000, endsAt)).toBe(0);
  });

  it('reads a phase with no deadline as zero', () => {
    expect(countdownMs(undefined, 0, 123)).toBe(0);
    expect(countdownMs(Number.NaN, 0, 123)).toBe(0);
  });
});

describe('countdownSeconds', () => {
  it('rounds up, so any time left still shows a second', () => {
    expect(countdownSeconds(1)).toBe(1);
    expect(countdownSeconds(1000)).toBe(1);
    expect(countdownSeconds(1001)).toBe(2);
    expect(countdownSeconds(0)).toBe(0);
    expect(countdownSeconds(-500)).toBe(0);
  });
});

describe('room code', () => {
  it('forces four upper-case letters', () => {
    expect(normalizeCode('abcd')).toBe('ABCD');
    expect(normalizeCode(' a b c d ')).toBe('ABCD');
    expect(normalizeCode('ab3cd9')).toBe('AB3C');
    expect(normalizeCode('b83d')).toBe('B83D');
    expect(normalizeCode('a-b_c d!')).toBe('ABCD');
    expect(normalizeCode('abcdefgh')).toBe('ABCD');
    expect(normalizeCode('')).toBe('');
  });
});

describe('identity in sessionStorage', () => {
  it('files one entry per room code, upper case', () => {
    expect(identityKey('abcd')).toBe('cw.player.ABCD');
    expect(identityKey('ABCD')).toBe('cw.player.ABCD');
  });

  it('writes and reads back the same seat', () => {
    const storage = fakeStorage();
    writeIdentity('abcd', { playerId: 'p1', playerSecret: 's1' }, storage);
    expect([...storage.map.keys()]).toEqual(['cw.player.ABCD']);
    expect(readIdentity('ABCD', storage)).toEqual({ playerId: 'p1', playerSecret: 's1' });
  });

  it('keeps two rooms apart', () => {
    const storage = fakeStorage();
    writeIdentity('ABCD', { playerId: 'p1', playerSecret: 's1' }, storage);
    writeIdentity('WXYZ', { playerId: 'p2', playerSecret: 's2' }, storage);
    expect(readIdentity('ABCD', storage)?.playerId).toBe('p1');
    expect(readIdentity('WXYZ', storage)?.playerId).toBe('p2');
  });

  it('returns null for a room we have never joined, and after leaving', () => {
    const storage = fakeStorage();
    expect(readIdentity('ABCD', storage)).toBeNull();
    writeIdentity('ABCD', { playerId: 'p1', playerSecret: 's1' }, storage);
    forgetIdentity('ABCD', storage);
    expect(readIdentity('ABCD', storage)).toBeNull();
  });

  it('treats a corrupt or half-written entry as never joined', () => {
    const storage = fakeStorage();
    storage.map.set('cw.player.ABCD', 'not json');
    expect(readIdentity('ABCD', storage)).toBeNull();
    storage.map.set('cw.player.ABCD', JSON.stringify({ playerId: 'p1' }));
    expect(readIdentity('ABCD', storage)).toBeNull();
  });

  it('survives storage being switched off entirely', () => {
    expect(readIdentity('ABCD', null)).toBeNull();
    expect(() => writeIdentity('ABCD', { playerId: 'p', playerSecret: 's' }, null)).not.toThrow();
  });
});
