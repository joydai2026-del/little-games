// What the internet can reach: public routes only, no RPC over HTTP, admin
// behind a verified Access token, POST + Origin + CSRF on every state change.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller, cookiesFrom, accessToken, METHODS, HUB, type Hub } from './support/harness';
import { adminPost } from './support/admin-call';
import { randomToken, sha256Hex } from '../src/crypto';

afterEach(() => vi.unstubAllGlobals());

describe('public routes', () => {
  it('/healthz answers {ok, version}', async () => {
    const h = await buildHub();
    expect(await (await h.fetch('/healthz')).json()).toEqual({ ok: true, version: 'test' });
  });

  it('/internal/*, /rpc, /HubService and every method name are 404 on every verb', async () => {
    const h = await buildHub();
    const paths = ['/internal/x', '/internal', '/rpc', '/HubService', ...METHODS.map((m) => `/${m}`), ...METHODS.map((m) => `/HubService/${m}`)];
    for (const p of paths) {
      for (const method of ['GET', 'POST']) {
        const res = await h.fetch(p, { method, body: method === 'POST' ? '{}' : undefined });
        expect(res.status, `${method} ${p}`).toBe(404);
      }
    }
  });

  it('/billing/* and /stripe/webhook are 501 with a plain message', async () => {
    const h = await buildHub();
    for (const p of ['/billing/checkout', '/billing', '/stripe/webhook']) {
      const res = await h.fetch(p, { method: 'POST' });
      expect(res.status).toBe(501);
      expect(await res.text()).toContain('Subscriptions are not open yet');
    }
  });

  it('an unexpected error never leaks a stack', async () => {
    const h = await buildHub();
    (h.env as unknown as { DB: unknown }).DB = { prepare() { throw new Error('secret internals at src/db/x.ts:1'); } };
    const s = await h.fetch('/me', { cookies: { '__Host-avery_hub': `v1.${randomToken(32)}` } });
    expect(await s.text()).not.toContain('secret internals');
  });
});

describe('admin', () => {
  it('every /admin/* path is 403 without a valid Access token', async () => {
    const h = await buildHub();
    const nowS = Math.floor(h.clock.t / 1000);
    const bad = [
      '',
      'garbage',
      await accessToken(h, { aud: 'other-app' }),
      await accessToken(h, { iss: 'https://evil.test' }),
      await accessToken(h, { exp: nowS - 600 }),
      await h.google.sign({ iss: 'https://team.access.test', aud: 'aud-test', email: 'x', exp: nowS + 60 }), // wrong signing key
    ];
    for (const path of ['/admin', '/admin/x', '/admin/grant-access', '/admin/revoke-access', '/admin/move-teacher', '/admin/grant-seats']) {
      for (const t of bad) {
        const res = await adminPost(h, path, { reason: 'x' }, t);
        expect(res.status, `${path} with ${t.slice(0, 10)}`).toBe(403);
      }
      expect((await h.fetch(path)).status).toBe(403);
    }
  });

  it('with Access config missing, admin is 403 even with a well-signed token', async () => {
    const h = await buildHub({ vars: { ACCESS_AUD: '' } });
    expect((await adminPost(h, '/admin/grant-access', { reason: 'x' })).status).toBe(403);
  });

  it('grantAccess, revokeAccess, grantSeats, moveTeacher work and each writes admin_log', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = String(h.db.raw.prepare('SELECT id FROM teachers').get()!.id);
    await h.core.saveList(h.env, caller(h), a.gameSessionId, { title: 'Old account list', items: ['一'] });
    const until = new Date(h.clock.t + 30 * 86_400_000).toISOString();
    expect((await adminPost(h, '/admin/grant-access', { teacherId: A, until, reason: 'pilot school' })).status).toBe(200);
    const e = await h.core.entitlement(h.env, caller(h), a.gameSessionId);
    expect(e.ok && e.plan).toBe('paid');
    expect((await adminPost(h, '/admin/grant-seats', { emails: ['New@s.org'], until, school: 'PS 1', reason: 'PO 42' })).status).toBe(200);
    const b = await signIn(h, { sub: 'g-b', email: 'new@s.org' });
    const eb = await h.core.entitlement(h.env, caller(h), b.gameSessionId);
    expect(eb.ok && eb.plan).toBe('paid');
    const B = String(h.db.raw.prepare('SELECT id FROM teachers WHERE email = ?').get('new@s.org')!.id);
    expect((await adminPost(h, '/admin/move-teacher', { fromTeacherId: A, toTeacherId: B, reason: 'lost school account' })).status).toBe(200);
    const lb = await h.core.listLists(h.env, caller(h), b.gameSessionId);
    expect(lb.ok && lb.lists.map((l) => l.title)).toEqual(['Old account list']);
    expect(await h.core.resolveSession(h.env, caller(h), a.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: B, reason: 'refund' })).status).toBe(200);
    const log = h.db.raw.prepare('SELECT actor, action FROM admin_log ORDER BY at, action').all();
    expect(log.map((r) => r.action).sort()).toEqual(['grantAccess', 'grantSeats', 'moveTeacher', 'revokeAccess']);
    expect(log.every((r) => r.actor === 'admin@averystudio.org')).toBe(true);
  });

  it('admin needs a reason and refuses a foreign Origin', async () => {
    const h = await buildHub();
    expect((await adminPost(h, '/admin/grant-access', { teacherId: 'x', until: '2030-01-01' })).status).toBe(400);
    const res = await h.fetch('/admin/grant-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test', 'Cf-Access-Jwt-Assertion': await accessToken(h) },
      body: JSON.stringify({ teacherId: 'x', until: '2030-01-01', reason: 'r' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('HubService gate (game registry)', () => {
  it('refuses a wrong key, an unknown game, a game with no key set, and a method not listed', async () => {
    const h = await buildHub({ methods: { 'trace-race': ['resolveSession'] } });
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect(await h.core.resolveSession(h.env, { gameId: 'vocab', gameKey: randomToken(32) }, a.gameSessionId)).toEqual({ ok: false, error: 'refused' });
    expect(await h.core.resolveSession(h.env, { gameId: 'nope', gameKey: 'x' }, a.gameSessionId)).toEqual({ ok: false, error: 'refused' });
    expect(await h.core.resolveSession(h.env, { gameId: 'tianzige', gameKey: '' }, a.gameSessionId)).toEqual({ ok: false, error: 'refused' });
    expect(await h.core.resolveSession(h.env, null, a.gameSessionId)).toEqual({ ok: false, error: 'refused' });
    expect(await h.core.listLists(h.env, caller(h, 'trace-race'), a.gameSessionId)).toEqual({ ok: false, error: 'refused' });
  });

  it("audience: game X's key with game Y's session is refused", async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect(await h.core.resolveSession(h.env, caller(h, 'trace-race'), a.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect(await h.core.listLists(h.env, caller(h, 'trace-race'), a.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
  });
});

describe('state-changing hub routes', () => {
  async function signedIn(h: Hub) {
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const csrf = /name="csrf" value="([^"]+)"/.exec(await (await h.fetch('/me', { cookies: a.jar })).text())![1];
    return { a, csrf };
  }
  const form = (s: Record<string, string>) => new URLSearchParams(s).toString();

  it('refuse a missing or foreign Origin, a missing or wrong CSRF token, and GET', async () => {
    const h = await buildHub();
    const { a, csrf } = await signedIn(h);
    for (const path of ['/auth/signout', '/auth/signout-everywhere', '/me/delete']) {
      const post = (headers: Record<string, string>, body: string) =>
        h.fetch(path, { method: 'POST', cookies: a.jar, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body });
      expect((await post({}, form({ csrf, step: '2', confirm: 'DELETE' }))).status).toBe(403);
      expect((await post({ Origin: 'https://evil.test' }, form({ csrf, step: '2', confirm: 'DELETE' }))).status).toBe(403);
      expect((await post({ Origin: HUB }, form({ step: '2', confirm: 'DELETE' }))).status).toBe(403);
      expect((await post({ Origin: HUB }, form({ csrf: 'x'.repeat(64), step: '2', confirm: 'DELETE' }))).status).toBe(403);
      expect((await h.fetch(path, { cookies: a.jar })).status).toBe(404);
    }
    expect(await h.core.resolveSession(h.env, caller(h), a.gameSessionId)).toMatchObject({ ok: true });
  });
});

describe('device limit', () => {
  it('at MAX_TEACHER_DEVICES (3) a new sign-in asks which device to sign out; nothing is signed out silently', async () => {
    const h = await buildHub();
    const devs = [];
    for (let i = 0; i < 3; i++) devs.push(await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { ua: 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/130' }));
    const fourth = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { ua: 'Mozilla/5.0 (iPhone) Safari/605' });
    expect(fourth.page).not.toBeNull();
    const html = await fourth.page!.text();
    expect(html).toContain('Pick one to sign out');
    expect(html).toContain('Chrome on Mac');
    for (const d of devs) expect((await h.core.resolveSession(h.env, caller(h), d.gameSessionId)).ok).toBe(true);
    // Pick the first device.
    const pending = /name="pending" value="([^"]+)"/.exec(html)![1];
    const end = /name="end" value="([^"]+)"/.exec(html)![1];
    const res = await h.fetch('/auth/devices', {
      method: 'POST',
      cookies: fourth.jar,
      headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ pending, end }).toString(),
    });
    expect(res.status).toBe(303);
    const token = decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3));
    expect((await h.core.redeemHandoff(h.env, caller(h), token, fourth.bind)).ok).toBe(true);
    const alive = await Promise.all(devs.map((d) => h.core.resolveSession(h.env, caller(h), d.gameSessionId)));
    expect(alive.filter((r) => r.ok).length).toBe(2);
    expect(Number(h.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n)).toBe(3);
    expect(cookiesFrom(res)['__Host-avery_hub']).toBeTruthy();
  });

  it("the picker cannot end another teacher's device or be replayed", async () => {
    const h = await buildHub();
    const b = await signIn(h, { sub: 'g-b', email: 'b@s.org' });
    for (let i = 0; i < 3; i++) await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const fourth = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const html = await fourth.page!.text();
    const pending = /name="pending" value="([^"]+)"/.exec(html)![1];
    const bHash = String(h.db.raw.prepare(`SELECT s.id_hash FROM sessions s JOIN teachers t ON t.id = s.teacher_id WHERE t.email = 'b@s.org'`).get()!.id_hash);
    const post = (end: string) =>
      h.fetch('/auth/devices', { method: 'POST', cookies: fourth.jar, headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ pending, end }).toString() });
    expect((await post(bHash)).status).toBe(400);
    expect((await h.core.resolveSession(h.env, caller(h), b.gameSessionId)).ok).toBe(true);
    const aHash = /name="end" value="([^"]+)"/.exec(html)![1];
    expect((await post(aHash)).status).toBe(400); // pending token already burnt
  });
});

describe('rate limits', () => {
  it('/auth/start and redeemHandoff use their limiter bindings', async () => {
    const seen: string[] = [];
    const deny = { limit: async ({ key }: { key: string }) => (seen.push(key), { success: false }) };
    const h = await buildHub({ vars: { AUTH_START_LIMITER: deny, REDEEM_LIMITER: deny } });
    const bindHash = await sha256Hex(randomToken(32));
    expect((await h.fetch(`/auth/start?game=vocab&bind=${bindHash}`)).status).toBe(429);
    expect(await h.core.redeemHandoff(h.env, caller(h), `v1.${randomToken(32)}`, randomToken(32))).toEqual({ ok: false, error: 'rate_limited' });
    expect(seen[0]).toBe(`vocab:${bindHash}`);
  });
});
