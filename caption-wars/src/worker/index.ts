// Worker entry point: the /api/* router. Anything that is not /api/* is served
// from the static assets binding (the Vite build output, with the SPA fallback
// configured in wrangler.jsonc), so a deep link like /#/room/ABCD works.
//
// Routes:
//   POST /api/rooms                    { name, options? }   -> { code, playerId, playerSecret, state, serverTime }
//   POST /api/rooms/:code/join         { name }             -> { playerId, playerSecret, state, serverTime }
//   POST /api/rooms/:code/start        host only, lobby -> caption
//   POST /api/rooms/:code/caption      { text }
//   POST /api/rooms/:code/vote         { captionId }
//   POST /api/rooms/:code/next         host only, reveal -> next round or done
//   GET  /api/rooms/:code?v=N          -> { state, serverTime } or { unchanged, nextPollMs, serverTime }
//   GET  /api/rooms/:code/photo/:round -> the round's image bytes
//   POST /api/ai-smoke                 deploy gate, guarded by the SMOKE_TOKEN secret
//
// Every mutating route and the state poll carry `x-player-id` and
// `x-player-secret`; create is the exception (it hands them out) and so is the
// photo route (an <img> tag cannot send headers, and the bytes are a public
// internet photo). Errors are always JSON `{ error }`; an unknown room is 404.

import { newRoomCode } from '../shared/ids';
import { handleAiSmoke } from './smoke';
import type { Env } from './env';

export { RoomDO } from './room-do';
export type { Env } from './env';

/** How many room codes to try before giving up (plan: up to 5). */
const CODE_ATTEMPTS = 5;

const ROOM_CODE_RE = /^[A-Z0-9]{4}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

/** Forwards to the room's Durable Object, carrying the caller's credentials. */
function callRoom(
  env: Env,
  code: string,
  path: string,
  request: Request,
  body?: unknown
): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['x-player-id', 'x-player-secret']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init: RequestInit =
    body === undefined
      ? { method: 'GET', headers }
      : { method: 'POST', headers, body: JSON.stringify(body) };
  return roomStub(env, code).fetch(new Request(`https://room/${path}`, init));
}

async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return badRequest('body must be JSON');

  const name = typeof body.name === 'string' ? body.name : '';
  if (name.trim().length === 0) return badRequest('name is required');

  const options =
    body.options && typeof body.options === 'object'
      ? (body.options as Record<string, number>)
      : undefined;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = newRoomCode();
    const res = await roomStub(env, code).fetch(
      new Request('https://room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, options }),
      })
    );
    if (res.status === 409) continue; // that code is a live room; draw another
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return json({ error: 'could not find a free room code, please try again' }, 503);
}

async function handleRoomAction(
  request: Request,
  env: Env,
  code: string,
  action: string
): Promise<Response> {
  const body = await readJson(request);
  if (!body) return badRequest('body must be JSON');

  switch (action) {
    case 'join': {
      const name = typeof body.name === 'string' ? body.name : '';
      if (name.trim().length === 0) return badRequest('name is required');
      return callRoom(env, code, 'join', request, { name });
    }
    case 'start':
      return callRoom(env, code, 'start', request, {});
    case 'caption': {
      const text = typeof body.text === 'string' ? body.text : '';
      if (text.trim().length === 0) return badRequest('caption is required');
      return callRoom(env, code, 'caption', request, { text });
    }
    case 'vote': {
      const captionId = typeof body.captionId === 'string' ? body.captionId : '';
      if (captionId.length === 0) return badRequest('captionId is required');
      return callRoom(env, code, 'vote', request, { captionId });
    }
    case 'next':
      return callRoom(env, code, 'next', request, {});
    default:
      return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (path === '/api/ai-smoke') {
      if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
      return handleAiSmoke(request, env);
    }

    if (path === '/api/rooms') {
      if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
      return handleCreateRoom(request, env);
    }

    // /api/rooms/:code, /api/rooms/:code/:action, /api/rooms/:code/photo/:round
    const match = path.match(/^\/api\/rooms\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);
    if (match) {
      const code = decodeURIComponent(match[1]).toUpperCase();
      const action = match[2];
      const sub = match[3];
      if (!ROOM_CODE_RE.test(code)) return json({ error: 'that room is not around any more' }, 404);

      if (action === 'photo') {
        if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
        if (!sub || !/^\d+$/.test(sub)) return json({ error: 'not found' }, 404);
        return callRoom(env, code, `photo/${sub}`, request);
      }

      if (sub) return json({ error: 'not found' }, 404);

      if (!action) {
        if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
        const v = url.searchParams.get('v');
        const query = v !== null ? `?v=${encodeURIComponent(v)}` : '';
        return callRoom(env, code, `state${query}`, request);
      }

      if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
      return handleRoomAction(request, env, code, action);
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
