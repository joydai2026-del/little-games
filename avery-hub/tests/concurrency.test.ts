// Plan "Atomic writes": 10 concurrent calls, exactly the allowed number win.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setDefaultVars, buildHub, signIn, caller } from './support/harness';
import { randomToken, sha256Hex } from '../src/crypto';

// These tests cover the free-tier rules, which JJ switched off on 2026-09-29
// (FREE_TIER_ENABLED=false). They still guard the code for the day it is on.
setDefaultVars({ FREE_TIER_ENABLED: 'true' });
afterEach(() => vi.unstubAllGlobals());

const wins = (rs: { ok: boolean }[]) => rs.filter((r) => r.ok).length;

describe('concurrency', () => {
  it('10 concurrent taste rounds: exactly FREE_TASTE_ROUNDS_PER_DAY (1) succeed', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const rs = await Promise.all(Array.from({ length: 10 }, () => h.core.useTaste(h.env, caller(h), a.gameSessionId, 'climb')));
    expect(wins(rs)).toBe(1);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'no_taste_left')).toBe(true);
  });

  it('with FREE_TASTE_ROUNDS_PER_DAY=3, exactly 3 succeed; tomorrow resets', async () => {
    const h = await buildHub({ vars: { FREE_TASTE_ROUNDS_PER_DAY: '3' } });
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const rs = await Promise.all(Array.from({ length: 10 }, () => h.core.useTaste(h.env, caller(h), a.gameSessionId, 'climb')));
    expect(wins(rs)).toBe(3);
    h.clock.t += 86_400_000;
    const b = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect((await h.core.useTaste(h.env, caller(h), b.gameSessionId, 'climb')).ok).toBe(true);
  });

  it('10 concurrent free-game switches to different modes: exactly 1 succeeds', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const modes = ['memory', 'race', 'climb'];
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, modes[i % 3])));
    expect(wins(rs)).toBe(1);
  });

  it('10 concurrent new-list saves by a free teacher: exactly FREE_LIST_LIMIT (1) succeed', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => h.core.saveList(h.env, caller(h), a.gameSessionId, { title: `L${i}`, items: ['一'] })));
    expect(wins(rs)).toBe(1);
    expect(h.db.raw.prepare('SELECT COUNT(*) AS n FROM lists').get()).toEqual({ n: 1 });
  });

  it('10 concurrent redemptions of one hand-off token: exactly 1 succeeds', async () => {
    const h = await buildHub();
    const first = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const bind = randomToken(32);
    const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(bind)}`, { cookies: first.jar });
    const token = decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3));
    const rs = await Promise.all(Array.from({ length: 10 }, () => h.core.redeemHandoff(h.env, caller(h), token, bind)));
    expect(wins(rs)).toBe(1);
  });
});
