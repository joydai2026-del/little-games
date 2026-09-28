// Worker entry: the /api/* router. Everything else is the static site.
//
//   POST /api/rooms                 { name?, text, mode?: "class" | "solo", options? } -> { code, playerId, playerSecret, state }
//   POST /api/rooms/:code/join      { name, agent? }          -> { playerId, playerSecret, state }
//   GET  /api/rooms/:code?v=N       -> { state } or { unchanged, nextPollMs }
//   GET  /api/rooms/:code/say?r=R&w=N  the audio clip of word N of round R (players of that round only)
//   POST /api/rooms/:code/stroke    { race, seq, wordIndex, charIndex, points: [[x, y], ...] }  the room grades it
//                                   race = state.round; seq = this player's send counter (1, 2, 3...)
//   POST /api/rooms/:code/skip      { race, seq, wordIndex }  move on without writing the word
//   POST /api/rooms/:code/start     host only (lobby -> racing)
//   POST /api/rooms/:code/next      host only (done -> racing, next words)
//   POST /api/rooms/:code/list      host only { text }
//   POST /api/rooms/:code/options   host only { level?: "easy" | "hard", secondsPerWord?, wordsPerRound? }
//   GET  /api/rooms/:code/budget    this room's paid speech calls today (players)
//   GET  /api/tts-budget            the game's paid speech calls today + policy (read-only)
//   GET  /api/strokes/:char         one character's stroke JSON (pinned, hash-checked proxy)
//
// Every room route except create and join carries x-player-id / x-player-secret.

import { newRoomCode, ROOM_CODE_RE } from '../shared/ids';
import { GAME } from '../shared/config';
import type { Env } from './env';
import { handleStrokes } from './strokes';
import { budgetConfig, ttsConfig } from './env';

export { RoomDO } from './room-do';
export { BudgetDO } from './budget-do';

const ACTIONS = new Set(['join', 'start', 'next', 'list', 'options', 'stroke', 'skip']);

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
  // The speech rate limit is per IP; the room only ever sees this header from the Worker.
  headers.set('x-client-ip', request.headers.get('CF-Connecting-IP') ?? 'no-ip');
  const init: RequestInit =
    bodyText === undefined ? { method: 'GET', headers } : { method: 'POST', headers, body: bodyText || '{}' };
  return roomStub(env, code).fetch(new Request(`https://room/${path}`, init));
}

/** Room creation FAILS CLOSED: no limiter bound, or a limiter error, means no new room. */
async function limited(request: Request, env: Env): Promise<Response | null> {
  const limiter = env.ROOM_CREATE_LIMITER;
  const closed = json({ error: 'new rooms are paused right now, please try again in a minute' }, 503, { 'Retry-After': '60' });
  if (!limiter) return closed;
  try {
    const { success } = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'no-ip' });
    if (success) return null;
  } catch {
    return closed;
  }
  return json({ error: 'too many new rooms from here at once, wait a minute and try again' }, 429, { 'Retry-After': '60' });
}

/** GET /api/tts-budget: today's paid speech calls for the whole game, and the policy. Read-only. */
async function budgetRoute(env: Env): Promise<Response> {
  const { roomDaily, globalDaily, ipDaily } = budgetConfig(env);
  const base = { model: ttsConfig(env).model, maxAttemptsPerWord: ttsConfig(env).maxAttempts, roomDailyLimit: roomDaily, globalDailyLimit: globalDaily, ipDailyLimit: ipDaily };
  if (!env.BUDGET) return json({ ...base, error: 'no budget counter bound: speech is off' }, 503);
  try {
    const r = await env.BUDGET.get(env.BUDGET.idFromName('global')).fetch(new Request('https://budget/read'));
    return json({ ...base, ...((await r.json()) as object) });
  } catch {
    return json({ ...base, error: 'the budget counter did not answer: speech is off' }, 503);
  }
}

/** GET /api/rooms/:code/say?w=N: the room checks the player and the word, and answers with the clip. */
function sayRoute(env: Env, code: string, request: Request, url: URL): Promise<Response> {
  const w = url.searchParams.get('w') ?? '';
  const r = url.searchParams.get('r') ?? '';
  if (!/^\d{1,3}$/.test(w) || !/^\d{1,6}$/.test(r)) return Promise.resolve(json({ error: 'say which round and word: ?r=<round>&w=0, 1, 2...' }, 400));
  return forward(env, code, `say?w=${w}&r=${r}`, request);
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
        body: JSON.stringify({ code, name: body.name, text: body.text, mode: body.mode, options: body.options }),
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

    if (path === '/api/tts-budget') {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      return budgetRoute(env);
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
    if (action === 'budget') {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      return forward(env, code, 'budget', request);
    }
    if (action === 'say') {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      return sayRoute(env, code, request, url);
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
