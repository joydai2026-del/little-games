// Sign-in and hand-off (plan "Sign-in and hand-off flow").
//   GET  /auth/start?game=<id>&bind=<sha256 hex>[&return=<registered url>]
//   GET  /auth/callback            (Google comes back here)
//   POST /auth/devices             (device-limit picker)
//   POST /auth/signout, /auth/signout-everywhere
import type { Env } from '../env';
import { policy, type Policy } from '../config';
import { hashPresented, hex, mintSecret, randomToken, safeEqual } from '../crypto';
import { forTeacher, openDb, upsertTeacherBySub } from '../db';
import { now } from '../clock';
import { cantSignIn, esc, page } from '../pages/layout';
import { authUrl, exchangeAndVerify, googleReady } from './google';
import { HUB_COOKIE, OAUTH_COOKIE, PENDING_COOKIE, clearCookie, readCookie, setCookie } from './cookies';
import { browserLabel, csrfOk, currentHubSession, originOk, startHubSession } from './hub-session';
import { createToken, takeToken } from './tokens';

const BIND_RE = /^[0-9a-f]{64}$/;

function redirect(to: string, cookies: string[] = [], status = 303): Response {
  const h = new Headers({ Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status, headers: h });
}

function badLink(p: Policy): Response {
  return page(
    "This sign-in link isn't right",
    `<h1>This sign-in link isn't right</h1><div class="card"><p>Please go back to the game and tap "Sign in" again.</p></div>`,
    { status: 400, supportEmail: p.supportEmail },
  );
}

interface Target {
  gameId: string | null;
  bindHash: string | null;
  returnUrl: string | null;
}

/** Validate game, bind and return url against GAME_REGISTRY. */
function readTarget(url: URL, p: Policy): Target | 'bad' {
  const game = url.searchParams.get('game');
  if (!game) return { gameId: null, bindHash: null, returnUrl: null };
  const entry = p.registry[game];
  const bind = url.searchParams.get('bind') ?? '';
  if (!entry || !BIND_RE.test(bind) || entry.returnUrls.length === 0) return 'bad';
  const wanted = url.searchParams.get('return');
  const returnUrl = wanted ? entry.returnUrls.find((u) => u === wanted) : entry.returnUrls[0];
  if (!returnUrl) return 'bad';
  return { gameId: game, bindHash: bind, returnUrl };
}

/**
 * The abuse-bucket key for a request that arrived at Cloudflare's edge
 * (`request.cf` present), where CF-Connecting-IP is set by Cloudflare and a
 * client-set value is refused. A request without `request.cf` is a same-zone
 * subrequest from our own Workers (or local dev): it gets no address bucket
 * (null) and relies on the per-bind bucket. Edge request with no address or no
 * RATE_KEY: 'unavailable' (fail closed).
 */
async function addressKey(env: Env, req: Request): Promise<string | null | 'unavailable'> {
  if (!(req as unknown as { cf?: unknown }).cf) return null;
  const ip = req.headers.get('CF-Connecting-IP');
  const k = env.RATE_KEY;
  if (!ip || typeof k !== 'string' || k.length < 16) return 'unavailable';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `addr:${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)))}`;
}

function hashKeyReady(env: Env, p: Policy): boolean {
  const k = env[`SESSION_HASH_KEY_V${p.hashKeyCurrent}`];
  return typeof k === 'string' && k.length >= 16;
}

/** Send her on: to the game with a fresh hand-off token, or to her profile. */
async function finish(env: Env, p: Policy, t: Target, hub: { teacherId: string; hash: string }, cookies: string[]): Promise<Response> {
  if (!t.gameId || !t.returnUrl) return redirect('/me', cookies);
  const token = await mintSecret(env, p.hashKeyCurrent);
  await createToken(env, token.hash, {
    kind: 'handoff',
    expiresAt: now() + p.handoffMs,
    gameId: t.gameId,
    bindHash: t.bindHash,
    data: { teacherId: hub.teacherId, hubHash: hub.hash },
  });
  return redirect(`${t.returnUrl}#t=${encodeURIComponent(token.value)}`, cookies);
}

export async function authStart(req: Request, env: Env): Promise<Response> {
  const p = policy(env);
  const url = new URL(req.url);
  const t = readTarget(url, p);
  if (t === 'bad') return badLink(p);
  if (t.gameId && env.AUTH_START_LIMITER && !(await env.AUTH_START_LIMITER.limit({ key: `${t.gameId}:${t.bindHash}` })).success) {
    return cantSignIn(p.supportEmail, 429);
  }
  if (!hashKeyReady(env, p)) return cantSignIn(p.supportEmail);
  // A teacher already signed in to the hub goes straight on: the address
  // bucket below never blocks her, however much junk shares her school address.
  const hub = await currentHubSession(req, env, p, now());
  if (hub) return finish(env, p, t, hub, hub.setCookie ? [hub.setCookie] : []);
  // Only a NEW sign-in (which creates OAuth state in a TokenDO) passes the
  // abuse bucket per connecting address, keyed by HMAC(RATE_KEY, address) so
  // the raw address is never a key, stored or logged.
  const addr = await addressKey(env, req);
  if (addr === 'unavailable') return cantSignIn(p.supportEmail);
  if (addr && env.AUTH_ADDRESS_LIMITER && !(await env.AUTH_ADDRESS_LIMITER.limit({ key: addr })).success) return cantSignIn(p.supportEmail, 429);
  if (!googleReady(env, p)) return cantSignIn(p.supportEmail);

  // "v<N>.<random>": the key version travels with the value, so a key
  // rotation mid-sign-in still finds the right TokenDO.
  const stateTok = await mintSecret(env, p.hashKeyCurrent);
  const state = stateTok.value;
  const nonce = randomToken(24);
  await createToken(env, stateTok.hash, {
    kind: 'state',
    expiresAt: now() + p.oauthStateMs,
    gameId: t.gameId,
    bindHash: t.bindHash,
    data: { nonce, returnUrl: t.returnUrl },
  });
  return redirect(authUrl(p, state, nonce), [setCookie(OAUTH_COOKIE, state, p.oauthStateMs / 1000)], 302);
}

export async function authCallback(req: Request, env: Env): Promise<Response> {
  const p = policy(env);
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const cookieState = readCookie(req, OAUTH_COOKIE) ?? '';
  const clearOauth = clearCookie(OAUTH_COOKIE);
  // Login CSRF on the hub itself: the state must be the one THIS browser started.
  if (!state || !code || !cookieState || !safeEqual(state, cookieState) || !googleReady(env, p) || !hashKeyReady(env, p)) {
    return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearOauth });
  }
  const stateHash = await hashPresented(env, state);
  if (!stateHash) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearOauth });
  const taken = await takeToken(env, stateHash.hash, 'state', {});
  if (!taken.ok) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearOauth });
  const rec = taken.record;
  const who = await exchangeAndVerify(env, p, code, String(rec.data.nonce ?? ''), now());
  if (!who) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearOauth });

  const db = openDb(env);
  const teacherId = await upsertTeacherBySub(db, who, now());
  const target: Target = { gameId: rec.gameId, bindHash: rec.bindHash, returnUrl: (rec.data.returnUrl as string | null) ?? null };
  const label = browserLabel(req);

  // Device limit: the session insert itself refuses a 4th device (one
  // statement, so concurrent sign-ins cannot overshoot). Then ask which device
  // to end; never sign anyone out silently.
  const hub = await startHubSession(env, p, teacherId, label, now());
  if (hub) return finish(env, p, target, { teacherId, hash: hub.hash }, [clearOauth, hub.cookie]);
  const devices = await forTeacher(db, teacherId).devices(now(), p.sessionIdleMs);
  const pendingTok = await mintSecret(env, p.hashKeyCurrent);
  const pending = pendingTok.value;
  await createToken(env, pendingTok.hash, {
    kind: 'pending',
    expiresAt: now() + p.oauthStateMs,
    gameId: target.gameId,
    bindHash: target.bindHash,
    data: { teacherId, returnUrl: target.returnUrl, label },
  });
  const rows = devices
    .map(
      (d) => `<form method="post" action="/auth/devices">
<input type="hidden" name="pending" value="${esc(pending)}"><input type="hidden" name="end" value="${esc(d.id_hash)}">
<div class="row"><span>${esc(d.browser_label)}<br><span class="muted">Last used ${esc(new Date(d.last_used_at).toDateString())}</span></span></div>
<button class="btn-secondary" type="submit">Sign out this one</button></form>`,
    )
    .join('');
  return page(
    'Pick a device to sign out',
    `<h1>You're signed in on ${devices.length} devices</h1>
<div class="card"><p>You can be signed in on up to ${p.maxDevices}. Pick one to sign out, and this one will sign in.</p>${rows}</div>`,
    {
      supportEmail: p.supportEmail,
      formRedirectOrigins: target.returnUrl ? [new URL(target.returnUrl).origin] : [],
      headers: [['Set-Cookie', clearOauth], ['Set-Cookie', setCookie(PENDING_COOKIE, pending, p.oauthStateMs / 1000)]],
    },
  );
}

export async function authDevices(req: Request, env: Env): Promise<Response> {
  const p = policy(env);
  if (req.method !== 'POST' || !originOk(req, p)) return new Response('Forbidden', { status: 403 });
  const form = await req.formData().catch(() => null);
  const pending = String(form?.get('pending') ?? '');
  const end = String(form?.get('end') ?? '');
  const cookie = readCookie(req, PENDING_COOKIE) ?? '';
  const clearPending = clearCookie(PENDING_COOKIE);
  if (!pending || !cookie || !safeEqual(pending, cookie) || !hashKeyReady(env, p)) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearPending });
  const pendingHash = await hashPresented(env, pending);
  if (!pendingHash) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearPending });
  const taken = await takeToken(env, pendingHash.hash, 'pending', {});
  if (!taken.ok) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearPending });
  const rec = taken.record;
  const teacherId = String(rec.data.teacherId);
  const scope = forTeacher(openDb(env), teacherId);
  if (!(await scope.endDevice(end))) return cantSignIn(p.supportEmail, 400, { 'Set-Cookie': clearPending });
  const hub = await startHubSession(env, p, teacherId, String(rec.data.label ?? 'A browser'), now());
  if (!hub) return cantSignIn(p.supportEmail, 409, { 'Set-Cookie': clearPending });
  const target: Target = { gameId: rec.gameId, bindHash: rec.bindHash, returnUrl: (rec.data.returnUrl as string | null) ?? null };
  return finish(env, p, target, { teacherId, hash: hub.hash }, [clearPending, hub.cookie]);
}

async function signedInPost(req: Request, env: Env) {
  const p = policy(env);
  if (req.method !== 'POST' || !originOk(req, p)) return { error: new Response('Forbidden', { status: 403 }) } as const;
  const hub = await currentHubSession(req, env, p, now());
  if (!hub) return { error: redirect('/me') } as const;
  const form = await req.formData().catch(() => null);
  if (!(await csrfOk(env, hub, form?.get('csrf')))) {
    // Usually a page opened before the session id rotated in another tab.
    return {
      error: page(
        'Please try again',
        `<h1>Please try again</h1><div class="card"><p>This page was open for a while, so we could not be sure it was you. Please go back to your account page and tap the button again.</p></div>
<a class="btn-primary" href="/me">Go to my account</a>`,
        { status: 403, supportEmail: p.supportEmail },
      ),
    } as const;
  }
  return { p, hub, form } as const;
}

export async function authSignOut(req: Request, env: Env, everywhere: boolean): Promise<Response> {
  const r = await signedInPost(req, env);
  if ('error' in r) return r.error!;
  const scope = forTeacher(openDb(env), r.hub.teacherId);
  if (everywhere) await scope.endAllDevices();
  else await scope.endDevice(r.hub.hash);
  return page(
    'Signed out',
    `<h1>${everywhere ? "You're signed out everywhere" : "You're signed out"}</h1>
<div class="card"><p>${everywhere ? 'Every device and every game is signed out of Avery Studio.' : 'This device is signed out of Avery Studio.'}</p>
<p class="muted">You're still signed in to your Google account. Sign out of Google separately if this is a shared computer.</p></div>
<a class="btn-primary" href="/me">OK</a>`,
    { supportEmail: r.p.supportEmail, headers: { 'Set-Cookie': clearCookie(HUB_COOKIE) } },
  );
}

export { signedInPost, redirect, hashPresented };
