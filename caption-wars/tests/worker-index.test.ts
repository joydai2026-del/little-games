// POST /api/rooms: the only unauthenticated endpoint that CREATES anything.
//
// Review round 8, should-fix 4. Every call makes a Durable Object, writes three
// storage keys and arms a 2-hour alarm, and the URL is public. `grep -rniE
// "rate.?limit|throttle|Retry-After|429" src/worker/ src/shared/` returned
// nothing before this round. Free on the current plan, billed on Workers Paid,
// which is the plan rule 55 itself recommends, so the cap goes in while it is
// cheap. The numbers are in wrangler.jsonc; this file pins the BEHAVIOUR.

import { describe, expect, it } from 'vitest';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/env';

/** A fake room Durable Object that always accepts a create. */
function fakeRooms(created: string[]) {
  return {
    idFromName: (name: string) => name,
    get: (_id: unknown) => ({
      async fetch(req: Request) {
        const body = (await req.json()) as { code?: string };
        created.push(body.code ?? '');
        return new Response(JSON.stringify({ ok: true, code: body.code }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }),
  };
}

function envWith(limiter?: Env['ROOM_CREATE_LIMITER']) {
  const created: string[] = [];
  const env = { ROOMS: fakeRooms(created), ROOM_CREATE_LIMITER: limiter } as unknown as Env;
  return { env, created };
}

function createRequest(ip: string | null = '203.0.113.7'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ip !== null) headers['CF-Connecting-IP'] = ip;
  return new Request('https://example.test/api/rooms', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'JJ', options: { rounds: 2, botCount: 0 } }),
  });
}

describe('POST /api/rooms rate limit', () => {
  it('answers 429 with Retry-After and creates NOTHING when the caller is over', async () => {
    const keys: string[] = [];
    const { env, created } = envWith({
      async limit({ key }) {
        keys.push(key);
        return { success: false };
      },
    });

    const res = await worker.fetch(createRequest(), env);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    // The Durable Object was never touched, which is the whole point: the cost
    // is the DO, not the response.
    expect(created).toEqual([]);
    // Limited per client IP, not globally.
    expect(keys).toEqual(['203.0.113.7']);
    // Plain language, no jargon (the client turns this into a sentence).
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/wait a moment/);
    expect(body.error).not.toMatch(/rate limit|429|IP/i);
  });

  it('lets a normal caller straight through', async () => {
    const { env, created } = envWith({ async limit() { return { success: true }; } });
    const res = await worker.fetch(createRequest(), env);
    expect(res.status).toBe(200);
    expect(created).toHaveLength(1);
  });

  it('falls back to one shared bucket when there is no CF-Connecting-IP', async () => {
    const keys: string[] = [];
    const { env } = envWith({
      async limit({ key }) {
        keys.push(key);
        return { success: true };
      },
    });
    await worker.fetch(createRequest(null), env);
    expect(keys).toEqual(['no-connecting-ip']);
  });

  it('a limiter that throws does not take room creation down with it', async () => {
    const { env, created } = envWith({
      async limit() {
        throw new Error('rate limiter unavailable');
      },
    });
    const res = await worker.fetch(createRequest(), env);
    expect(res.status).toBe(200);
    expect(created).toHaveLength(1);
  });

  it('works with no limiter binding at all', async () => {
    const { env, created } = envWith(undefined);
    const res = await worker.fetch(createRequest(), env);
    expect(res.status).toBe(200);
    expect(created).toHaveLength(1);
  });
});

describe('start and next accept an empty body (2026-09-08, the first API-only game got 400)', () => {
  /** A fake room DO that records which action the worker forwarded. */
  function recordingEnv() {
    const actions: string[] = [];
    const env = {
      ROOMS: {
        idFromName: (name: string) => name,
        get: () => ({
          async fetch(req: Request) {
            actions.push(new URL(req.url).pathname.replace(/^\//, ''));
            return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          },
        }),
      },
    } as unknown as Env;
    return { env, actions };
  }
  const headers = { 'x-player-id': 'p1', 'x-player-secret': 's1' };

  it.each(['start', 'next'])('POST /%s with no body reaches the room', async (action) => {
    const { env, actions } = recordingEnv();
    const res = await worker.fetch(
      new Request(`https://example.test/api/rooms/ABCD/${action}`, { method: 'POST', headers }),
      env
    );
    expect(res.status).toBe(200);
    expect(actions).toEqual([action]);
  });

  it.each(['null', '"x"', '[1]', '{bad', ' ', '\t\n'])('start with malformed body %s is still refused', async (raw) => {
    const { env, actions } = recordingEnv();
    const res = await worker.fetch(
      new Request('https://example.test/api/rooms/ABCD/start', { method: 'POST', headers, body: raw }),
      env
    );
    expect(res.status).toBe(400);
    expect(actions).toEqual([]);
  });

  it('caption with no body is still refused before it reaches the room', async () => {
    const { env, actions } = recordingEnv();
    const res = await worker.fetch(
      new Request('https://example.test/api/rooms/ABCD/caption', { method: 'POST', headers }),
      env
    );
    expect(res.status).toBe(400);
    expect(actions).toEqual([]);
  });
});
