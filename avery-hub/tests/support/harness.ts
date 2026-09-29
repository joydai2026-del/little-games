// A whole hub in memory: real SQLite (fake-d1), real TokenDO class over a Map
// storage, a local fake Google issuer and a fake Access issuer with keys made
// here, and a fetch stub that answers only those two. Nothing touches the
// network. All secret values are random per run.
import { vi } from 'vitest';
import worker from '../../src/index';
import { TokenDO } from '../../src/do/token-do';
import { hub } from '../../src/rpc/core';
import { b64url, randomToken, sha256Hex } from '../../src/crypto';
import { setClock } from '../../src/clock';
import { clearJwksCache } from '../../src/auth/jwt';
import type { Env } from '../../src/env';
import { freshDb, type FakeD1 } from './fake-d1';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const HUB = 'https://hub.test';

let defaultVars: Record<string, unknown> = {};
/** Per test file: vars every buildHub() in that file starts from (e.g. FREE_TIER_ENABLED). */
export function setDefaultVars(v: Record<string, unknown>): void {
  defaultVars = v;
}

/** A counting stand-in for a Cloudflare rate-limit binding, using the limits in wrangler.jsonc. */
export class CountingLimiter {
  counts = new Map<string, number>();
  keys: string[] = [];
  constructor(readonly limit: number, readonly clock: { t: number }, readonly periodMs = 60_000) {}
  async limit_(key: string) {
    const k = `${Math.floor(this.clock.t / this.periodMs)}:${key}`;
    const n = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, n);
    this.keys.push(key);
    return { success: n <= this.limit };
  }
  limitFn = ({ key }: { key: string }) => this.limit_(key);
}

function wranglerLimits(): Record<string, number> {
  const text = readFileSync(join(decodeURIComponent(new URL('../..', import.meta.url).pathname), 'wrangler.jsonc'), 'utf8')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const cfg = JSON.parse(text) as { ratelimits: { name: string; simple: { limit: number } }[] };
  return Object.fromEntries(cfg.ratelimits.map((r) => [r.name, r.simple.limit]));
}
export const GOOGLE_ISS = 'https://accounts.google.test';
export const ACCESS_ISS = 'https://team.access.test';

class MapStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(k: string) { return structuredClone(this.map.get(k)) as T | undefined; }
  async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
  async delete(k: string) { return this.map.delete(k); }
  async deleteAll() { this.map.clear(); }
  async setAlarm(t: number) { this.alarm = t; }
}

export class Issuer {
  kid = randomToken(8);
  keys!: CryptoKeyPair;
  jwk!: JsonWebKey;
  async init() {
    this.keys = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    this.jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey;
    return this;
  }
  async sign(payload: Record<string, unknown>, key: CryptoKey = this.keys.privateKey): Promise<string> {
    const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const head = enc({ alg: 'RS256', kid: this.kid, typ: 'JWT' });
    const body = enc(payload);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  }
  jwks() {
    return { keys: [{ ...this.jwk, kid: this.kid, alg: 'RS256', use: 'sig' }] };
  }
}

export interface GoogleUser {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

export interface Hub {
  env: Env;
  db: FakeD1 & D1Database;
  google: Issuer;
  access: Issuer;
  clock: { t: number };
  gameKeys: Record<string, string>;
  /** What the fake Google token endpoint returns for a given code. */
  codes: Map<string, { user: GoogleUser; nonceOverride?: string; aud?: string; iss?: string; expOffset?: number }>;
  fetch(path: string, init?: RequestInit & { cookies?: Record<string, string> }): Promise<Response>;
  tokenStorage: Map<string, MapStorage>;
  core: typeof hub;
  limiters: Record<string, CountingLimiter>;
  fetchLog: string[];
}

export const METHODS = [
  'redeemHandoff', 'resolveSession', 'entitlement', 'authorizeRound', 'useTaste', 'switchFreeMode', 'listLists', 'getList',
  'saveList', 'deleteList', 'listClasses', 'saveClass', 'deleteClass', 'mintRoomPass', 'checkRoomPass', 'signOut',
];

export async function buildHub(opts: { vars?: Record<string, unknown>; methods?: Record<string, string[]> } = {}): Promise<Hub> {
  const google = await new Issuer().init();
  const access = await new Issuer().init();
  clearJwksCache();
  const clock = { t: Date.UTC(2026, 8, 29, 15, 0, 0) };
  setClock(() => clock.t);
  const db = freshDb();
  const gameKeys: Record<string, string> = { vocab: randomToken(32), 'trace-race': randomToken(32) };
  const registry = {
    vocab: { keyHash: await sha256Hex(gameKeys.vocab), returnUrls: ['https://vocab.test/auth/finish'], methods: opts.methods?.vocab ?? METHODS, modes: ['memory', 'race', 'climb'] },
    'trace-race': { keyHash: await sha256Hex(gameKeys['trace-race']), returnUrls: ['https://trace.test/auth/finish'], methods: opts.methods?.['trace-race'] ?? METHODS, modes: ['main'] },
    tianzige: { keyHash: '', returnUrls: ['https://tianzige.test/auth/finish'], methods: METHODS, modes: ['main'] },
  };
  const tokenStorage = new Map<string, MapStorage>();
  const tokenObjs = new Map<string, TokenDO>();
  const TOKENS = {
    idFromName: (n: string) => n,
    get: (id: string) => {
      let o = tokenObjs.get(id);
      if (!o) {
        const storage = new MapStorage();
        tokenStorage.set(id, storage);
        o = new TokenDO({ storage } as unknown as DurableObjectState, {} as never);
        tokenObjs.set(id, o);
      }
      return o;
    },
  };
  const limits = wranglerLimits();
  const limiters = Object.fromEntries(Object.entries(limits).map(([n, l]) => [n, new CountingLimiter(l, clock)]));
  const env = {
    DB: db,
    DB_READY: 'true',
    RATE_KEY: randomToken(32),
    FREE_TIER_ENABLED: 'false',
    ...Object.fromEntries(Object.entries(limiters).map(([n, l]) => [n, { limit: l.limitFn }])),
    TOKENS,
    BILLING: {},
    HUB_VERSION: 'test',
    HUB_ORIGIN: HUB,
    SUPPORT_EMAIL: 'hello@averystudio.org',
    GOOGLE_CLIENT_ID: 'client-test',
    GOOGLE_CLIENT_SECRET: randomToken(16),
    GOOGLE_AUTH_URL: `${GOOGLE_ISS}/auth`,
    GOOGLE_TOKEN_URL: `${GOOGLE_ISS}/token`,
    GOOGLE_JWKS_URL: `${GOOGLE_ISS}/certs`,
    GOOGLE_ISSUERS: GOOGLE_ISS,
    ACCESS_JWKS_URL: `${ACCESS_ISS}/cdn-cgi/access/certs`,
    ACCESS_ISSUER: ACCESS_ISS,
    ACCESS_AUD: 'aud-test',
    SESSION_HASH_KEY_CURRENT: '1',
    SESSION_HASH_KEY_V1: randomToken(32),
    SESSION_HASH_KEY_V2: randomToken(32),
    MAX_TEACHER_DEVICES: '3',
    FREE_LIST_LIMIT: '1',
    PAID_LIST_LIMIT: '500',
    FREE_TASTE_ROUNDS_PER_DAY: '1',
    FREE_MODE_SWITCH_COOLDOWN_DAYS: '5',
    FREE_GAME_CHOICES: 'all',
    GAME_REGISTRY: registry,
    ...defaultVars,
    ...opts.vars,
  } as unknown as Env;

  const codes = new Map<string, { user: GoogleUser; nonceOverride?: string; aud?: string; iss?: string; expOffset?: number }>();
  const nonces = new Map<string, string>(); // code -> nonce captured from the auth redirect
  const fetchLog: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fetchLog.push(url);
    if (url === `${GOOGLE_ISS}/certs`) return Response.json(google.jwks());
    if (url === `${ACCESS_ISS}/cdn-cgi/access/certs`) return Response.json(access.jwks());
    if (url === `${GOOGLE_ISS}/token`) {
      const form = new URLSearchParams(String(init?.body ?? ''));
      const entry = codes.get(form.get('code') ?? '');
      if (!entry || form.get('client_secret') !== env.GOOGLE_CLIENT_SECRET) return new Response('bad', { status: 400 });
      const nowS = Math.floor(clock.t / 1000);
      const id_token = await google.sign({
        iss: entry.iss ?? GOOGLE_ISS,
        aud: entry.aud ?? 'client-test',
        sub: entry.user.sub,
        email: entry.user.email,
        email_verified: entry.user.email_verified ?? true,
        name: entry.user.name ?? entry.user.email,
        nonce: entry.nonceOverride ?? nonces.get(form.get('code') ?? ''),
        iat: nowS,
        exp: nowS + (entry.expOffset ?? 3600),
      });
      return Response.json({ id_token });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });

  const h: Hub = {
    env, db, google, access, clock, gameKeys, codes, tokenStorage, core: hub, limiters, fetchLog,
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.cookies) headers.set('Cookie', Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
      const req = new Request(new URL(path, HUB).toString(), { ...init, headers, redirect: 'manual' });
      const res = await worker.fetch(req as never, env);
      // Capture the nonce Google would receive, keyed by the code the test will use.
      const loc = res.headers.get('Location');
      if (loc?.startsWith(`${GOOGLE_ISS}/auth`)) {
        const u = new URL(loc);
        (h as unknown as { lastAuth: URL }).lastAuth = u;
        for (const code of codes.keys()) if (!nonces.has(code)) nonces.set(code, u.searchParams.get('nonce') ?? '');
      }
      return res;
    },
  };
  return h;
}

export function cookiesFrom(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

export function caller(h: Hub, gameId = 'vocab') {
  return { gameId, gameKey: h.gameKeys[gameId] };
}

/**
 * Full sign-in as a real browser would: game makes a bind value, /auth/start,
 * Google (fake) returns a code, /auth/callback, then the game redeems.
 * Returns the hub cookie jar and the game session id.
 */
export async function signIn(h: Hub, user: GoogleUser, o: { gameId?: string; jar?: Record<string, string>; ua?: string } = {}) {
  const gameId = o.gameId ?? 'vocab';
  const bind = randomToken(32);
  const bindHash = await sha256Hex(bind);
  const jar: Record<string, string> = { ...(o.jar ?? {}) };
  const headers = o.ua ? { 'User-Agent': o.ua } : undefined;
  const start = await h.fetch(`/auth/start?game=${gameId}&bind=${bindHash}`, { cookies: jar, headers });
  Object.assign(jar, cookiesFrom(start));
  let loc = start.headers.get('Location') ?? '';
  if (loc.startsWith(`${GOOGLE_ISS}/auth`)) {
    const state = new URL(loc).searchParams.get('state')!;
    const nonce = new URL(loc).searchParams.get('nonce')!;
    const code = randomToken(12);
    h.codes.set(code, { user, nonceOverride: nonce });
    const cb = await h.fetch(`/auth/callback?state=${state}&code=${code}`, { cookies: jar, headers });
    Object.assign(jar, cookiesFrom(cb));
    for (const [k, v] of Object.entries(jar)) if (v === '') delete jar[k];
    loc = cb.headers.get('Location') ?? '';
    if (cb.status === 200) return { jar, page: cb, bind, bindHash, token: null as string | null, gameSessionId: null as string | null };
  }
  const token = decodeURIComponent(new URL(loc).hash.replace(/^#t=/, ''));
  const r = await h.core.redeemHandoff(h.env, caller(h, gameId), token, bind);
  if (!r.ok) throw new Error(`redeem failed: ${r.error}`);
  return { jar, page: null as Response | null, bind, bindHash, token, gameSessionId: r.gameSessionId };
}

export async function accessToken(h: Hub, extra: Record<string, unknown> = {}) {
  const nowS = Math.floor(h.clock.t / 1000);
  return h.access.sign({ iss: ACCESS_ISS, aud: 'aud-test', email: 'admin@averystudio.org', iat: nowS, exp: nowS + 300, ...extra });
}
