import { describe, expect, it } from 'vitest';
import {
  STRIPE_API_VERSION,
  StripeApiError,
  StripeNetworkError,
  createStripeClient,
  encodeForm,
} from '../../src/stripe/client';

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

function recorder(responses: Array<(() => Response) | Error>) {
  const calls: Call[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    if (next instanceof Error) throw next;
    return next();
  }) as typeof fetch;
  return { calls, fakeFetch };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_1' } });

const noSleep = async () => {};

describe('encodeForm', () => {
  it('uses Stripe bracket encoding for nested objects and arrays, skipping null', () => {
    const s = encodeForm({ a: 1, metadata: { app: 'avery' }, enabled_events: ['x', 'y'], gone: null, flag: false });
    expect(decodeURIComponent(s)).toBe('a=1&metadata[app]=avery&enabled_events[0]=x&enabled_events[1]=y&flag=false');
  });
});

describe('createStripeClient', () => {
  it('pins Stripe-Version, sends bearer auth and form body with the idempotency key', async () => {
    const { calls, fakeFetch } = recorder([json(200, { id: 'prod_1' })]);
    const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch, sleep: noSleep });
    const r = await c.post('/v1/products', { name: 'N', metadata: { app: 'avery' } }, { idempotencyKey: 'k1' });
    expect(r.id).toBe('prod_1');
    expect(STRIPE_API_VERSION).toBe('2026-08-26.dahlia');
    expect(calls[0]!.headers['Stripe-Version']).toBe(STRIPE_API_VERSION);
    expect(calls[0]!.headers['Idempotency-Key']).toBe('k1');
    expect(calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0]!.headers.Authorization).toBe('Bearer rk_test_x');
    expect(decodeURIComponent(calls[0]!.body!)).toBe('name=N&metadata[app]=avery');
  });

  it('refuses a POST without an idempotency key', () => {
    const { fakeFetch } = recorder([]);
    const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch });
    expect(() => c.post('/v1/products', {}, { idempotencyKey: '' })).toThrow(/idempotency key required/);
  });

  it('GET puts params in the query string and sends no idempotency key', async () => {
    const { calls, fakeFetch } = recorder([json(200, { id: 'ch_1' })]);
    const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch });
    await c.get('/v1/prices', { lookup_keys: ['avery_yearly_v1'] });
    expect(decodeURIComponent(calls[0]!.url)).toBe('https://api.stripe.com/v1/prices?lookup_keys[0]=avery_yearly_v1');
    expect(calls[0]!.headers['Idempotency-Key']).toBeUndefined();
  });

  it('retries a 409 with the SAME idempotency key, then succeeds', async () => {
    const { calls, fakeFetch } = recorder([json(409, { error: { type: 'idempotency_error', message: 'in flight' } }), json(200, { id: 'x' })]);
    const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch, sleep: noSleep });
    await c.post('/v1/refunds', { charge: 'ch_1' }, { idempotencyKey: 'refund:ch_1:op1' });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.headers['Idempotency-Key'])).toEqual(['refund:ch_1:op1', 'refund:ch_1:op1']);
  });

  it('retries a network error with the same key, and gives up after maxRetries', async () => {
    const { calls, fakeFetch } = recorder([new TypeError('boom'), new TypeError('boom'), new TypeError('boom')]);
    const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch, sleep: noSleep, maxRetries: 2 });
    await expect(c.post('/v1/refunds', {}, { idempotencyKey: 'k' })).rejects.toBeInstanceOf(StripeNetworkError);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.headers['Idempotency-Key']))).toEqual(new Set(['k']));
  });

  it('does not retry a 400, 402 or 500; throws a typed error with code and request id', async () => {
    for (const status of [400, 402, 500]) {
      const { calls, fakeFetch } = recorder([json(status, { error: { type: 'card_error', code: 'card_declined', message: 'no' } })]);
      const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch, sleep: noSleep });
      const err = await c.post('/v1/x', {}, { idempotencyKey: 'k' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StripeApiError);
      expect((err as StripeApiError).status).toBe(status);
      expect((err as StripeApiError).code).toBe('card_declined');
      expect((err as StripeApiError).requestId).toBe('req_1');
      expect(calls).toHaveLength(1);
    }
  });

  it('listAll follows starting_after until has_more is false', async () => {
    const { calls, fakeFetch } = recorder([
      json(200, { data: [{ id: 'a' }, { id: 'b' }], has_more: true }),
      json(200, { data: [{ id: 'c' }], has_more: false }),
    ]);
    const c = createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch });
    const all = await c.listAll('/v1/products');
    expect(all.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(calls[1]!.url).toContain('starting_after=b');
  });

  it('refuses to build without a key', () => {
    expect(() => createStripeClient({ secretKey: '' })).toThrow(/missing/);
  });
});
