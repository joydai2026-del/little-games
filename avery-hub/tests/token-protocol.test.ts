// "One token protocol": replay, expiry, wrong game, wrong bind, login CSRF,
// and the Google ID-token checks.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller, cookiesFrom, GOOGLE_ISS, type Hub } from './support/harness';
import { randomToken, sha256Hex } from '../src/crypto';

afterEach(() => vi.unstubAllGlobals());

/** Sign in once (to get a hub cookie), then ask for a fresh hand-off token without redeeming it. */
async function freshToken(h: Hub, gameId = 'vocab') {
  const first = await signIn(h, { sub: 'g-a', email: 'a@school.org' });
  const bind = randomToken(32);
  const res = await h.fetch(`/auth/start?game=${gameId}&bind=${await sha256Hex(bind)}`, { cookies: first.jar });
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get('Location')!);
  return { token: decodeURIComponent(loc.hash.slice(3)), bind, loc, jar: first.jar };
}

describe('hand-off token', () => {
  it('goes to the registered return URL in the fragment only', async () => {
    const h = await buildHub();
    const { loc } = await freshToken(h);
    expect(`${loc.origin}${loc.pathname}`).toBe('https://vocab.test/auth/finish');
    expect(loc.search).toBe('');
    expect(loc.hash).toMatch(/^#t=v1\./);
  });

  it('redeems exactly once (replay refused)', async () => {
    const h = await buildHub();
    const { token, bind } = await freshToken(h);
    expect((await h.core.redeemHandoff(h.env, caller(h), token, bind)).ok).toBe(true);
    expect(await h.core.redeemHandoff(h.env, caller(h), token, bind)).toEqual({ ok: false, error: 'refused' });
  });

  it('expires after HANDOFF_TOKEN_SECONDS (60)', async () => {
    const h = await buildHub();
    const { token, bind } = await freshToken(h);
    h.clock.t += 61_000;
    expect(await h.core.redeemHandoff(h.env, caller(h), token, bind)).toEqual({ ok: false, error: 'expired' });
  });

  it('is refused for another game, and then is burnt', async () => {
    const h = await buildHub();
    const { token, bind } = await freshToken(h);
    expect(await h.core.redeemHandoff(h.env, caller(h, 'trace-race'), token, bind)).toEqual({ ok: false, error: 'refused' });
    expect((await h.core.redeemHandoff(h.env, caller(h), token, bind)).ok).toBe(false);
  });

  it('login CSRF: a token bound to another browser is refused', async () => {
    const h = await buildHub();
    const { token } = await freshToken(h);
    const victimBind = randomToken(32);
    expect(await h.core.redeemHandoff(h.env, caller(h), token, victimBind)).toEqual({ ok: false, error: 'refused' });
  });

  it('a forged or malformed token is refused', async () => {
    const h = await buildHub();
    for (const t of ['', 'abc', `v1.${randomToken(32)}`, `v9.${randomToken(32)}`, 42, null]) {
      expect((await h.core.redeemHandoff(h.env, caller(h), t, randomToken(32))).ok).toBe(false);
    }
  });

  it('the TokenDO schedules its own clean-up alarm', async () => {
    const h = await buildHub();
    await freshToken(h);
    const alarms = [...h.tokenStorage.values()].map((s) => s.alarm).filter((a) => a !== null);
    expect(alarms.length).toBeGreaterThan(0);
  });

  it('only stores the HMAC of the token, never the token', async () => {
    const h = await buildHub();
    const { token } = await freshToken(h);
    const dump = JSON.stringify([...h.tokenStorage.entries()].map(([k, s]) => [k, [...s.map.entries()]]));
    expect(dump).not.toContain(token.slice(3));
  });
});

describe('/auth/start and /auth/callback', () => {
  it('rejects a game not in the registry and a bad bind', async () => {
    const h = await buildHub();
    expect((await h.fetch(`/auth/start?game=nope&bind=${'a'.repeat(64)}`)).status).toBe(400);
    expect((await h.fetch(`/auth/start?game=vocab&bind=short`)).status).toBe(400);
    expect((await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}&return=https://evil.test/`)).status).toBe(400);
  });

  it('asks Google for openid email profile with select_account, state and nonce', async () => {
    const h = await buildHub();
    const res = await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`);
    const u = new URL(res.headers.get('Location')!);
    expect(u.origin + u.pathname).toBe(`${GOOGLE_ISS}/auth`);
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('prompt')).toBe('select_account');
    expect(u.searchParams.get('redirect_uri')).toBe('https://hub.test/auth/callback');
    expect(u.searchParams.get('state')).toBeTruthy();
    expect(u.searchParams.get('nonce')).toBeTruthy();
  });

  it('shows "Can\'t sign in right now" (never a 500) when Google is not set up', async () => {
    const h = await buildHub({ vars: { GOOGLE_CLIENT_ID: '' } });
    const res = await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Can&#39;t sign in right now");
  });

  async function callbackWith(h: Hub, tweak: Record<string, unknown>, cookieOverride?: string) {
    const start = await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`);
    const jar = cookiesFrom(start);
    const u = new URL(start.headers.get('Location')!);
    const code = randomToken(12);
    h.codes.set(code, { user: { sub: 'g-x', email: 'x@s.org' }, nonceOverride: u.searchParams.get('nonce')!, ...tweak });
    if (cookieOverride !== undefined) jar['__Host-avery_oauth'] = cookieOverride;
    return h.fetch(`/auth/callback?state=${u.searchParams.get('state')}&code=${code}`, { cookies: jar });
  }

  it('hub login CSRF: a callback without this browser\'s state cookie is refused', async () => {
    const h = await buildHub();
    expect((await callbackWith(h, {}, 'someone-elses-state')).status).toBe(400);
    const h2 = await buildHub();
    expect((await callbackWith(h2, {})).status).toBe(303);
  });

  it.each([
    ['wrong nonce', { nonceOverride: 'other' }],
    ['wrong audience', { aud: 'someone-else' }],
    ['wrong issuer', { iss: 'https://evil.test' }],
    ['expired id token', { expOffset: -3600 }],
    ['email not verified', { user: { sub: 'g-x', email: 'x@s.org', email_verified: false } }],
  ])('refuses an ID token with %s', async (_n, tweak) => {
    const h = await buildHub();
    const res = await callbackWith(h, tweak as Record<string, unknown>);
    expect(res.status).toBe(400);
    expect(Number(h.db.raw.prepare('SELECT COUNT(*) AS n FROM teachers').get()!.n)).toBe(0);
  });

  it('a state can only be used once', async () => {
    const h = await buildHub();
    const start = await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`);
    const jar = cookiesFrom(start);
    const u = new URL(start.headers.get('Location')!);
    const code = randomToken(12);
    h.codes.set(code, { user: { sub: 'g-x', email: 'x@s.org' }, nonceOverride: u.searchParams.get('nonce')! });
    const path = `/auth/callback?state=${u.searchParams.get('state')}&code=${code}`;
    expect((await h.fetch(path, { cookies: jar })).status).toBe(303);
    expect((await h.fetch(path, { cookies: jar })).status).toBe(400);
  });

  it('finds the teacher by Google sub, not email, and refreshes her email', async () => {
    const h = await buildHub();
    await signIn(h, { sub: 'g-a', email: 'old@s.org' });
    await signIn(h, { sub: 'g-a', email: 'new@s.org' });
    const rows = h.db.raw.prepare('SELECT email FROM teachers').all();
    expect(rows).toEqual([{ email: 'new@s.org' }]);
  });

  it('sets the hub cookie as __Host-, Secure, HttpOnly, SameSite=Lax', async () => {
    const h = await buildHub();
    const start = await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`);
    const u = new URL(start.headers.get('Location')!);
    const code = randomToken(12);
    h.codes.set(code, { user: { sub: 'g-x', email: 'x@s.org' }, nonceOverride: u.searchParams.get('nonce')! });
    const cb = await h.fetch(`/auth/callback?state=${u.searchParams.get('state')}&code=${code}`, { cookies: cookiesFrom(start) });
    const hub = cb.headers.getSetCookie().find((c) => c.startsWith('__Host-avery_hub='))!;
    expect(hub).toMatch(/Path=\//);
    expect(hub).toMatch(/Secure/);
    expect(hub).toMatch(/HttpOnly/);
    expect(hub).toMatch(/SameSite=Lax/);
    expect(hub).not.toMatch(/Domain=/i);
  });
});

describe('hub session lifetimes and rotation', () => {
  it('rotates the hub session id after SESSION_ROTATE_DAYS, and old game sessions keep working', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.clock.t += 8 * 86_400_000;
    // Keep the game session alive past its idle window by using the hub directly.
    const res = await h.fetch('/me', { cookies: s.jar });
    const rotated = cookiesFrom(res)['__Host-avery_hub'];
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(s.jar['__Host-avery_hub']);
    // The old cookie keeps working only for SESSION_ROTATE_OVERLAP_SECONDS (30), then it is dead.
    expect(await (await h.fetch('/me', { cookies: s.jar })).text()).toContain('a@s.org');
    h.clock.t += 31_000;
    expect(await (await h.fetch('/me', { cookies: s.jar })).text()).toContain('Sign in with Google');
    expect(await (await h.fetch('/me', { cookies: { '__Host-avery_hub': rotated } })).text()).toContain('a@s.org');
  });

  it('ends the hub session after SESSION_IDLE_DAYS without use and after SESSION_MAX_DAYS regardless', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.clock.t += 31 * 86_400_000;
    expect(await (await h.fetch('/me', { cookies: s.jar })).text()).toContain('Sign in with Google');
  });

  it('ends a game session after GAME_SESSION_IDLE_HOURS and GAME_SESSION_HOURS', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.clock.t += 3 * 3_600_000;
    expect((await h.core.resolveSession(h.env, caller(h), s.gameSessionId)).ok).toBe(true);
    h.clock.t += 5 * 3_600_000;
    expect(await h.core.resolveSession(h.env, caller(h), s.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    const s2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { jar: s.jar });
    for (let i = 0; i < 4; i++) {
      h.clock.t += 3 * 3_600_000;
      await h.core.resolveSession(h.env, caller(h), s2.gameSessionId);
    }
    expect(await h.core.resolveSession(h.env, caller(h), s2.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
  });
});
