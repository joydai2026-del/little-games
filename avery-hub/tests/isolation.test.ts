// Plan "Isolation tests": teacher A acting on teacher B's ids gets "not found"
// or "refused", and B's rows stay the same.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller, cookiesFrom, METHODS, HUB, type Hub } from './support/harness';

afterEach(() => vi.unstubAllGlobals());

const snapshot = (h: Hub, teacherId: string) =>
  JSON.stringify(
    ['lists', 'classes', 'round_history', 'room_passes', 'sessions', 'game_sessions'].map((t) =>
      h.db.raw.prepare(`SELECT * FROM ${t} WHERE teacher_id = ? ORDER BY 1, 2`).all(teacherId),
    ),
  );
const teacherId = (h: Hub, email: string) => String(h.db.raw.prepare('SELECT id FROM teachers WHERE email = ?').get(email)!.id);
const grantPaid = (h: Hub, id: string) => h.db.raw.prepare('UPDATE teachers SET manual_access_until = ? WHERE id = ?').run(h.clock.t + 1e10, id);

async function twoTeachers() {
  const h = await buildHub();
  const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
  const b = await signIn(h, { sub: 'g-b', email: 'b@s.org' });
  const A = teacherId(h, 'a@s.org');
  const B = teacherId(h, 'b@s.org');
  grantPaid(h, B);
  const bList = await h.core.saveList(h.env, caller(h), b.gameSessionId, { title: 'B list', items: ['猫'] });
  if (!bList.ok) throw new Error('seed');
  const bClass = await h.core.saveClass(h.env, caller(h), b.gameSessionId, { name: 'B class', listId: bList.id });
  if (!bClass.ok) throw new Error('seed class');
  const bPass = await h.core.mintRoomPass(h.env, caller(h), b.gameSessionId, 'ROOMB');
  if (!bPass.ok) throw new Error('seed pass');
  return { h, a, b, A, B, bListId: bList.id, bClassId: bClass.id };
}

describe('per-teacher isolation', () => {
  it("A cannot read, change or delete B's list, class or data through any method", async () => {
    const { h, a, B, bListId, bClassId } = await twoTeachers();
    grantPaid(h, teacherId(h, 'a@s.org'));
    const before = snapshot(h, B);
    const c = caller(h);
    expect(await h.core.getList(h.env, c, a.gameSessionId, bListId)).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.saveList(h.env, c, a.gameSessionId, { id: bListId, title: 'pwn', items: ['x'] })).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.deleteList(h.env, c, a.gameSessionId, bListId)).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.saveClass(h.env, c, a.gameSessionId, { id: bClassId, name: 'pwn' })).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.deleteClass(h.env, c, a.gameSessionId, bClassId)).toEqual({ ok: false, error: 'not_found' });
    expect(await h.core.saveClass(h.env, c, a.gameSessionId, { name: 'mine', listId: bListId })).toEqual({ ok: false, error: 'not_found' });
    const lists = await h.core.listLists(h.env, c, a.gameSessionId);
    expect(lists.ok && lists.lists).toEqual([]);
    const classes = await h.core.listClasses(h.env, c, a.gameSessionId);
    expect(classes.ok && classes.classes).toEqual([]);
    const ent = await h.core.entitlement(h.env, c, a.gameSessionId);
    expect(ent).toEqual({ ok: true, plan: 'paid', accessUntil: expect.any(Number) });
    expect(snapshot(h, B)).toBe(before);
  });

  it("naming B's teacher id in a body or argument still acts on A", async () => {
    const { h, a, A, B } = await twoTeachers();
    grantPaid(h, A);
    const before = snapshot(h, B);
    const r = await h.core.saveList(h.env, caller(h), a.gameSessionId, { title: 'A list', items: ['狗'], teacherId: B, teacher_id: B });
    expect(r.ok).toBe(true);
    expect(h.db.raw.prepare('SELECT teacher_id FROM lists WHERE title = ?').get('A list')).toEqual({ teacher_id: A });
    expect(snapshot(h, B)).toBe(before);
    // Profile routes take no teacher id at all: a query string is ignored.
    const me = await h.fetch(`/me?teacherId=${B}&teacher_id=${B}`, { cookies: a.jar });
    const html = await me.text();
    expect(html).toContain('a@s.org');
    expect(html).not.toContain('b@s.org');
  });

  it("A's export has none of B's data", async () => {
    const { h, a } = await twoTeachers();
    const res = await h.fetch('/me/export', { cookies: a.jar });
    const body = await res.text();
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(body).toContain('a@s.org');
    expect(body).not.toContain('b@s.org');
    expect(body).not.toContain('B list');
  });

  it("A's delete-account removes only A", async () => {
    const { h, a, B } = await twoTeachers();
    const before = snapshot(h, B);
    const page1 = await h.fetch('/me', { cookies: a.jar });
    const csrf = /name="csrf" value="([^"]+)"/.exec(await page1.text())![1];
    const post = (body: Record<string, string>) =>
      h.fetch('/me/delete', { method: 'POST', cookies: a.jar, headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const confirm = await post({ csrf, step: '1' });
    expect(await confirm.text()).toContain('Type DELETE to confirm');
    expect(h.db.raw.prepare('SELECT deleted_at FROM teachers WHERE email = ?').get('a@s.org')).toEqual({ deleted_at: null });
    const wrongWord = await post({ csrf, step: '2', confirm: 'nope' });
    expect(await wrongWord.text()).toContain('Type DELETE to confirm');
    const done = await post({ csrf, step: '2', confirm: 'DELETE' });
    expect(await done.text()).toContain('Your account is deleted');
    expect(h.db.raw.prepare('SELECT COUNT(*) AS n FROM teachers WHERE deleted_at IS NOT NULL').get()).toEqual({ n: 1 });
    expect(await h.core.resolveSession(h.env, caller(h), a.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect(snapshot(h, B)).toBe(before);
  });

  it('same browser: sign in as A, save; switch to B; B sees none of A\'s lists; back to A, intact', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    grantPaid(h, teacherId(h, 'a@s.org'));
    await h.core.saveList(h.env, caller(h), a.gameSessionId, { title: 'A list', items: ['一'] });
    // Sign out of the hub in this browser, then pick B at Google (select_account).
    const csrf = /name="csrf" value="([^"]+)"/.exec(await (await h.fetch('/me', { cookies: a.jar })).text())![1];
    const out = await h.fetch('/auth/signout', { method: 'POST', cookies: a.jar, headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `csrf=${encodeURIComponent(csrf)}` });
    const jar = { ...a.jar, ...cookiesFrom(out) };
    for (const [k, v] of Object.entries(jar)) if (v === '') delete jar[k];
    const b = await signIn(h, { sub: 'g-b', email: 'b@s.org' }, { jar });
    const bLists = await h.core.listLists(h.env, caller(h), b.gameSessionId);
    expect(bLists.ok && bLists.lists).toEqual([]);
    const a2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const aLists = await h.core.listLists(h.env, caller(h), a2.gameSessionId);
    expect(aLists.ok && aLists.lists.map((l) => l.title)).toEqual(['A list']);
  });

  it("sign out everywhere: every old hub and game cookie is refused by every method", async () => {
    const h = await buildHub();
    const a1 = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const a2 = await signIn(h, { sub: 'g-a', email: 'a@s.org' }, { gameId: 'trace-race' });
    const csrf = /name="csrf" value="([^"]+)"/.exec(await (await h.fetch('/me', { cookies: a1.jar })).text())![1];
    const res = await h.fetch('/auth/signout-everywhere', { method: 'POST', cookies: a1.jar, headers: { Origin: HUB, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `csrf=${encodeURIComponent(csrf)}` });
    expect(await res.text()).toContain('signed out everywhere');
    for (const [s, game] of [[a1, 'vocab'], [a2, 'trace-race']] as const) {
      for (const m of METHODS.filter((x) => !['redeemHandoff', 'checkRoomPass', 'authorizeRound'].includes(x))) {
        const r = await (h.core as unknown as Record<string, (...a: unknown[]) => Promise<{ ok: boolean; error?: string }>>)[m](h.env, caller(h, game), s.gameSessionId, 'race', 'x');
        expect(r, m).toEqual({ ok: false, error: 'signed_out' });
      }
      expect(await (await h.fetch('/me', { cookies: s.jar })).text()).toContain('Sign in with Google');
    }
  });

  it('JJ revoking access reaches every game session and bumps room passes to revoked', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const A = teacherId(h, 'a@s.org');
    grantPaid(h, A);
    const pass = await h.core.mintRoomPass(h.env, caller(h), a.gameSessionId, 'ROOM1');
    expect(pass.ok).toBe(true);
    const { revokeAccessForTest } = await import('./support/admin-call');
    expect((await revokeAccessForTest(h, A)).status).toBe(200);
    expect(await h.core.resolveSession(h.env, caller(h), a.gameSessionId)).toEqual({ ok: false, error: 'signed_out' });
    expect(await h.core.checkRoomPass(h.env, caller(h), pass.ok ? pass.passId : '')).toEqual({ ok: true, valid: false, reason: 'revoked' });
  });
});
