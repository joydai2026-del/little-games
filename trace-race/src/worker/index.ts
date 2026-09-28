// Worker entry: the /api/* router. Everything else is the static site.
//
//   POST /api/rooms                 { name?, text, options? } -> { code, playerId, playerSecret, state }
//   POST /api/rooms/:code/join      { name, agent? }          -> { playerId, playerSecret, state }
//   GET  /api/rooms/:code?v=N       -> { state } or { unchanged, nextPollMs }
//   POST /api/rooms/:code/stroke    { charIndex, strokeIndex, result: "correct" | "mistake" }
//   POST /api/rooms/:code/start     teacher only (lobby -> racing)
//   POST /api/rooms/:code/next      teacher only (done -> racing, next characters)
//   POST /api/rooms/:code/list      teacher only { text }
//   POST /api/rooms/:code/options   teacher only { secondsPerChar?, charsPerRound?, hints? }
//   GET  /api/strokes/:char         one character's stroke JSON (pinned, hash-checked proxy)
//
// Every room route except create and join carries x-player-id / x-player-secret.

import { newRoomCode, ROOM_CODE_RE } from '../shared/ids';
import { GAME } from '../shared/config';
import type { Env } from './env';
import { handleStrokes } from './strokes';

export { RoomDO } from './room-do';

const CODE_ATTEMPTS = 5;
const ACTIONS = new Set(['join', 'start', 'next', 'list', 'options', 'stroke']);

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

async function readText(request: Request): Promise<string> {
  const text = await request.text();
  // A paste is small; anything much bigger is not a character list.
  return text.length > GAME.maxPasteLength * 4 ? '' : text;
}

function forward(env: Env, code: string, path: string, request: Request, bodyText?: string): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['x-player-id', 'x-player-secret']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init: RequestInit =
    bodyText === undefined ? { method: 'GET', headers } : { method: 'POST', headers, body: bodyText || '{}' };
  return roomStub(env, code).fetch(new Request(`https://room/${path}`, init));
}

async function limited(request: Request, env: Env): Promise<Response | null> {
  const limiter = env.ROOM_CREATE_LIMITER;
  if (!limiter) return null;
  try {
    const { success } = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'no-ip' });
    if (success) return null;
  } catch {
    return null;
  }
  return json({ error: 'too many new rooms from here at once, wait a minute and try again' }, 429, { 'Retry-After': '60' });
}

async function createRoomRoute(request: Request, env: Env): Promise<Response> {
  const over = await limited(request, env);
  if (over) return over;
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readText(request)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = newRoomCode();
    const res = await roomStub(env, code).fetch(
      new Request('https://room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: body.name, text: body.text, options: body.options }),
      })
    );
    if (res.status === 409) continue;
    return res;
  }
  return json({ error: 'could not find a free room code, please try again' }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const strokes = path.match(/^\/api\/strokes\/([^/]+)$/);
    if (strokes) {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      const cache = typeof caches !== 'undefined' ? caches.default : null;
      return handleStrokes(strokes[1], env, request, { fetch: (input, init) => fetch(input, init), cache });
    }

    if (path === '/api/rooms') {
      if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
      return createRoomRoute(request, env);
    }

    const match = path.match(/^\/api\/rooms\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (!match) return json({ error: 'not found' }, 404);
    const code = decodeURIComponent(match[1]).toUpperCase();
    const action = match[2];
    if (!ROOM_CODE_RE.test(code)) return json({ error: 'that room is not around any more' }, 404);

    if (!action) {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      const v = url.searchParams.get('v');
      return forward(env, code, v !== null ? `state?v=${encodeURIComponent(v)}` : 'state', request);
    }
    if (!ACTIONS.has(action)) return json({ error: 'not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
    return forward(env, code, action, request, await readText(request));
  },
} satisfies ExportedHandler<Env>;
