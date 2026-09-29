// The real HubService class (the RPC shell games bind to), not just core.ts.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HubService } from '../src/rpc/hub-service';
import { buildHub, signIn, caller, type Hub } from './support/harness';
import { randomToken, sha256Hex } from '../src/crypto';

afterEach(() => vi.unstubAllGlobals());

const METHOD_NAMES = Object.getOwnPropertyNames(HubService.prototype).filter((m) => m !== 'constructor');
const svc = (h: Hub) => new HubService({} as ExecutionContext, h.env) as unknown as Record<string, (...a: unknown[]) => Promise<any>>;

describe('HubService class', () => {
  it('has the 16 plan methods', () => {
    expect(METHOD_NAMES.sort()).toEqual([
      'authorizeRound', 'checkRoomPass', 'deleteClass', 'deleteList', 'entitlement', 'getList', 'listClasses', 'listLists',
      'mintRoomPass', 'redeemHandoff', 'resolveSession', 'saveClass', 'saveList', 'signOut', 'switchFreeMode', 'useTaste',
    ]);
  });

  it('none of its method names (derived from the class) is reachable over public HTTP', async () => {
    const h = await buildHub();
    for (const m of METHOD_NAMES) {
      for (const path of [`/${m}`, `/HubService/${m}`, `/internal/${m}`, `/rpc/${m}`]) {
        for (const method of ['GET', 'POST']) expect((await h.fetch(path, { method })).status, `${method} ${path}`).toBe(404);
      }
    }
  });

  it('every method refuses a bad caller through the class', async () => {
    const h = await buildHub();
    const s = svc(h);
    for (const m of METHOD_NAMES) expect(await s[m]({ gameId: 'vocab', gameKey: 'wrong' }, 'x', 'y'), m).toEqual({ ok: false, error: 'refused' });
  });

  it('forwards arguments in the right order (sign in, save, read back, sign out)', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ?').run(h.clock.t + 86_400_000);
    const s = svc(h);
    const c = caller(h);
    expect(await s.resolveSession(c, a.gameSessionId)).toMatchObject({ ok: true, email: 'a@s.org' });
    const saved = await s.saveList(c, a.gameSessionId, { title: 'T', items: ['一'] });
    expect((await s.getList(c, a.gameSessionId, saved.id)).list.title).toBe('T');
    const pass = await s.mintRoomPass(c, a.gameSessionId, 'ROOM1');
    expect((await s.checkRoomPass(c, pass.passId)).valid).toBe(true);
    expect(await s.signOut(c, a.gameSessionId)).toEqual({ ok: true });
  });

  it('never throws to the game: non-JSON items are a typed error, internal errors become "unavailable" with no message', async () => {
    const h = await buildHub();
    const a = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    h.db.raw.prepare('UPDATE teachers SET manual_access_until = ?').run(h.clock.t + 86_400_000);
    const s = svc(h);
    expect(await s.saveList(caller(h), a.gameSessionId, { title: 'x', items: [1n] })).toEqual({ ok: false, error: 'bad_list' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (h.env as unknown as { DB: unknown }).DB = { prepare() { throw new Error('D1 internals at src/db/x.ts:9'); }, batch() { throw new Error('x'); } };
    const r = await s.resolveSession(caller(h), a.gameSessionId);
    expect(r).toEqual({ ok: false, error: 'unavailable' });
    expect(JSON.stringify(r)).not.toContain('internals');
    spy.mockRestore();
  });

  it('a missing current hash key does not burn a hand-off token', async () => {
    const h = await buildHub();
    const first = await signIn(h, { sub: 'g-a', email: 'a@s.org' });
    const bind = randomToken(32);
    const res = await h.fetch(`/auth/start?game=vocab&bind=${await sha256Hex(bind)}`, { cookies: first.jar });
    const token = decodeURIComponent(new URL(res.headers.get('Location')!).hash.slice(3));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (h.env as Record<string, unknown>).SESSION_HASH_KEY_CURRENT = '9';
    expect(await svc(h).redeemHandoff(caller(h), token, bind)).toEqual({ ok: false, error: 'unavailable' });
    (h.env as Record<string, unknown>).SESSION_HASH_KEY_CURRENT = '1';
    expect((await svc(h).redeemHandoff(caller(h), token, bind)).ok).toBe(true);
    spy.mockRestore();
  });
});
