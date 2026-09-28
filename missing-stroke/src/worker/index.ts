// Worker entry: the /api/* router. Everything else is the static site.
//
//   POST /api/rooms                 { name?, text, options? } -> { code, playerId, playerSecret, state }
//   POST /api/rooms/:code/join      { name, agent? }          -> { playerId, playerSecret, state }
//   GET  /api/rooms/:code?v=N       -> { state } or { unchanged, nextPollMs }
//   POST /api/rooms/:code/stroke    { race, seq, turn, result: "correct" | "mistake" }
//                                   race = state.round; turn = state.turn.index;
//                                   seq = this racer's answer counter (1, 2, 3...)
//   POST /api/rooms/:code/start     teacher only (lobby -> racing)
//   POST /api/rooms/:code/next      teacher only (done -> racing, next characters)
//   POST /api/rooms/:code/list      teacher only { text }
//   POST /api/rooms/:code/options   teacher only { level?: "little" | "middle" | "big", charsPerRound? }
//   GET  /api/strokes/:char         one character's stroke JSON (pinned, hash-checked proxy)
//                                   (the missing stroke is state.turn.hidden, an index into its strokes)
//
// Every room route except create and join carries x-player-id / x-player-secret.

import { newRoomCode, ROOM_CODE_RE } from '../shared/ids';
import { GAME } from '../shared/config';
import type { Env } from './env';
import { handleStrokes } from './strokes';

export { RoomDO } from './room-do';

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

class BodyTooBig extends Error {}

/**
 * Reads a request body, refusing anything over GAME.maxBodyBytes: by
 * Content-Length when the client sends one, and by counting bytes as they
 * stream in when it does not, so a huge body is never buffered whole.
 */
async function readText(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > GAME.maxBodyBytes) throw new BodyTooBig();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > GAME.maxBodyBytes) {
      await reader.cancel();
      throw new BodyTooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

const TOO_BIG = () => json({ error: `That is too much text. Paste a shorter list (up to ${GAME.maxPasteLength} characters).` }, 413);

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
  let raw: string;
  try {
    raw = await readText(request);
  } catch {
    return TOO_BIG();
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  for (let i = 0; i < GAME.roomCodeAttempts; i++) {
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
    let code: string;
    try {
      code = decodeURIComponent(match[1]).toUpperCase();
    } catch {
      return json({ error: 'that is not a room code' }, 400);
    }
    const action = match[2];
    if (!ROOM_CODE_RE.test(code)) return json({ error: 'that room is not around any more' }, 404);

    if (!action) {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      const v = url.searchParams.get('v');
      return forward(env, code, v !== null ? `state?v=${encodeURIComponent(v)}` : 'state', request);
    }
    if (!ACTIONS.has(action)) return json({ error: 'not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
    let text: string;
    try {
      text = await readText(request);
    } catch {
      return TOO_BIG();
    }
    return forward(env, code, action, request, text);
  },
} satisfies ExportedHandler<Env>;
