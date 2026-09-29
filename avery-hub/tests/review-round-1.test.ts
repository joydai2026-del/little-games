// Regression tests for review round 1 (bugs, evidence, coverage and Codex lenses).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller, cookiesFrom, accessToken, HUB, ACCESS_ISS, type Hub } from './support/harness';
import { adminPost } from './support/admin-call';
import { injectBefore } from './support/inject';
import { randomToken, sha256Hex, b64url } from '../src/crypto';
import { adminMoveTeacher } from '../src/db/admin-ops';

afterEach(() => vi.unstubAllGlobals());

const DAY = 86_400_000;
const tid = (h: Hub, email: string) => String(h.db.raw.prepare('SELECT id FROM teachers WHERE email = ?').get(email)!.id);
const grantPaid = (h: Hub, id: string, ms = 30 * DAY) => h.db.raw.prepare('UPDATE teachers SET manual_access_until = ? WHERE id = ?').run(h.clock.t + ms, id);
const count = (h: Hub, sql: string, ...p: unknown[]) => Number(h.db.raw.prepare(sql).get(...p)!.n);

/** Load a hub page, then submit one of its forms the way a browser does. */
async function submitForm(h: Hub, jar: Record<string, string>, pagePath: string, action: string, extra: Record<string, string> = {}, origin?: string) {
  const pageUrl = new URL(pagePath, HUB);
  const page = await h.fetch(pagePath, { cookies: jar });
  const html = await page.text();
  expect(page.headers.get('Referrer-Policy')).toBe('same-origin');
  const forms = [...html.matchAll(/<form method="post" action="([^"]+)">([\s\S]*?)<\/form>/g)];
  const form = forms.find((f) => f[1] === action);
  if (!form) throw new Error(`no form ${action}`);
  const fields: Record<string, string> = {};
  for (const m of form[2].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields[m[1]] = m[2].replace(/&amp;/g, '&');
  // Under Referrer-Policy same-origin a browser sends the page's own origin.
  return h.fetch(new URL(action, pageUrl).toString(), {
    method: 'POST',
    cookies: jar,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin ?? pageUrl.origin },
    body: new URLSearchParams({ ...fields, ...extra }).toString(),
  });
}

describe('1. browser form posts', () => {
  it('sign out from the /me form works; it ends this browser only and says Google stays signed in', async () => {
    const h = await buildHub();
    const a1 = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const a2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' }); // another browser (fresh jar)
    const res = await submitForm(h, a1.jar, '/me', '/auth/signout');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("You're signed out");
    expect(html).toContain('still signed in to your Google account');
    expect(await h.core.resolveSession(h.env, caller(h), a1.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect((await h.core.resolveSession(h.env, caller(h), a2.gameSessionId)).ok).toBe(true);
  });

  it('a post with Origin: null (what no-referrer caused) is refused', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    for (const action of ['/auth/signout', '/auth/signout-everywhere', '/me/delete']) {
      expect((await submitForm(h, a.jar, '/me', action, {}, 'null')).status).toBe(403);
    }
    expect((await h.core.resolveSession(h.env, caller(h), a.gameSessionId)).ok).toBe(true);
  });

  it('delete my account works through both browser forms', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const step1 = await submitForm(h, a.jar, '/me', '/me/delete');
    const html = await step1.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
    const res = await h.fetch('/me/delete', {
      method: 'POST', cookies: a.jar,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(HUB).origin },
      body: new URLSearchParams({ csrf, step: '2', confirm: 'DELETE' }).toString(),
    });
    expect(await res.text()).toContain('Your account is deleted');
  });
});

describe('2. deleted or moved teacher: room passes read "revoked"', () => {
  it('after account delete', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    grantPaid(h, tid(h, 'a@s.org'));
    const pass = await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1');
    if (!pass.ok) throw new Error('mint');
    const step1 = await submitForm(h, a.jar, '/me', '/me/delete');
    const csrf = /name="csrf" value="([^"]+)"/.exec(await step1.text())![1];
    await h.fetch('/me/delete', { method: 'POST', cookies: a.jar, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: HUB }, body: new URLSearchParams({ csrf, step: '2', confirm: 'DELETE' }).toString() });
    expect(await h.core.checkRoomPass(h.env, caller(h), pass.passId)).toEqual({ ok: true, valid: false, reason: 'revoked' });
  });

  it('after moveTeacher (the old account)', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    await signIn(h, { sub: 'g-b', email: 'b@s.org' });
    grantPaid(h, tid(h, 'a@s.org'));
    const pass = await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1');
    if (!pass.ok) throw new Error('mint');
    expect((await adminPost(h, '/admin/move-teacher', { fromTeacherId: tid(h, 'a@s.org'), toTeacherId: tid(h, 'b@s.org'), reason: 'lost account' })).status).toBe(200);
    expect(await h.core.checkRoomPass(h.env, caller(h), pass.passId)).toEqual({ ok: true, valid: false, reason: 'revoked' });
  });
});

describe('3. mintRoomPass is one conditional insert', () => {
  it('a revoke landing between the paid read and the insert leaves no pass', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = tid(h, 'a@s.org');
    grantPaid(h, A);
    injectBefore(h, 'INSERT INTO room_passes', () => {
      h.db.raw.prepare('UPDATE teachers SET manual_access_until = NULL, entitlement_version = entitlement_version + 1 WHERE id = ?').run(A);
    });
    expect(await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1')).toEqual({ ok: false, error: 'revoked' });
    expect(count(h, 'SELECT COUNT(*) AS n FROM room_passes')).toBe(0);
  });

  it('an entitlement-version bump alone (still paid) between the read and the insert leaves no pass', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = tid(h, 'a@s.org');
    grantPaid(h, A);
    injectBefore(h, 'INSERT INTO room_passes', () => void h.db.raw.prepare('UPDATE teachers SET entitlement_version = entitlement_version + 1 WHERE id = ?').run(A));
    expect(await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1')).toEqual({ ok: false, error: 'revoked' });
    expect(count(h, 'SELECT COUNT(*) AS n FROM room_passes')).toBe(0);
  });

  it('a session ended between the read and the insert leaves no pass', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    grantPaid(h, tid(h, 'a@s.org'));
    injectBefore(h, 'INSERT INTO room_passes', () => void h.db.raw.exec('DELETE FROM sessions'));
    expect((await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1')).ok).toBe(false);
    expect(count(h, 'SELECT COUNT(*) AS n FROM room_passes')).toBe(0);
  });
});

describe('4. paid-only reads and writes after access ends', () => {
  it('lists and classes are hidden and locked, but export still has them', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    grantPaid(h, tid(h, 'a@s.org'), DAY);
    const c = caller(h);
    const l1 = await h.core.saveList(h.env, c, a.gameSessionId, { title: 'L1', items: ['一'] });
    const l2 = await h.core.saveList(h.env, c, a.gameSessionId, { title: 'L2', items: ['二'] });
    const cl = await h.core.saveClass(h.env, c, a.gameSessionId, { name: 'Class', listId: l1.ok ? l1.id : null });
    if (!l1.ok || !l2.ok || !cl.ok) throw new Error('seed');
    h.clock.t += DAY + 1; // access ends
    const b = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { jar: a.jar });
    const gs = b.gameSessionId;
    expect(await h.core.listLists(h.env, c, gs)).toEqual({ ok: true, lists: [] });
    expect(await h.core.getList(h.env, c, gs, l1.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.saveList(h.env, c, gs, { id: l1.id, title: 'x', items: ['x'] })).toEqual({ ok: false, error: 'paid_only' });
    expect(await h.core.saveList(h.env, c, gs, { title: 'new', items: ['x'] })).toEqual({ ok: false, error: 'paid_only' });
    expect(await h.core.deleteList(h.env, c, gs, l2.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.listClasses(h.env, c, gs)).toEqual({ ok: true, classes: [] });
    expect(await h.core.saveClass(h.env, c, gs, { name: 'y' })).toEqual({ ok: false, error: 'paid_only' });
    expect(await h.core.deleteClass(h.env, c, gs, cl.id)).toEqual({ ok: false, error: 'paid_only' });
    expect(count(h, 'SELECT COUNT(*) AS n FROM lists')).toBe(2);
    const exp = await (await h.fetch('/me/export', { cookies: b.jar })).json() as { lists: { title: string }[]; classes: unknown[] };
    expect(exp.lists.map((l) => l.title).sort()).toEqual(['L1', 'L2']);
    expect(exp.classes.length).toBe(1);
  });

  it('a revoke between the paid read and the list insert is refused inside the insert', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = tid(h, 'a@s.org');
    grantPaid(h, A);
    injectBefore(h, 'INSERT INTO lists', () => void h.db.raw.prepare('UPDATE teachers SET manual_access_until = NULL WHERE id = ?').run(A));
    expect(await h.core.saveList(h.env, caller(h), a.gameSessionId, { title: 'x', items: ['x'] })).toEqual({ ok: false, error: 'paid_only' });
    expect(count(h, 'SELECT COUNT(*) AS n FROM lists')).toBe(0);
  });
});

describe('pivot: no free tier (FREE_TIER_ENABLED=false, the default)', () => {
  it('taste and switch are disabled; entitlement is plan + accessUntil only; unpaid cannot save or open rooms', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const c = caller(h);
    expect(await h.core.useTaste(h.env, c, a.gameSessionId, 'race')).toEqual({ ok: false, error: 'disabled' });
    expect(await h.core.switchFreeMode(h.env, c, a.gameSessionId, 'race')).toEqual({ ok: false, error: 'disabled' });
    expect(await h.core.entitlement(h.env, c, a.gameSessionId)).toEqual({ ok: true, plan: 'free', accessUntil: null });
    expect(await h.core.saveList(h.env, c, a.gameSessionId, { title: 'x', items: ['x'] })).toEqual({ ok: false, error: 'paid_only' });
    expect(await h.core.mintRoomPass(h.env, c, a.gameSessionId, 'ROOM1')).toEqual({ ok: false, error: 'paid_only' });
    grantPaid(h, tid(h, 'a@s.org'));
    expect(await h.core.entitlement(h.env, c, a.gameSessionId)).toEqual({ ok: true, plan: 'paid', accessUntil: h.clock.t + 30 * DAY });
    for (let i = 0; i < 5; i++) expect((await h.core.saveList(h.env, c, a.gameSessionId, { title: `L${i}`, items: ['x'] })).ok).toBe(true);
    const html = await (await h.fetch('/me', { cookies: a.jar })).text();
    expect(html).not.toContain('Your free game');
  });
});

describe('5. rate limits', () => {
  it('one address is limited even with a fresh bind every time (abuse bucket, 60 a minute)', async () => {
    const h = await buildHub();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(randomToken(32))}`, { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 302)).toBe(true);
    expect(statuses[60]).toBe(429);
    // Another address is not affected.
    expect((await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(randomToken(32))}`, { headers: { 'CF-Connecting-IP': '198.51.100.9' } })).status).toBe(302);
    // The raw address is never a limiter key.
    expect(h.limiters.AUTH_ADDRESS_LIMITER.keys.some((k) => k.includes('203.0.113.7'))).toBe(false);
  });

  it('the per-bind bucket still limits 21 starts with one bind', async () => {
    const h = await buildHub();
    const bind = await sha256Hex(randomToken(32));
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await h.fetch(`/auth/start?game=vocab&bind=${bind}`, { headers: { 'CF-Connecting-IP': `198.51.100.${i}` } })).status);
    expect(statuses[19]).toBe(302);
    expect(statuses[20]).toBe(429);
  });

  it('without RATE_KEY, sign-in fails closed', async () => {
    const h = await buildHub({ vars: { RATE_KEY: '' } });
    expect((await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`)).status).toBe(503);
  });
});

describe('6. JWKS fetching', () => {
  it('10 concurrent tokens with an unknown kid cause at most one key fetch', async () => {
    const h = await buildHub();
    const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const forged = (i: number) => `${enc({ alg: 'RS256', kid: `random-${i}` })}.${enc({ iss: ACCESS_ISS, aud: 'aud-test', exp: 9e9 })}.AA`;
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => adminPost(h, '/admin/x', { reason: 'x' }, forged(i))));
    expect(rs.every((r) => r.status === 403)).toBe(true);
    expect(h.fetchLog.filter((u) => u.includes('/cdn-cgi/access/certs')).length).toBeLessThanOrEqual(1);
    // More forged kids within a minute: still no new fetch.
    await adminPost(h, '/admin/x', { reason: 'x' }, forged(99));
    expect(h.fetchLog.filter((u) => u.includes('/cdn-cgi/access/certs')).length).toBeLessThanOrEqual(1);
    // A real token still works.
    expect((await adminPost(h, '/admin/revoke-access', { teacherId: 'nobody', reason: 'x' }, await accessToken(h))).status).toBe(200);
  });
});

describe('7. concurrency at sign-in', () => {
  it('two requests racing at rotation time are both served (overlap window)', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.clock.t += 8 * DAY;
    const binds = [randomToken(32), randomToken(32)];
    const rs = await Promise.all(binds.map(async (b) => h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(b)}`, { cookies: s.jar })));
    const out = await Promise.all(rs.map((r, i) => h.core.redeemHandoff(h.env, caller(h), decodeURIComponent(new URL(r.headers.get('Location')!).hash.slice(3)), binds[i])));
    expect(out.map((o) => o.ok)).toEqual([true, true]);
  });

  it('10 concurrent sign-ins cannot exceed MAX_TEACHER_DEVICES (3)', async () => {
    const h = await buildHub();
    const rs = await Promise.all(Array.from({ length: 10 }, () => signIn(h, { sub: 'g-a', email: 'a@s.org' })));
    expect(count(h, 'SELECT COUNT(*) AS n FROM sessions')).toBe(3);
    expect(rs.filter((r) => r.gameSessionId).length).toBe(3);
    expect(rs.filter((r) => r.page).length).toBe(7);
  });
});

describe('8. moveTeacher with the history shape that used to fail', () => {
  it('history pointing at a list and at a class with no list moves cleanly', async () => {
    const h = await buildHub();
    await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    await signIn(h, { sub: 'g-b', email: 'b@s.org' });
    const A = tid(h, 'a@s.org');
    const B = tid(h, 'b@s.org');
    h.db.raw.exec(`
      INSERT INTO lists (teacher_id, id, title, items_json, created_at, updated_at) VALUES ('${A}', 'L1', 't', '[]', 1, 1), ('${A}', 'L2', 't', '[]', 1, 1);
      INSERT INTO classes (teacher_id, id, class_code, list_id, name, created_at) VALUES ('${A}', 'C1', 'ZZ1', NULL, 'c', 1);
      INSERT INTO round_history (teacher_id, id, game_id, mode, list_id, class_id, started_at) VALUES ('${A}', 'H1', 'vocab', 'race', 'L1', 'C1', 1);`);
    expect(await adminMoveTeacher(h.db, 'admin', A, B, 'test', h.clock.t)).toBe('ok');
    expect(count(h, 'SELECT COUNT(*) AS n FROM round_history WHERE teacher_id = ? AND list_id = ? AND class_id = ?', B, 'L1', 'C1')).toBe(1);
    expect(count(h, 'SELECT COUNT(*) AS n FROM lists WHERE teacher_id = ?', B)).toBe(2);
  });
});

describe('9. TokenDO alarm', () => {
  it('runs through the same queue as take and deletes the token', async () => {
    const h = await buildHub();
    const first = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const bind = randomToken(32);
    const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(bind)}`, { cookies: first.jar });
    const token = decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3));
    const { hashPresented } = await import('../src/crypto');
    const hash = (await hashPresented(h.env, token))!.hash;
    const obj = (h.env.TOKENS as unknown as { get(n: string): { take: Function; alarm: Function } }).get(hash);
    const [taken] = await Promise.all([obj.take('handoff', { gameId: 'vocab', bindHash: await sha256Hex(bind) }), obj.alarm()]);
    expect(taken.ok).toBe(true);
    expect(h.tokenStorage.get(hash)!.map.size).toBe(0);
    expect(await obj.take('handoff', {})).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('10. coverage gaps', () => {
  it('signOut RPC ends this device (hub + every game) and leaves the other device', async () => {
    const h = await buildHub();
    const d1v = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const d1t = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { gameId: 'trace-race', jar: d1v.jar });
    const d2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    expect(await h.core.signOut(h.env, caller(h), d1v.gameSessionId)).toEqual({ ok: true });
    expect((await h.core.resolveSession(h.env, caller(h, 'trace-race'), d1t.gameSessionId)).ok).toBe(false);
    expect(await (await h.fetch('/me', { cookies: d1v.jar })).text()).toContain('Sign in with Google');
    expect((await h.core.resolveSession(h.env, caller(h), d2.gameSessionId)).ok).toBe(true);
  });

  it('a hand-off token minted before "sign out everywhere" is refused after it', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const bind = randomToken(32);
    const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(bind)}`, { cookies: a.jar });
    const token = decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3));
    expect((await submitForm(h, a.jar, '/me', '/auth/signout-everywhere')).status).toBe(200);
    expect(await h.core.redeemHandoff(h.env, caller(h), token, bind)).toEqual({ ok: false, error: 'signed_out' });
  });

  it('SESSION_MAX_DAYS (90) ends a hub session even when it is used every 20 days', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const jar = { ...s.jar };
    for (let d = 20; d <= 80; d += 20) {
      h.clock.t += 20 * DAY;
      const r = await h.fetch('/me', { cookies: jar });
      expect(await r.text(), `day ${d}`).toContain('a@s.org');
      Object.assign(jar, cookiesFrom(r));
    }
    h.clock.t += 11 * DAY; // day 91
    expect(await (await h.fetch('/me', { cookies: jar })).text()).toContain('Sign in with Google');
  });

  it('key rotation V1 to V2 signs nobody out', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    // A sign-in that started under V1 finishes after the flip (state carries its version).
    const start = await h.fetch(`/auth/start?game=vocab&bind=${'b'.repeat(64)}`);
    const u = new URL(start.headers.get('Location')!);
    (h.env as Record<string, unknown>).SESSION_HASH_KEY_CURRENT = '2';
    const code = randomToken(12);
    h.codes.set(code, { user: { sub: 'g-c', email: 'c@s.org' }, nonceOverride: u.searchParams.get('nonce')! });
    expect(u.searchParams.get('state')).toMatch(/^v1\./);
    expect((await h.fetch(`/auth/callback?state=${u.searchParams.get('state')}&code=${code}`, { cookies: cookiesFrom(start) })).status).toBe(303);
    // The old v1 hub cookie still works and is re-issued as v2; the v1 game session survives (ON UPDATE CASCADE).
    const me = await h.fetch('/me', { cookies: s.jar });
    expect(await me.text()).toContain('a@s.org');
    expect(cookiesFrom(me)['__Host-avery_hub']).toMatch(/^v2\./);
    expect((await h.core.resolveSession(h.env, caller(h), s.gameSessionId)).ok).toBe(true);
    const again = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { jar: { '__Host-avery_hub': cookiesFrom(me)['__Host-avery_hub'] } });
    expect(again.gameSessionId).toMatch(/^v2\./);
  });

  it('admin is 403 without a valid token on every hostname the hub answers, every verb', async () => {
    const h = await buildHub();
    const hosts = ['https://hub.averystudio.org', 'https://avery-hub-staging.joyd-ai-2026.workers.dev', 'https://1a2b3c4d-avery-hub-staging.joyd-ai-2026.workers.dev', 'http://localhost:8787'];
    for (const host of hosts) {
      for (const path of ['/admin', '/admin/grant-access', '/admin/x']) {
        for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
          const res = await h.fetch(`${host}${path}`, { method, headers: { 'Cf-Access-Jwt-Assertion': 'garbage' }, body: method === 'GET' ? undefined : '{}' });
          expect(res.status, `${method} ${host}${path}`).toBe(403);
        }
      }
    }
  });

  it('export has every table the plan lists for her, and nothing of another teacher', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const b = await signIn(h, { sub: 'g-b', email: 'b@s.org' });
    const A = tid(h, 'a@s.org');
    grantPaid(h, A);
    grantPaid(h, tid(h, 'b@s.org'));
    const l = await h.core.saveList(h.env, caller(h), a.gameSessionId, { title: 'Animals', items: ['猫', '狗'] });
    await h.core.saveClass(h.env, caller(h), a.gameSessionId, { name: 'Class 2B', listId: l.ok ? l.id : null });
    await h.core.saveList(h.env, caller(h), b.gameSessionId, { title: 'B secret', items: ['x'] });
    h.db.raw.exec(`INSERT INTO round_history (teacher_id, id, game_id, mode, started_at) VALUES ('${A}', 'H1', 'vocab', 'race', 1);
      INSERT INTO subscriptions (stripe_subscription_id, teacher_id, status, access_until) VALUES ('sub_a', '${A}', 'active', 5);
      INSERT INTO seat_grants (email, school_ref, access_until, granted_by, attached_teacher_id) VALUES ('a@s.org', 'PS 1', 5, 'admin', '${A}');`);
    const exp = await (await h.fetch('/me/export', { cookies: a.jar })).json() as Record<string, any>;
    expect(Object.keys(exp).sort()).toEqual(['classes', 'exportedAt', 'history', 'lists', 'profile', 'schoolSeats', 'subscriptions']);
    expect(exp.profile.email).toBe('a@s.org');
    expect(exp.lists).toMatchObject([{ title: 'Animals', items: ['猫', '狗'] }]);
    expect(exp.classes).toMatchObject([{ name: 'Class 2B' }]);
    expect(exp.history).toMatchObject([{ id: 'H1', mode: 'race' }]);
    expect(exp.subscriptions).toMatchObject([{ status: 'active' }]);
    expect(exp.schoolSeats).toMatchObject([{ school_ref: 'PS 1' }]);
    expect(JSON.stringify(exp)).not.toContain('B secret');
    expect(JSON.stringify(exp)).not.toContain('b@s.org');
  });
});

describe('11. one live game session per game per hub session', () => {
  it('a new hand-off for the same game and browser ends the old game session; other games keep theirs', async () => {
    const h = await buildHub();
    const v1 = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const t1 = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { gameId: 'trace-race', jar: v1.jar });
    const v2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { jar: v1.jar });
    expect(await h.core.resolveSession(h.env, caller(h), v1.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect((await h.core.resolveSession(h.env, caller(h), v2.gameSessionId)).ok).toBe(true);
    expect((await h.core.resolveSession(h.env, caller(h, 'trace-race'), t1.gameSessionId)).ok).toBe(true);
  });
});

describe('13. production placeholder fails safe', () => {
  it('with DB_READY false every route and RPC refuses', async () => {
    const h = await buildHub({ vars: { DB_READY: 'false' } });
    const hz = await h.fetch('/healthz');
    expect(hz.status).toBe(503);
    expect(await hz.json()).toMatchObject({ ok: false, error: 'database_not_configured' });
    expect((await h.fetch('/me')).status).toBe(503);
    expect(await h.core.resolveSession(h.env, caller(h), 'v1.x')).toEqual({ ok: false, error: 'unavailable' });
  });
});
