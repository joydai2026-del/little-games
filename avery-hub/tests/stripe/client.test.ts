import { describe, expect, it } from 'vitest';
import {
  STRIPE_API_VERSION,
  StripeApiError,
  StripeClientError,
  StripeNetworkError,
  StripeTimeoutError,
  buildStripeUrl,
  clientConfigFromEnv,
  createStripeClient,
  encodeForm,
} from '../../src/stripe/client';

interface Call { url: string; method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal | null }
type Step = (() => Response) | Error | 'hang' | 'bad-body';

function recorder(responses: Step[]) {
  const calls: Call[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      signal: init?.signal ?? null,
    });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    if (next instanceof Error) throw next;
    if (next === 'hang') return new Promise<Response>(() => {}); // never settles, ignores the signal
    if (next === 'bad-body') {
      return { ok: true, status: 200, headers: new Headers(), text: async () => { throw new TypeError('stream reset'); } } as unknown as Response;
    }
    return next();
  }) as typeof fetch;
  return { calls, fakeFetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_1', ...headers } });

const sleeps: number[] = [];
const noSleep = async (ms: number) => {
  sleeps.push(ms);
};
const client = (fakeFetch: typeof fetch, extra: Partial<Parameters<typeof createStripeClient>[0]> = {}) =>
  createStripeClient({ secretKey: 'rk_test_x', fetch: fakeFetch, sleep: noSleep, ...extra });

describe('encodeForm', () => {
  it('uses Stripe bracket encoding for nested objects and arrays, skipping null', () => {
    const s = encodeForm({ a: 1, metadata: { app: 'avery' }, enabled_events: ['x', 'y'], gone: null, flag: false });
    expect(decodeURIComponent(s)).toBe('a=1&metadata[app]=avery&enabled_events[0]=x&enabled_events[1]=y&flag=false');
  });
});

describe('path safety (the key only ever goes to Stripe)', () => {
  for (const bad of ['@attacker.example/collect', '/v1@attacker.example/collect', '//evil.example/v1/x', '/v1/../v2/x', '/v1/charges?limit=1', '/v1/charges#x', 'v1/charges', '/v2/x', 'https://evil.example/v1/x']) {
    it(`refuses ${JSON.stringify(bad)} without calling fetch`, async () => {
      const { calls, fakeFetch } = recorder([json(200, {})]);
      await expect(client(fakeFetch).get(bad)).rejects.toBeInstanceOf(StripeClientError);
      await expect(client(fakeFetch).post(bad, {}, { idempotencyKey: 'k' })).rejects.toBeInstanceOf(StripeClientError);
      expect(calls).toHaveLength(0);
    });
  }

  it('accepts normal paths and keeps the Stripe origin', () => {
    expect(buildStripeUrl('https://api.stripe.com', '/v1/charges/ch_123').toString()).toBe('https://api.stripe.com/v1/charges/ch_123');
    expect(buildStripeUrl('https://api.stripe.com', '/v1/billing_portal/configurations').origin).toBe('https://api.stripe.com');
  });
});

describe('createStripeClient', () => {
  it('pins Stripe-Version, sends bearer auth and form body with the idempotency key', async () => {
    const { calls, fakeFetch } = recorder([json(200, { id: 'prod_1' })]);
    const r = await client(fakeFetch).post('/v1/products', { name: 'N', metadata: { app: 'avery' } }, { idempotencyKey: 'k1' });
    expect(r.id).toBe('prod_1');
    expect(STRIPE_API_VERSION).toBe('2026-08-26.dahlia');
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/products');
    expect(calls[0]!.headers['Stripe-Version']).toBe(STRIPE_API_VERSION);
    expect(calls[0]!.headers['Idempotency-Key']).toBe('k1');
    expect(calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0]!.headers.Authorization).toBe('Bearer rk_test_x');
    expect(decodeURIComponent(calls[0]!.body!)).toBe('name=N&metadata[app]=avery');
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('a POST without an idempotency key returns a rejected promise, never a sync throw', async () => {
    const { calls, fakeFetch } = recorder([]);
    let p: Promise<unknown> | undefined;
    expect(() => {
      p = client(fakeFetch).post('/v1/products', {}, { idempotencyKey: '' });
    }).not.toThrow();
    await expect(p).rejects.toBeInstanceOf(StripeClientError);
    expect(calls).toHaveLength(0);
  });

  it('GET puts params in the query string and sends no idempotency key', async () => {
    const { calls, fakeFetch } = recorder([json(200, { id: 'ch_1' })]);
    await client(fakeFetch).get('/v1/prices', { lookup_keys: ['avery_yearly_v1'] });
    expect(decodeURIComponent(calls[0]!.url)).toBe('https://api.stripe.com/v1/prices?lookup_keys[0]=avery_yearly_v1');
    expect(calls[0]!.headers['Idempotency-Key']).toBeUndefined();
  });

  const retryCases: Array<[string, Step]> = [
    ['409', json(409, { error: { type: 'idempotency_error', message: 'in flight' } })],
    ['429', json(429, { error: { type: 'rate_limit_error', message: 'slow down' } })],
    ['500', json(500, { error: { type: 'api_error', message: 'oops' } })],
    ['503', json(503, { error: { type: 'api_error', message: 'oops' } })],
    ['network error', new TypeError('boom')],
    ['body read failure', 'bad-body'],
  ];
  for (const [name, first] of retryCases) {
    it(`retries ${name} with the SAME idempotency key, then succeeds`, async () => {
      const { calls, fakeFetch } = recorder([first, json(200, { id: 're_1' })]);
      const r = await client(fakeFetch).post('/v1/refunds', { charge: 'ch_1' }, { idempotencyKey: 'refund:ch_1:op1' });
      expect(r.id).toBe('re_1');
      expect(calls.map((c) => c.headers['Idempotency-Key'])).toEqual(['refund:ch_1:op1', 'refund:ch_1:op1']);
    });
  }

  it('gives up after STRIPE_MAX_ATTEMPTS (default 3) with exponential backoff', async () => {
    sleeps.length = 0;
    const { calls, fakeFetch } = recorder([new TypeError('a'), new TypeError('b'), new TypeError('c'), new TypeError('d')]);
    await expect(client(fakeFetch, { retryBaseMs: 100 }).post('/v1/refunds', {}, { idempotencyKey: 'k' })).rejects.toBeInstanceOf(StripeNetworkError);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
    expect(new Set(calls.map((c) => c.headers['Idempotency-Key']))).toEqual(new Set(['k']));
  });

  it('maxAttempts is configurable', async () => {
    const { calls, fakeFetch } = recorder([json(500, {}), json(500, {}), json(500, {}), json(500, {}), json(500, {})]);
    await expect(client(fakeFetch, { maxAttempts: 5 }).get('/v1/charges/ch_1')).rejects.toBeInstanceOf(StripeApiError);
    expect(calls).toHaveLength(5);
  });

  for (const status of [400, 401, 402, 403, 404]) {
    it(`never retries a ${status}; throws a typed error with code and request id`, async () => {
      const { calls, fakeFetch } = recorder([json(status, { error: { type: 'card_error', code: 'card_declined', message: 'no' } })]);
      const err = await client(fakeFetch).post('/v1/x', {}, { idempotencyKey: 'k' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StripeApiError);
      expect((err as StripeApiError).status).toBe(status);
      expect((err as StripeApiError).code).toBe('card_declined');
      expect((err as StripeApiError).requestId).toBe('req_1');
      expect(calls).toHaveLength(1);
    });
  }

  it('Stripe-Should-Retry: false stops a retry even on a 500', async () => {
    const { calls, fakeFetch } = recorder([json(500, {}, { 'Stripe-Should-Retry': 'false' }), json(200, {})]);
    await expect(client(fakeFetch).get('/v1/charges/ch_1')).rejects.toBeInstanceOf(StripeApiError);
    expect(calls).toHaveLength(1);
  });

  it('a hung fetch times out, retries once, then throws a typed timeout error', async () => {
    const { calls, fakeFetch } = recorder(['hang', 'hang']);
    const c = client(fakeFetch, { timeoutMs: 20, maxAttempts: 2 });
    await expect(c.post('/v1/refunds', {}, { idempotencyKey: 'k' })).rejects.toBeInstanceOf(StripeTimeoutError);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
    expect(calls.map((c) => c.headers['Idempotency-Key'])).toEqual(['k', 'k']);
  });

  it('a timeout followed by success returns the result', async () => {
    const { fakeFetch } = recorder(['hang', json(200, { id: 'x' })]);
    expect((await client(fakeFetch, { timeoutMs: 20 }).get('/v1/charges/ch_1')).id).toBe('x');
  });

  it('listAll follows starting_after until has_more is false', async () => {
    const { calls, fakeFetch } = recorder([
      json(200, { data: [{ id: 'a' }, { id: 'b' }], has_more: true }),
      json(200, { data: [{ id: 'c' }], has_more: false }),
    ]);
    const all = await client(fakeFetch).listAll('/v1/products');
    expect(all.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(calls[1]!.url).toContain('starting_after=b');
  });

  it('listAll stops at maxPages', async () => {
    const { fakeFetch } = recorder([json(200, { data: [{ id: 'a' }], has_more: true }), json(200, { data: [{ id: 'b' }], has_more: true })]);
    await expect(client(fakeFetch).listAll('/v1/products', {}, 2)).rejects.toThrow(/exceeded 2 pages/);
  });

  it('refuses to build without a key or with bad limits', () => {
    expect(() => createStripeClient({ secretKey: '' })).toThrow(StripeClientError);
    expect(() => createStripeClient({ secretKey: 'rk_test_x', maxAttempts: 0 })).toThrow(StripeClientError);
    expect(() => createStripeClient({ secretKey: 'rk_test_x', timeoutMs: Number.NaN })).toThrow(StripeClientError);
  });
});

describe('clientConfigFromEnv', () => {
  it('defaults to 3 attempts and 15000 ms', () => {
    expect(clientConfigFromEnv({})).toEqual({ maxAttempts: 3, timeoutMs: 15000 });
  });
  it('parses the string vars', () => {
    expect(clientConfigFromEnv({ STRIPE_MAX_ATTEMPTS: '5', STRIPE_TIMEOUT_MS: '8000' })).toEqual({ maxAttempts: 5, timeoutMs: 8000 });
  });
  it('refuses bad values', () => {
    for (const env of [{ STRIPE_MAX_ATTEMPTS: '0' }, { STRIPE_MAX_ATTEMPTS: 'three' }, { STRIPE_TIMEOUT_MS: '-5' }, { STRIPE_TIMEOUT_MS: '1.5' }]) {
      expect(() => clientConfigFromEnv(env), JSON.stringify(env)).toThrow(StripeClientError);
    }
  });
});
