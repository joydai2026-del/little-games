// The free and paid rules the hub owns in S1: free game (site-wide), cooldown,
// taste, list limit, classes paid-only, room passes, entitlement.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setDefaultVars, buildHub, signIn, caller, type Hub } from './support/harness';

// These tests cover the free-tier rules, which JJ switched off on 2026-09-29
// (FREE_TIER_ENABLED=false). They still guard the code for the day it is on.
setDefaultVars({ FREE_TIER_ENABLED: 'true' });
afterEach(() => vi.unstubAllGlobals());
const DAY = 86_400_000;
const tid = (h: Hub, email: string) => String(h.db.raw.prepare('SELECT id FROM teachers WHERE email = ?').get(email)!.id);

describe('free game (site-wide, "<gameId>:<mode>")', () => {
  it('first pick works, then the cooldown (FREE_MODE_SWITCH_COOLDOWN_DAYS=5) holds, then it opens', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const first = await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'race');
    expect(first).toMatchObject({ ok: true, freeGame: 'vocab:race' });
    const t = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { gameId: 'trace-race' });
    expect(await h.core.switchFreeMode(h.env, caller(h, 'trace-race'), t.gameSessionId, 'main')).toEqual({ ok: false, error: 'cooldown' });
    h.clock.t += 5 * DAY + 1;
    const t2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { gameId: 'trace-race' });
    expect(await h.core.switchFreeMode(h.env, caller(h, 'trace-race'), t2.gameSessionId, 'main')).toMatchObject({ ok: true, freeGame: 'trace-race:main' });
  });

  it('the cooldown length is config', async () => {
    const h = await buildHub({ vars: { FREE_MODE_SWITCH_COOLDOWN_DAYS: '1' } });
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'race');
    h.clock.t += DAY + 1;
    const b = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect((await h.core.switchFreeMode(h.env, caller(h), b.gameSessionId, 'climb')).ok).toBe(true);
  });

  it('only modes of the calling game, and only FREE_GAME_CHOICES', async () => {
    const h = await buildHub({ vars: { FREE_GAME_CHOICES: 'vocab:race,trace-race:main' } });
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect(await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'main')).toEqual({ ok: false, error: 'unknown_mode' });
    expect(await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'climb')).toEqual({ ok: false, error: 'not_allowed' });
    expect((await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'race')).ok).toBe(true);
    const e = await h.core.entitlement(h.env, caller(h), a.gameSessionId);
    expect(e.ok && e.freeGameChoices).toEqual(['vocab:race', 'trace-race:main']);
  });

  it('taste is refused for her own free game and for paid teachers', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'race');
    expect(await h.core.useTaste(h.env, caller(h), a.gameSessionId, 'race')).toEqual({ ok: false, error: 'not_needed' });
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ?').run(h.clock.t + DAY);
    expect(await h.core.useTaste(h.env, caller(h), a.gameSessionId, 'climb')).toEqual({ ok: false, error: 'not_needed' });
  });
});

describe('lists and classes', () => {
  it('a free teacher may replace her one list any time but not add a second; paid may add', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const c = caller(h);
    const one = await h.core.saveList(h.env, c, a.gameSessionId, { title: 'One', items: ['一'] });
    expect(one.ok).toBe(true);
    expect(await h.core.saveList(h.env, c, a.gameSessionId, { title: 'Two', items: ['二'] })).toEqual({ ok: false, error: 'list_limit' });
    expect((await h.core.saveList(h.env, c, a.gameSessionId, { id: one.ok ? one.id : '', title: 'One v2', items: ['三'] })).ok).toBe(true);
    const got = await h.core.getList(h.env, c, a.gameSessionId, one.ok ? one.id : '');
    expect(got.ok && got.list).toMatchObject({ title: 'One v2', items: ['三'] });
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ?').run(h.clock.t + DAY);
    expect((await h.core.saveList(h.env, c, a.gameSessionId, { title: 'Two', items: ['二'] })).ok).toBe(true);
  });

  it('refuses a bad list (no items, too many, too big, bad title)', async () => {
    const h = await buildHub({ vars: { LIST_MAX_ITEMS: '3', LIST_MAX_BYTES: '50' } });
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    for (const bad of [{ title: 'x', items: [] }, { title: 'x', items: ['1', '2', '3', '4'] }, { title: 'x', items: ['x'.repeat(60)] }, { title: '', items: ['1'] }, null]) {
      expect(await h.core.saveList(h.env, caller(h), a.gameSessionId, bad)).toEqual({ ok: false, error: 'bad_list' });
    }
  });

  it('classes are paid only', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect(await h.core.saveClass(h.env, caller(h), a.gameSessionId, { name: 'Class 1' })).toEqual({ ok: false, error: 'paid_only' });
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ?').run(h.clock.t + DAY);
    const r = await h.core.saveClass(h.env, caller(h), a.gameSessionId, { name: 'Class 1' });
    expect(r.ok && r.classCode).toMatch(/^[A-Z2-9]{6}$/);
  });
});

describe('room passes', () => {
  it('free teacher: pass carries only her free mode for this game; other games get none', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect(await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1')).toEqual({ ok: false, error: 'no_modes' });
    await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'race');
    const p = await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1');
    expect(p).toMatchObject({ ok: true, allowedModes: ['race'] });
    expect(p.ok && p.expiresAt).toBe(h.clock.t + 4 * 3_600_000);
    const t = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { gameId: 'trace-race' });
    expect(await h.core.mintRoomPass(h.env, caller(h, 'trace-race'), t.gameSessionId, 'ROOM2')).toEqual({ ok: false, error: 'no_modes' });
  });

  it('checkRoomPass: valid, then expired after ROOM_PASS_HOURS; audience-checked; revoked on entitlement change', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ?').run(h.clock.t + DAY);
    const p = await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1');
    if (!p.ok) throw new Error('mint');
    expect(p.allowedModes).toEqual(['memory', 'race', 'climb']);
    expect(await h.core.checkRoomPass(h.env, caller(h), p.passId)).toMatchObject({ ok: true, valid: true, roomCode: 'ROOM1' });
    expect(await h.core.checkRoomPass(h.env, caller(h, 'trace-race'), p.passId)).toEqual({ ok: true, valid: false, reason: 'unknown' });
    h.db.raw.prepare('UPDATE teachers SET entitlement_version = entitlement_version + 1').run();
    expect(await h.core.checkRoomPass(h.env, caller(h), p.passId)).toEqual({ ok: true, valid: false, reason: 'revoked' });
    h.db.raw.prepare('UPDATE teachers SET entitlement_version = entitlement_version - 1').run();
    h.clock.t += 4 * 3_600_000 + 1;
    expect(await h.core.checkRoomPass(h.env, caller(h), p.passId)).toEqual({ ok: true, valid: false, reason: 'expired' });
  });
});

describe('entitlement', () => {
  it('reports plan, free game, cooldown, taste left and list limit from config', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    await h.core.switchFreeMode(h.env, caller(h), a.gameSessionId, 'race');
    const e = await h.core.entitlement(h.env, caller(h), a.gameSessionId);
    expect(e).toMatchObject({ ok: true, plan: 'free', freeGame: 'vocab:race', freeGameLockedUntil: h.clock.t + 5 * DAY, tasteRoundsLeft: 1, listLimit: 1, listsSaved: 0, email: 'a@s.org', trialDays: 0, anonFreeRounds: 'unlimited' });
    expect(tid(h, 'a@s.org')).toBeTruthy();
  });

  it('authorizeRound is a typed "not implemented in S1"', async () => {
    const h = await buildHub();
    expect(await h.core.authorizeRound(h.env, caller(h))).toEqual({ ok: false, error: 'not_implemented_in_s1' });
  });
});
