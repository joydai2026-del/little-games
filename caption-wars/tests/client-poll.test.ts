// The pure parts of the client: how often it polls, what the countdown says,
// and where a player's identity is filed. No DOM, no jsdom: these functions
// are deliberately free of both so they can be checked here.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLL_MS,
  ERROR_BACKOFF_AFTER,
  ERROR_POLL_MS,
  HIDDEN_POLL_MS,
  JITTER_RATIO,
  MIN_POLL_MS,
  countdownMs,
  countdownSeconds,
  errorPollDelay,
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

describe('errorPollDelay', () => {
  const noJitter = () => 0.5;

  it('retries at the error cadence for the first few failures', () => {
    expect(errorPollDelay(1, false, noJitter)).toBe(ERROR_POLL_MS);
    expect(errorPollDelay(ERROR_BACKOFF_AFTER - 1, false, noJitter)).toBe(ERROR_POLL_MS);
  });

  it('falls back to the hidden-tab cadence once failures pile up', () => {
    expect(errorPollDelay(ERROR_BACKOFF_AFTER, false, noJitter)).toBe(HIDDEN_POLL_MS);
    expect(errorPollDelay(ERROR_BACKOFF_AFTER + 20, false, noJitter)).toBe(HIDDEN_POLL_MS);
  });

  it('never retries a hidden tab at the fast cadence', () => {
    expect(errorPollDelay(1, true, noJitter)).toBe(HIDDEN_POLL_MS);
  });
});

describe('room code', () => {
  it('forces four upper-case characters from the room alphabet (letters and digits 2-9)', () => {
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

// --- startPolling: the loop itself, on a hand-rolled fake DOM ---------------
//
// Round 4 should-fixes. The poll chain is a bug class of its own (a doubled
// chain, a dead chain, a listener that outlives its loop) and until now nothing
// drove `startPolling`: the round-4 reviewer proved it with probes that were
// then deleted. About forty lines of fakes are enough to keep it.

interface FakeTimer {
  id: number;
  fn: () => void;
  at: number;
}

/** window.setTimeout / clearTimeout plus a document with a listener list. */
function fakeDom(): {
  install(): void;
  restore(): void;
  runNext(): boolean;
  pending(): number;
  fire(type: string): void;
  listeners(type: string): number;
} {
  const timers: FakeTimer[] = [];
  const listeners = new Map<string, Array<() => void>>();
  let nextId = 1;
  let clock = 0;
  const saved: Record<string, unknown> = {};
  const g = globalThis as Record<string, unknown>;

  return {
    install() {
      for (const key of ['window', 'document']) saved[key] = g[key];
      g.window = {
        setTimeout: (fn: () => void, ms: number) => {
          const id = nextId++;
          timers.push({ id, fn, at: clock + ms });
          return id;
        },
        clearTimeout: (id: number) => {
          const i = timers.findIndex((t) => t.id === id);
          if (i >= 0) timers.splice(i, 1);
        },
      };
      g.document = {
        hidden: false,
        addEventListener: (type: string, fn: () => void) => {
          listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        removeEventListener: (type: string, fn: () => void) => {
          listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
        },
      };
    },
    restore() {
      for (const key of ['window', 'document']) g[key] = saved[key];
    },
    runNext() {
      const next = timers.shift();
      if (!next) return false;
      clock = next.at;
      next.fn();
      return true;
    },
    pending: () => timers.length,
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    listeners: (type: string) => (listeners.get(type) ?? []).length,
  };
}

describe('startPolling', () => {
  it('keeps retrying when onError throws, instead of dying silently', async () => {
    const dom = fakeDom();
    dom.install();
    try {
      const { startPolling } = await import('../src/client/poll');
      let fetches = 0;
      const stop = startPolling({
        getVersion: () => 1,
        fetchOnce: async () => {
          fetches += 1;
          throw new Error('the room stopped answering');
        },
        onEnvelope: () => {},
        onError: () => {
          throw new Error('a repaint blew up');
        },
        isHidden: () => false,
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(fetches).toBe(1);
      // The retry was scheduled even though the callback threw. Before the fix
      // onError ran BEFORE schedule(), so one bad repaint killed the loop for
      // the rest of the session.
      expect(dom.pending()).toBe(1);
      dom.runNext();
      await Promise.resolve();
      await Promise.resolve();
      expect(fetches).toBe(2);
      stop();
    } finally {
      dom.restore();
    }
  });

  it('drops its visibility listener when the loop stops itself at done', async () => {
    const dom = fakeDom();
    dom.install();
    try {
      const { startPolling } = await import('../src/client/poll');
      startPolling({
        getVersion: () => 1,
        // nextPollMs 0 is the server saying "the game is over, stop asking"
        fetchOnce: async () => ({ nextPollMs: 0 }),
        onEnvelope: () => {},
        onError: () => {},
        isHidden: () => false,
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(dom.pending()).toBe(0);
      expect(dom.listeners('visibilitychange')).toBe(0);
    } finally {
      dom.restore();
    }
  });

  it('a visibility change while a poll is in flight cannot double the poll chain', async () => {
    const dom = fakeDom();
    dom.install();
    try {
      const { startPolling } = await import('../src/client/poll');
      let fetches = 0;
      let release: undefined | (() => void);
      const stop = startPolling({
        getVersion: () => 1,
        fetchOnce: async () => {
          fetches += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { nextPollMs: 2000 };
        },
        onEnvelope: () => {},
        onError: () => {},
        isHidden: () => false,
      });

      await Promise.resolve();
      expect(fetches).toBe(1);
      dom.fire('visibilitychange');
      dom.fire('visibilitychange');
      expect(fetches).toBe(1); // the in-flight guard held

      (release as undefined | (() => void))?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(dom.pending()).toBe(1); // exactly one chain, not three
      stop();
      expect(dom.listeners('visibilitychange')).toBe(0);
    } finally {
      dom.restore();
    }
  });
});
