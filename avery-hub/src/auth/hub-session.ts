// The hub's own session: cookie __Host-avery_hub holds "v<N>.<random>"; only
// its HMAC (with key version N) is stored. Idle and absolute lifetimes are
// checked in SQL; the id rotates every SESSION_ROTATE_DAYS of use and when the
// current key version changes.
import type { Env } from '../env';
import type { Policy } from '../config';
import { hashPresented, hmacHex, mintSecret, safeEqual } from '../crypto';
import { createHubSession, openDb, resolveHubSession, rotateHubSession } from '../db';
import { HUB_COOKIE, readCookie, setCookie } from './cookies';

export interface HubSession {
  teacherId: string;
  hash: string;
  keyVersion: number;
  setCookie?: string;
}

export async function currentHubSession(req: Request, env: Env, p: Policy, nowMs: number): Promise<HubSession | null> {
  const presented = await hashPresented(env, readCookie(req, HUB_COOKIE));
  if (!presented) return null;
  const db = openDb(env);
  const row = await resolveHubSession(db, presented.hash, nowMs, p.sessionIdleMs);
  if (!row) return null;
  const s: HubSession = { teacherId: row.teacher_id, hash: row.id_hash, keyVersion: row.key_version };
  if (nowMs - row.rotated_at >= p.sessionRotateMs || row.key_version !== p.hashKeyCurrent) {
    const fresh = await mintSecret(env, p.hashKeyCurrent);
    if (await rotateHubSession(db, row.id_hash, fresh.hash, fresh.version, nowMs)) {
      s.hash = fresh.hash;
      s.keyVersion = fresh.version;
      s.setCookie = setCookie(HUB_COOKIE, fresh.value, (row.absolute_expiry - nowMs) / 1000);
    }
  }
  return s;
}

export async function startHubSession(env: Env, p: Policy, teacherId: string, label: string, nowMs: number): Promise<{ hash: string; cookie: string }> {
  const fresh = await mintSecret(env, p.hashKeyCurrent);
  await createHubSession(openDb(env), { teacherId, hash: fresh.hash, version: fresh.version, label, now: nowMs, maxMs: p.sessionMaxMs });
  return { hash: fresh.hash, cookie: setCookie(HUB_COOKIE, fresh.value, p.sessionMaxMs / 1000) };
}

export function csrfToken(env: Env, s: HubSession): Promise<string> {
  return hmacHex(env, s.keyVersion, `csrf:${s.hash}`);
}

export async function csrfOk(env: Env, s: HubSession, presented: unknown): Promise<boolean> {
  if (typeof presented !== 'string') return false;
  return safeEqual(await csrfToken(env, s), presented);
}

/** State-changing requests must come from the hub's own pages. */
export function originOk(req: Request, p: Policy): boolean {
  const o = req.headers.get('Origin');
  return Boolean(o && p.hubOrigin && o === p.hubOrigin);
}

/** "Chrome on Mac"-style label; the raw user agent is never stored. */
export function browserLabel(req: Request): string {
  const ua = req.headers.get('User-Agent') ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'Chromebook' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'a computer';
  return `${browser} on ${os}`;
}
