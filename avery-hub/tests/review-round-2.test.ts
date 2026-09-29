// Regression tests for review round 2.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller, cookiesFrom, accessToken, Issuer, HUB, ACCESS_ISS, type Hub } from './support/harness';
import { adminPost } from './support/admin-call';
import { injectBefore } from './support/inject';
import { randomToken, sha256Hex, hashPresented } from '../src/crypto';
import { forTeacher, rotateHubSession } from '../src/db';
import { HubService } from '../src/rpc/hub-service';

afterEach(() => vi.unstubAllGlobals());

const DAY = 86_400_000;
const tid = (h: Hub, email: string) => String(h.db.raw.prepare('SELECT id FROM teachers WHERE email = ?').get(email)!.id);
const count = (h: Hub, sql: string, ...p: unknown[]) => Number(h.db.raw.prepare(sql).get(...p)!.n);
const certFetches = (h: Hub) => h.fetchLog.filter((u) => u.includes('/cdn-cgi/access/certs')).length;

async function startToken(h: Hub, jar: Record<string, string>) {
  const bind = randomToken(32);
  const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(bind)}`, { cookies: jar });
  return { bind, token: decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3)) };
}

describe('1-2. address bucket', () => {
  it('60 junk starts from a school address do not block a signed-in teacher on the same address', async () => {
    const h = await buildHub();
    const ip = { 'CF-Connecting-IP': '198.51.100.7' };
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    for (let i = 0; i < 60; i++) await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(randomToken(32))}`, { headers: ip });
    expect((await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(randomToken(32))}`, { headers: ip })).status).toBe(429);
    const bind = randomToken(32);
    const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(bind)}`, { headers: ip, cookies: s.jar });
    expect(res.status).toBe(303);
    const token = decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3));
    expect((await h.core.redeemHandoff(h.env, caller(h), token, bind)).ok).toBe(true);
  });

  it('a request without request.cf (a same-zone subrequest) gets no address bucket, only the per-bind one', async () => {
    const h = await buildHub();
    for (let i = 0; i < 70; i++) {
      const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(randomToken(32))}`, { edge: false, headers: { 'CF-Connecting-IP': `10.0.0.${i}` } });
      expect(res.status).toBe(302);
    }
    expect(h.limiters.AUTH_ADDRESS_LIMITER.keys).toEqual([]);
    const bind = await sha256Hex(randomToken(32));
    const st: number[] = [];
    for (let i = 0; i < 21; i++) st.push((await h.fetch(`/auth/start?game=vocab&bind=${bind}`, { edge: false })).status);
    expect(st[20]).toBe(429);
  });

  it('an edge request with no address header fails closed', async () => {
    const h = await buildHub();
    const req = new Request(`${HUB}/auth/start?game=vocab&bind=${'a'.repeat(64)}`);
    Object.defineProperty(req, 'cf', { value: { colo: 'TEST' } });
    const { default: worker } = await import('../src/index');
    expect((await worker.fetch(req as never, h.env)).status).toBe(503);
  });
});

describe('3. JWKS', () => {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = (kid: string) => `${enc({ alg: 'RS256', kid })}.${enc({ iss: ACCESS_ISS, aud: 'aud-test', exp: 9e9 })}.AA`;

  it('a rotated key is fetched the first time its kid is seen, even right after a forged-kid refresh', async () => {
    const h = await buildHub();
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' })).status).toBe(200); // warm cache
    h.clock.t += 11_000;
    expect((await adminPost(h, '/admin/x', { reason: 'r' }, forged('A'))).status).toBe(403); // forged kid refresh
    const rotated = await new Issuer().init();
    h.accessCerts.extra.push(rotated);
    h.clock.t += 11_000; // past JWKS_MIN_REFRESH_SECONDS (10)
    const nowS = Math.floor(h.clock.t / 1000);
    const tok = await rotated.sign({ iss: ACCESS_ISS, aud: 'aud-test', email: 'admin@averystudio.org', exp: nowS + 300 });
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' }, tok)).status).toBe(200);
    // The forged kid stays remembered as unknown (per-kid negative cache): no fetch for it.
    const before = certFetches(h);
    h.clock.t += 11_000;
    await adminPost(h, '/admin/x', { reason: 'r' }, forged('A'));
    expect(certFetches(h)).toBe(before);
  });

  it('keys already held keep verifying while refreshes fail, and failures back off (30 s doubling)', async () => {
    const h = await buildHub();
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' })).status).toBe(200);
    h.accessCerts.fail = true;
    h.clock.t += 11 * 60_000; // cache is stale, refresh fails
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' })).status).toBe(200);
    const after1 = certFetches(h);
    for (let i = 0; i < 5; i++) await adminPost(h, '/admin/x', { reason: 'r' }, forged(`k${i}`));
    expect(certFetches(h)).toBe(after1); // in backoff: no fetches
    h.clock.t += 31_000;
    await adminPost(h, '/admin/x', { reason: 'r' }, forged('k9'));
    expect(certFetches(h)).toBe(after1 + 1); // one retry after 30 s, fails again
    h.clock.t += 31_000;
    await adminPost(h, '/admin/x', { reason: 'r' }, forged('k10'));
    expect(certFetches(h)).toBe(after1 + 1); // backoff doubled to 60 s
    h.accessCerts.fail = false;
    h.clock.t += 31_000;
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' })).status).toBe(200);
  });
});

describe('4. rotated HMAC hashes', () => {
  it('a hand-off minted just before the hub session id rotated still redeems', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const { bind, token } = await startToken(h, s.jar);
    const hubHash = String(h.db.raw.prepare('SELECT id_hash FROM sessions').get()!.id_hash);
    await rotateHubSession(h.db, hubHash, 'rotated-hash', 1, h.clock.t, 30_000);
    const r = await h.core.redeemHandoff(h.env, caller(h), token, bind);
    expect(r.ok).toBe(true);
    // Attached to the row's CURRENT id; it replaced the earlier vocab session (one per game per browser).
    expect(count(h, `SELECT COUNT(*) AS n FROM game_sessions WHERE hub_session_id_hash = 'rotated-hash'`)).toBe(1);
    expect((await h.core.resolveSession(h.env, caller(h), r.ok ? r.gameSessionId : '')).ok).toBe(true);
  });

  it('a sign-out racing a rotation still ends the session', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const hubHash = String(h.db.raw.prepare('SELECT id_hash FROM sessions').get()!.id_hash);
    injectBefore(h, 'DELETE FROM sessions', () => void h.db.raw.prepare(`UPDATE sessions SET id_hash = 'rotated', previous_id_hash = id_hash`).run());
    expect(await h.core.signOut(h.env, caller(h), s.gameSessionId)).toEqual({ ok: true });
    expect(count(h, 'SELECT COUNT(*) AS n FROM sessions')).toBe(0);
    expect(hubHash).not.toBe('rotated');
  });

  it('after SESSION_HASH_KEY_CURRENT flips to 2, a v1 hand-off token and a v1 session are redeemable and revocable', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const t1 = await startToken(h, s.jar);
    expect(t1.token).toMatch(/^v1\./);
    (h.env as Record<string, unknown>).SESSION_HASH_KEY_CURRENT = '2';
    const r = await h.core.redeemHandoff(h.env, caller(h), t1.token, t1.bind);
    expect(r.ok && r.gameSessionId).toMatch(/^v2\./);
    // Revocable: sign out everywhere through the page with the v1 cookie.
    const page = await h.fetch('/me', { cookies: s.jar });
    const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())![1];
    const out = await h.fetch('/auth/signout-everywhere', { method: 'POST', cookies: s.jar, headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `csrf=${encodeURIComponent(csrf)}` });
    expect(out.status).toBe(200);
    expect(await h.core.resolveSession(h.env, caller(h), s.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect(await h.core.resolveSession(h.env, caller(h), r.ok ? r.gameSessionId : '')).toEqual({ ok: false, error: 'signed_out' });
    expect(count(h, 'SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });
});

describe('5. deletion race', () => {
  it('a list save racing account deletion is refused, even with a kept subscription row', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = tid(h, 'a@s.org');
    h.db.raw.exec(`INSERT INTO subscriptions (stripe_subscription_id, teacher_id, status, access_until) VALUES ('sub_a', '${A}', 'active', ${h.clock.t + 30 * DAY})`);
    injectBefore(h, 'INSERT INTO lists', () => forTeacher(h.db, A).tombstone(h.clock.t));
    expect((await h.core.saveList(h.env, caller(h), a.gameSessionId, { title: 'x', items: ['x'] })).ok).toBe(false);
    expect(count(h, 'SELECT COUNT(*) AS n FROM lists')).toBe(0);
    expect(await forTeacher(h.db, A).isPaid(h.clock.t)).toBe(false);
  });
});

describe('6. coverage gaps', () => {
  it('tombstone overwrites the old timestamps (seeded at different times)', async () => {
    const h = await buildHub();
    await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = tid(h, 'a@s.org');
    h.db.raw.prepare('UPDATE teachers SET created_at = 111, last_seen_at = 222 WHERE id = ?').run(A);
    await forTeacher(h.db, A).tombstone(999);
    expect(h.db.raw.prepare('SELECT created_at, last_seen_at, deleted_at FROM teachers WHERE id = ?').get(A)).toEqual({ created_at: 999, last_seen_at: 999, deleted_at: 999 });
  });

  it('the paid check sits inside insertClass, updateClass and deleteClass (db layer, expired teacher)', async () => {
    const h = await buildHub();
    await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = tid(h, 'a@s.org');
    const scope = forTeacher(h.db, A);
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ? WHERE id = ?').run(h.clock.t + DAY, A);
    expect(await scope.insertClass({ id: 'C1', name: 'c', code: 'CODE01', listId: null }, h.clock.t)).toBe(true);
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ? WHERE id = ?').run(h.clock.t - 1, A);
    expect(await scope.insertClass({ id: 'C2', name: 'c', code: 'CODE02', listId: null }, h.clock.t)).toBe(false);
    expect(await scope.updateClass({ id: 'C1', name: 'renamed', listId: null }, h.clock.t)).toBe(false);
    expect(await scope.deleteClass('C1', h.clock.t)).toBe(false);
    expect(h.db.raw.prepare('SELECT id, name FROM classes').all()).toEqual([{ id: 'C1', name: 'c' }]);
  });

  it('a device-picker value minted under key v1 still works after the flip to v2', async () => {
    const h = await buildHub();
    for (let i = 0; i < 3; i++) await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const fourth = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const html = await fourth.page!.text();
    const pending = /name="pending" value="([^"]+)"/.exec(html)![1];
    const end = /name="end" value="([^"]+)"/.exec(html)![1];
    expect(pending).toMatch(/^v1\./);
    (h.env as Record<string, unknown>).SESSION_HASH_KEY_CURRENT = '2';
    const res = await h.fetch('/auth/devices', {
      method: 'POST', cookies: fourth.jar,
      headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ pending, end }).toString(),
    });
    expect(res.status).toBe(303);
    expect(cookiesFrom(res)['__Host-avery_hub']).toMatch(/^v2\./);
  });
});

describe('7. internal errors are alert-tagged', () => {
  it('an internal error in checkRoomPass returns unavailable and logs AVERY_ALERT with the method', async () => {
    const h = await buildHub();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (h.env as unknown as { DB: unknown }).DB = { prepare() { throw new Error('boom'); }, batch() { throw new Error('boom'); } };
    const svc = new HubService({} as ExecutionContext, h.env);
    expect(await svc.checkRoomPass(caller(h), `v1.${randomToken(32)}`)).toEqual({ ok: false, error: 'unavailable' });
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('AVERY_ALERT HubService.checkRoomPass'))).toBe(true);
    spy.mockRestore();
  });
});

describe('8. pages', () => {
  it('"Can\'t sign in right now" offers one free round of each game', async () => {
    const h = await buildHub({ vars: { GOOGLE_CLIENT_ID: '' } });
    const html = await (await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`)).text();
    expect(html).toContain('one free round of each game');
    expect(html).not.toContain('free game without');
  });

  it('a stale page (CSRF from before a rotation) gets the branded "Please try again" page, not plain text', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const res = await h.fetch('/auth/signout', { method: 'POST', cookies: s.jar, headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'csrf=stale' });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain('Please try again');
    expect(html).toContain('avery-header');
    expect((await h.core.resolveSession(h.env, caller(h), s.gameSessionId)).ok).toBe(true);
  });
});

void hashPresented;
void accessToken;
