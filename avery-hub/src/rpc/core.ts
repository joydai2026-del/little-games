// HubService logic as plain functions over env, so tests can call it without
// the Workers runtime. src/rpc/hub-service.ts is the thin RPC shell.
import type { Env } from '../env';
import { freeGameKeys, freeListAllowance, policy, type Policy } from '../config';
import { hashPresented, mintSecret, safeEqual, sha256Hex } from '../crypto';
import { checkRoomPassRow, createGameSession, forTeacher, openDb, resolveGameSession, teacherExists, type TeacherScope } from '../db';
import { now } from '../clock';
import { takeToken } from '../auth/tokens';

export interface Caller {
  gameId: string;
  gameKey: string;
}
export type Fail = { ok: false; error: string };
export type Ok<T> = { ok: true } & T;
export type Result<T> = Ok<T> | Fail;

const fail = (error: string): Fail => ({ ok: false, error });

/** The caller must be a registered game, with its own key, calling a method listed for it. */
async function gate(env: Env, caller: unknown, method: string): Promise<{ p: Policy; gameId: string } | Fail> {
  const p = policy(env);
  if (!p.dbReady) return fail('unavailable');
  const c = caller as Partial<Caller> | null;
  if (!c || typeof c.gameId !== 'string' || typeof c.gameKey !== 'string') return fail('refused');
  const entry = p.registry[c.gameId];
  if (!entry || !entry.keyHash || !entry.methods.includes(method)) return fail('refused');
  if (!safeEqual(await sha256Hex(c.gameKey), entry.keyHash)) return fail('refused');
  return { p, gameId: c.gameId };
}

/** Gate, then resolve the game session for THIS game (audience check) to a teacher scope. */
async function withSession(env: Env, caller: unknown, method: string, gameSessionId: unknown) {
  const g = await gate(env, caller, method);
  if ('ok' in g) return g;
  const presented = await hashPresented(env, gameSessionId);
  if (!presented) return fail('signed_out');
  const row = await resolveGameSession(openDb(env), presented.hash, g.gameId, now(), { game: g.p.gameSessionIdleMs, hub: g.p.sessionIdleMs });
  if (!row) return fail('signed_out');
  return { ...g, row, scope: forTeacher(openDb(env), row.teacher_id) };
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function entitlementFor(p: Policy, gameId: string, scope: TeacherScope) {
  const t = now();
  const [profile, paid, accessUntil, lists] = await Promise.all([scope.profile(), scope.isPaid(t), scope.accessUntil(), scope.countLists(t, freeListAllowance(p))]);
  if (!profile) return null;
  const plan = paid ? ('paid' as const) : ('free' as const);
  const until = paid ? accessUntil : null;
  // No free tier (JJ 2026-09-29): the game only needs "paid or not, and until when".
  if (!p.freeTierEnabled) return { plan, accessUntil: until };
  const today = utcDay(t);
  const used = profile.taste_day === today ? profile.taste_used : 0;
  return {
    plan,
    accessUntil: until,
    freeGame: profile.free_game,
    freeGameLockedUntil: profile.free_game_locked_until && profile.free_game_locked_until > t ? profile.free_game_locked_until : null,
    freeGameChoices: freeGameKeys(p),
    tasteRoundsLeft: paid ? 0 : Math.max(0, p.tasteRoundsPerDay - used),
    listLimit: paid ? p.paidListLimit : p.freeListLimit,
    listsSaved: lists,
    modesThisGame: p.registry[gameId]?.modes ?? [],
    trialDays: p.trialDays,
    anonFreeRounds: p.anonFreeRounds,
    email: profile.email,
  };
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ROOM_RE = /^[A-Za-z0-9]{3,16}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function classCode(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const hub = {
  async redeemHandoff(env: Env, caller: unknown, token: unknown, bindValue: unknown): Promise<Result<{ gameSessionId: string; email: string; displayName: string }>> {
    const g = await gate(env, caller, 'redeemHandoff');
    if ('ok' in g) return g;
    if (typeof bindValue !== 'string' || bindValue.length < 16 || bindValue.length > 200) return fail('refused');
    const bindHash = await sha256Hex(bindValue);
    if (env.REDEEM_LIMITER) {
      const { success } = await env.REDEEM_LIMITER.limit({ key: `${g.gameId}:${bindHash}` });
      if (!success) return fail('rate_limited');
    }
    const presented = await hashPresented(env, token);
    if (!presented) return fail('refused');
    // Mint first: if the current hash key is missing this throws BEFORE the token is burnt.
    const gs = await mintSecret(env, g.p.hashKeyCurrent);
    const taken = await takeToken(env, presented.hash, 'handoff', { gameId: g.gameId, bindHash });
    if (!taken.ok) return fail(taken.error === 'expired' ? 'expired' : 'refused');
    const teacherId = String(taken.record.data.teacherId);
    const hubHash = String(taken.record.data.hubHash);
    const db = openDb(env);
    const profile = await forTeacher(db, teacherId).profile();
    if (!profile) return fail('refused');
    try {
      await createGameSession(db, { hash: gs.hash, version: gs.version, teacherId, hubHash, gameId: g.gameId, now: now(), maxMs: g.p.gameSessionMaxMs });
    } catch {
      return fail('signed_out'); // the hub session ended between hand-off and redemption
    }
    return { ok: true, gameSessionId: gs.value, email: profile.email, displayName: profile.display_name };
  },

  async resolveSession(env: Env, caller: unknown, gameSessionId: unknown): Promise<Result<{ email: string; displayName: string; gameId: string }>> {
    const s = await withSession(env, caller, 'resolveSession', gameSessionId);
    if ('ok' in s) return s;
    return { ok: true, email: s.row.email, displayName: s.row.display_name, gameId: s.row.game_id };
  },

  async entitlement(env: Env, caller: unknown, gameSessionId: unknown) {
    const s = await withSession(env, caller, 'entitlement', gameSessionId);
    if ('ok' in s) return s;
    const e = await entitlementFor(s.p, s.gameId, s.scope);
    return e ? { ok: true as const, ...e } : fail('signed_out');
  },

  // TODO(S2b): server decision for one round start, with server-built questions.
  async authorizeRound(env: Env, caller: unknown): Promise<Fail> {
    const g = await gate(env, caller, 'authorizeRound');
    if ('ok' in g) return g;
    return fail('not_implemented_in_s1');
  },

  async useTaste(env: Env, caller: unknown, gameSessionId: unknown, mode: unknown): Promise<Result<{ grantId: string; tasteRoundsLeft: number }>> {
    const s = await withSession(env, caller, 'useTaste', gameSessionId);
    if ('ok' in s) return s;
    if (!s.p.freeTierEnabled) return fail('disabled');
    if (typeof mode !== 'string' || !s.p.registry[s.gameId].modes.includes(mode)) return fail('unknown_mode');
    const t = now();
    const profile = await s.scope.profile();
    if (!profile) return fail('signed_out');
    if (await s.scope.isPaid(t)) return fail('not_needed');
    if (profile.free_game === `${s.gameId}:${mode}`) return fail('not_needed');
    if (!(await s.scope.useTaste(utcDay(t), s.p.tasteRoundsPerDay))) return fail('no_taste_left');
    const e = await entitlementFor(s.p, s.gameId, s.scope);
    // TODO(S2b): record the one-round grant so authorizeRound can honour it.
    return { ok: true, grantId: crypto.randomUUID(), tasteRoundsLeft: e?.tasteRoundsLeft ?? 0 };
  },

  async switchFreeMode(env: Env, caller: unknown, gameSessionId: unknown, mode: unknown): Promise<Result<{ freeGame: string; lockedUntil: number }>> {
    const s = await withSession(env, caller, 'switchFreeMode', gameSessionId);
    if ('ok' in s) return s;
    if (!s.p.freeTierEnabled) return fail('disabled');
    if (typeof mode !== 'string' || !s.p.registry[s.gameId].modes.includes(mode)) return fail('unknown_mode');
    const key = `${s.gameId}:${mode}`;
    if (!freeGameKeys(s.p).includes(key)) return fail('not_allowed');
    const t = now();
    if (!(await s.scope.switchFreeGame(key, t, s.p.switchCooldownMs))) {
      const profile = await s.scope.profile();
      return profile?.free_game === key ? fail('already_free') : fail('cooldown');
    }
    return { ok: true, freeGame: key, lockedUntil: t + s.p.switchCooldownMs };
  },

  async listLists(env: Env, caller: unknown, gameSessionId: unknown) {
    const s = await withSession(env, caller, 'listLists', gameSessionId);
    if ('ok' in s) return s;
    return { ok: true as const, lists: await s.scope.listLists(now(), freeListAllowance(s.p)) };
  },

  async getList(env: Env, caller: unknown, gameSessionId: unknown, listId: unknown) {
    const s = await withSession(env, caller, 'getList', gameSessionId);
    if ('ok' in s) return s;
    if (typeof listId !== 'string' || !ID_RE.test(listId)) return fail('not_found');
    const list = await s.scope.getList(listId, now(), freeListAllowance(s.p));
    return list ? { ok: true as const, list } : fail('not_found');
  },

  async saveList(env: Env, caller: unknown, gameSessionId: unknown, input: unknown): Promise<Result<{ id: string }>> {
    const s = await withSession(env, caller, 'saveList', gameSessionId);
    if ('ok' in s) return s;
    const i = (input ?? {}) as { id?: unknown; title?: unknown; level?: unknown; items?: unknown };
    const title = cleanText(i.title, 120);
    const level = i.level === undefined || i.level === null ? null : cleanText(i.level, 40);
    if (!title || (i.level != null && !level) || !Array.isArray(i.items) || i.items.length === 0 || i.items.length > s.p.listMaxItems) return fail('bad_list');
    let itemsJson: string;
    try {
      itemsJson = JSON.stringify(i.items); // throws on BigInt, cycles: not JSON-safe
    } catch {
      return fail('bad_list');
    }
    if (typeof itemsJson !== 'string' || new TextEncoder().encode(itemsJson).length > s.p.listMaxBytes) return fail('bad_list');
    const t = now();
    const allow = freeListAllowance(s.p);
    if (i.id !== undefined) {
      if (typeof i.id !== 'string' || !ID_RE.test(i.id)) return fail('not_found');
      if (await s.scope.updateList({ id: i.id, title, level, itemsJson }, t, allow)) return { ok: true, id: i.id };
      return (await s.scope.isPaid(t)) || allow > 0 ? fail('not_found') : fail('paid_only');
    }
    const id = crypto.randomUUID();
    if (await s.scope.insertList({ id, title, level, itemsJson }, t, allow, s.p.paidListLimit)) return { ok: true, id };
    // The decision was made inside the insert; this read only picks the message.
    return (await s.scope.isPaid(t)) || allow > 0 ? fail('list_limit') : fail('paid_only');
  },

  async deleteList(env: Env, caller: unknown, gameSessionId: unknown, listId: unknown): Promise<Result<object>> {
    const s = await withSession(env, caller, 'deleteList', gameSessionId);
    if ('ok' in s) return s;
    if (typeof listId !== 'string' || !ID_RE.test(listId)) return fail('not_found');
    return (await s.scope.deleteList(listId, now(), freeListAllowance(s.p))) ? { ok: true } : fail('not_found');
  },

  async listClasses(env: Env, caller: unknown, gameSessionId: unknown) {
    const s = await withSession(env, caller, 'listClasses', gameSessionId);
    if ('ok' in s) return s;
    return { ok: true as const, classes: await s.scope.listClasses(now()) };
  },

  async saveClass(env: Env, caller: unknown, gameSessionId: unknown, input: unknown): Promise<Result<{ id: string; classCode?: string }>> {
    const s = await withSession(env, caller, 'saveClass', gameSessionId);
    if ('ok' in s) return s;
    const i = (input ?? {}) as { id?: unknown; name?: unknown; listId?: unknown };
    const name = cleanText(i.name, 80);
    const listId = i.listId === undefined || i.listId === null ? null : typeof i.listId === 'string' && ID_RE.test(i.listId) ? i.listId : undefined;
    if (!name || listId === undefined) return fail('bad_class');
    const t = now();
    if (!(await s.scope.isPaid(t))) return fail('paid_only');
    try {
      if (i.id !== undefined) {
        if (typeof i.id !== 'string' || !ID_RE.test(i.id)) return fail('not_found');
        return (await s.scope.updateClass({ id: i.id, name, listId }, t)) ? { ok: true, id: i.id } : fail('not_found');
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = crypto.randomUUID();
        const code = classCode(s.p.classCodeLength);
        try {
          return (await s.scope.insertClass({ id, name, code, listId }, t)) ? { ok: true, id, classCode: code } : fail('paid_only');
        } catch (e) {
          if (!/UNIQUE/i.test(String(e))) throw e;
        }
      }
      return fail('try_again');
    } catch (e) {
      // FOREIGN KEY: the list is not hers.
      if (/FOREIGN KEY/i.test(String(e))) return fail('not_found');
      throw e;
    }
  },

  async deleteClass(env: Env, caller: unknown, gameSessionId: unknown, classId: unknown): Promise<Result<object>> {
    const s = await withSession(env, caller, 'deleteClass', gameSessionId);
    if ('ok' in s) return s;
    if (typeof classId !== 'string' || !ID_RE.test(classId)) return fail('not_found');
    const t = now();
    if (!(await s.scope.isPaid(t))) return fail('paid_only');
    return (await s.scope.deleteClass(classId, t)) ? { ok: true } : fail('not_found');
  },

  async mintRoomPass(env: Env, caller: unknown, gameSessionId: unknown, roomCode: unknown): Promise<Result<{ passId: string; allowedModes: string[]; expiresAt: number }>> {
    const s = await withSession(env, caller, 'mintRoomPass', gameSessionId);
    if ('ok' in s) return s;
    if (typeof roomCode !== 'string' || !ROOM_RE.test(roomCode)) return fail('bad_room');
    const t = now();
    const profile = await s.scope.profile();
    if (!profile) return fail('signed_out');
    const modes = s.p.registry[s.gameId].modes;
    const paid = await s.scope.isPaid(t);
    const free = s.p.freeTierEnabled && profile.free_game?.startsWith(`${s.gameId}:`) ? [profile.free_game.slice(s.gameId.length + 1)] : [];
    const allowed = paid ? modes : free.filter((m) => modes.includes(m));
    if (allowed.length === 0) return fail(paid || s.p.freeTierEnabled ? 'no_modes' : 'paid_only');
    const pass = await mintSecret(env, s.p.hashKeyCurrent);
    // One conditional INSERT re-checks paid status, the entitlement version read
    // above and the calling session; a revoke in between leaves no pass.
    const ok = await s.scope.insertRoomPass({
      hash: pass.hash, gameId: s.gameId, roomCode, modes: allowed, now: t, ttlMs: s.p.roomPassMs,
      expectedVersion: profile.entitlement_version, requirePaid: paid, gameSessionHash: s.row.id_hash,
    });
    if (!ok) return fail('revoked');
    return { ok: true, passId: pass.value, allowedModes: allowed, expiresAt: t + s.p.roomPassMs };
  },

  async checkRoomPass(env: Env, caller: unknown, passId: unknown) {
    const g = await gate(env, caller, 'checkRoomPass');
    if ('ok' in g) return g;
    const presented = await hashPresented(env, passId);
    if (!presented) return { ok: true as const, valid: false, reason: 'unknown' as const };
    return { ok: true as const, ...(await checkRoomPassRow(openDb(env), presented.hash, g.gameId, now())) };
  },

  async signOut(env: Env, caller: unknown, gameSessionId: unknown): Promise<Result<object>> {
    const s = await withSession(env, caller, 'signOut', gameSessionId);
    if ('ok' in s) return s;
    await s.scope.endDevice(s.row.hub_session_id_hash);
    return { ok: true };
  },
};

export { teacherExists };
