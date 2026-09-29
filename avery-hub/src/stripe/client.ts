// Thin Stripe REST client over fetch (no SDK), same shape as the CRM's raw
// client in crm/front-desk/src/payments/provider.ts (form-encoded bodies,
// injectable fetch), plus two things the CRM does not do:
//   1. every request pins `Stripe-Version`, so a Dashboard upgrade of the shared
//      Ownly account's default version cannot change what the hub reads;
//   2. every mutating call REQUIRES an Idempotency-Key (enforced by the type).
//
// Retries: network failures, a failed body read, timeouts, 409 (a request with
// this key is still in flight), 429 and 5xx, always with the SAME idempotency
// key so a retry can never create a second object, bounded by maxAttempts
// (STRIPE_MAX_ATTEMPTS). `Stripe-Should-Retry: false` stops a retry. Any other
// 4xx throws at once. Paths are checked so the key can only go to Stripe.
//
// This file imports nothing so the setup script can load it with plain Node.

/**
 * Stripe API version the hub is written against. Read from
 * https://docs.stripe.com/api/versioning on 2026-09-29, which says
 * "The current version is 2026-08-26.dahlia" (grade B: docs, not a live call).
 * Changing it is a reviewed code change: field shapes differ across majors
 * (for example `current_period_end` lives on subscription items since Basil).
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';
export const STRIPE_API_BASE = 'https://api.stripe.com';

/** A form value Stripe understands: scalars, nested objects, arrays. */
export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };
export type FormParams = { [k: string]: FormValue };
export type StripeObject = Record<string, unknown>;

export class StripeApiError extends Error {
  // Plain fields, not constructor parameter properties, so plain Node
  // (type stripping) can load this file for the setup script.
  readonly status: number;
  readonly type: string | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  /** Stripe's `Stripe-Should-Retry` header, when sent. */
  readonly shouldRetry: string | null;
  constructor(
    status: number,
    type: string | undefined,
    code: string | undefined,
    message: string,
    requestId: string | undefined,
    shouldRetry: string | null = null,
  ) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.requestId = requestId;
    this.shouldRetry = shouldRetry;
  }
}

export class StripeNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'StripeNetworkError';
  }
}

export class StripeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeTimeoutError';
  }
}

/** Misuse by the caller (bad path, missing idempotency key, bad config). Never retried. */
export class StripeClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeClientError';
  }
}

export interface StripeClientOptions {
  secretKey: string;
  fetch?: typeof fetch;
  apiBase?: string;
  apiVersion?: string;
  /** Total attempts including the first (config STRIPE_MAX_ATTEMPTS, default 3). */
  maxAttempts?: number;
  /** Per-attempt timeout in ms (config STRIPE_TIMEOUT_MS, default 15000). */
  timeoutMs?: number;
  /** Base backoff in ms; doubles each retry. */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const CLIENT_DEFAULTS = { maxAttempts: 3, timeoutMs: 15_000 } as const;

/** Reads STRIPE_MAX_ATTEMPTS and STRIPE_TIMEOUT_MS (strings) with validation. */
export function clientConfigFromEnv(env: Record<string, unknown>): { maxAttempts: number; timeoutMs: number } {
  const read = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(n) || n < min || n > max) throw new StripeClientError(`config ${name} must be an integer from ${min} to ${max}`);
    return n;
  };
  return {
    maxAttempts: read('STRIPE_MAX_ATTEMPTS', CLIENT_DEFAULTS.maxAttempts, 1, 10),
    timeoutMs: read('STRIPE_TIMEOUT_MS', CLIENT_DEFAULTS.timeoutMs, 100, 120_000),
  };
}

export interface StripeClient {
  get(path: string, query?: FormParams): Promise<StripeObject>;
  post(path: string, params: FormParams, opts: { idempotencyKey: string }): Promise<StripeObject>;
  /** Walks a list endpoint with `starting_after` until `has_more` is false. */
  listAll(path: string, query?: FormParams, maxPages?: number): Promise<StripeObject[]>;
}

/** Stripe's bracket encoding: a[b]=1, a[0]=x. Null and undefined are skipped. */
export function encodeForm(params: FormParams): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, v: FormValue): void => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof v === 'object') {
      for (const [k, inner] of Object.entries(v)) walk(`${prefix}[${k}]`, inner);
    } else {
      out.append(prefix, String(v));
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.toString();
}

const SAFE_PATH = /^\/v1\/[A-Za-z0-9_./-]+$/;

/** Builds the request URL and proves it still points at Stripe. Throws otherwise. */
export function buildStripeUrl(base: string, path: string): URL {
  if (!SAFE_PATH.test(path) || path.includes('//') || path.includes('..')) {
    throw new StripeClientError('refusing an unsafe Stripe API path');
  }
  const origin = new URL(base).origin;
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new StripeClientError('refusing a Stripe API path that leaves the Stripe origin');
  return url;
}

export function createStripeClient(opts: StripeClientOptions): StripeClient {
  if (!opts.secretKey) throw new StripeClientError('Stripe secret key is missing');
  const doFetch = opts.fetch ?? fetch;
  const base = new URL(opts.apiBase ?? STRIPE_API_BASE).origin;
  const version = opts.apiVersion ?? STRIPE_API_VERSION;
  const maxAttempts = opts.maxAttempts ?? CLIENT_DEFAULTS.maxAttempts;
  const timeoutMs = opts.timeoutMs ?? CLIENT_DEFAULTS.timeoutMs;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new StripeClientError('maxAttempts must be an integer >= 1');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new StripeClientError('timeoutMs must be > 0');
  const retryBaseMs = opts.retryBaseMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** One attempt, bounded by the timeout (covers the body read too). */
  async function once(method: 'GET' | 'POST', path: string, params: FormParams | undefined, key?: string): Promise<StripeObject> {
    const url = buildStripeUrl(base, path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.secretKey}`,
      'Stripe-Version': version,
    };
    let body: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (key) headers['Idempotency-Key'] = key;
      body = encodeForm(params ?? {});
    } else if (params) {
      const q = encodeForm(params);
      if (q) url.search = q;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new StripeTimeoutError(`timeout after ${timeoutMs} ms on ${method} ${path}`));
      }, timeoutMs);
    });
    const attempt = (async () => {
      let res: Response;
      try {
        res = await doFetch(url.toString(), { method, headers, signal: controller.signal, ...(body !== undefined ? { body } : {}) });
      } catch (e) {
        throw new StripeNetworkError(`network error on ${method} ${path}`, e);
      }
      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        // Stripe may have done the work; the retry reuses the idempotency key.
        throw new StripeNetworkError(`failed reading the response of ${method} ${path}`, e);
      }
      let json: StripeObject | undefined;
      try {
        json = JSON.parse(text) as StripeObject;
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const err = (json?.error ?? {}) as { type?: string; code?: string; message?: string };
        throw new StripeApiError(
          res.status,
          err.type,
          err.code,
          err.message ?? `stripe error ${res.status} on ${method} ${path}`,
          res.headers.get('Request-Id') ?? undefined,
          res.headers.get('Stripe-Should-Retry'),
        );
      }
      if (!json) throw new StripeApiError(res.status, undefined, undefined, `stripe returned non-JSON on ${path}`, undefined);
      return json;
    })();
    attempt.catch(() => {}); // the race below owns the error
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function retryable(e: unknown): boolean {
    if (e instanceof StripeNetworkError || e instanceof StripeTimeoutError) return true;
    if (e instanceof StripeApiError) {
      if (e.shouldRetry === 'false') return false;
      return e.status === 409 || e.status === 429 || e.status >= 500;
    }
    return false;
  }

  async function withRetry(method: 'GET' | 'POST', path: string, params: FormParams | undefined, key?: string): Promise<StripeObject> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(method, path, params, key);
      } catch (e) {
        if (!retryable(e) || attempt >= maxAttempts) throw e;
        await sleep(retryBaseMs * 2 ** (attempt - 1));
      }
    }
  }

  return {
    get: (path, query) => withRetry('GET', path, query),
    async post(path, params, o) {
      if (!o?.idempotencyKey) throw new StripeClientError(`idempotency key required for POST ${path}`);
      return withRetry('POST', path, params, o.idempotencyKey);
    },
    async listAll(path, query = {}, maxPages = 50) {
      const all: StripeObject[] = [];
      let after: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const res = await withRetry('GET', path, { limit: 100, ...query, ...(after ? { starting_after: after } : {}) });
        const data = (res.data ?? []) as StripeObject[];
        all.push(...data);
        if (!res.has_more || data.length === 0) return all;
        after = String(data[data.length - 1]!.id);
      }
      throw new StripeClientError(`listAll ${path} exceeded ${maxPages} pages`);
    },
  };
}
