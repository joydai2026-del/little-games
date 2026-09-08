// The one thing in src/client/api.ts that is not a thin wrapper: the deadline
// on every request.
//
// Why it has its own file: nothing in the browser used to bound a fetch, and a
// fetch that never settles is worse than an error. The poll loop's `catch` never
// runs, so it never retries and never reschedules: the countdown ticks to zero
// and the phone sits there for ever with no message. A tapped Send / Vote /
// Start stays disabled just as long. These tests drive the real function with an
// injected fetch, so they need no DOM and no network.

import { describe, expect, it } from 'vitest';
import { ApiError, requestWithTimeout } from '../src/client/api';
import { ACTION_TIMEOUT_MS, POLL_TIMEOUT_MS } from '../src/shared/config';

/** A fetch that accepts the request and then says nothing, ever (the wifi-to-dead-cell shape). */
function stalledFetch(seen: Array<AbortSignal | undefined>): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.signal ?? undefined);
    return new Promise<Response>(() => {
      // never settles, and deliberately ignores the signal: the deadline must
      // not depend on the fetch implementation being polite.
    });
  }) as typeof fetch;
}

describe('requestWithTimeout', () => {
  it('gives up on a request that never settles, as a plain no-connection error', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const started = Date.now();

    const failure = await requestWithTimeout('/api/rooms/ABCD', { method: 'GET' }, 30, stalledFetch(signals))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    // Status 0 is the existing "no connection" case, on purpose: the poll loop
    // already retries it with backoff and every action button already comes
    // back on it. A timeout needs no new handling anywhere.
    expect((failure as ApiError).status).toBe(0);
    expect((failure as ApiError).message).toMatch(/No connection/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('aborts the real request rather than just walking away from it', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    await requestWithTimeout('/api/rooms/ABCD', { method: 'GET' }, 30, stalledFetch(signals)).catch(
      () => null
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('maps a dead network to the same error, so both look the same to a caller', async () => {
    const dead = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;

    const failure = await requestWithTimeout('/api/rooms/ABCD', {}, 1_000, dead)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
  });

  it('passes a normal reply straight through, headers-time stamped', async () => {
    const before = Date.now();
    const ok = (() =>
      Promise.resolve(new Response('{"hello":true}', { status: 200 }))) as unknown as typeof fetch;

    const reply = await requestWithTimeout('/api/rooms/ABCD', {}, 1_000, ok);

    expect(reply.ok).toBe(true);
    expect(reply.status).toBe(200);
    expect(reply.text).toBe('{"hello":true}');
    expect(reply.arrivedAt).toBeGreaterThanOrEqual(before);
  });

  it('does not swallow an HTTP error: that is the caller\'s to read', async () => {
    const gone = (() =>
      Promise.resolve(
        new Response('{"error":"that room is not around any more"}', { status: 404 })
      )) as unknown as typeof fetch;

    const reply = await requestWithTimeout('/api/rooms/ABCD', {}, 1_000, gone);

    expect(reply.ok).toBe(false);
    expect(reply.status).toBe(404);
  });

  it('ships deadlines that are policy, and a poll gives up sooner than an action', () => {
    // A missed poll costs nothing (the next one is seconds away). An action is
    // something the player typed and would have to redo, so it gets longer.
    expect(POLL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ACTION_TIMEOUT_MS).toBeGreaterThan(POLL_TIMEOUT_MS);
  });
});
