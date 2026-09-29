// Thin Stripe REST client over fetch (no SDK), same shape as the CRM's raw
// client in crm/front-desk/src/payments/provider.ts (form-encoded bodies,
// injectable fetch), plus two things the CRM does not do:
//   1. every request pins `Stripe-Version`, so a Dashboard upgrade of the shared
//      Ownly account's default version cannot change what the hub reads;
//   2. every mutating call REQUIRES an Idempotency-Key (enforced by the type).
//
// Retries: only on HTTP 409 (Stripe's "a request with this key is still in
// flight") or a network failure, and always with the SAME idempotency key, so a
// retry can never create a second object. Everything else throws at once.
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
  constructor(status: number, type: string | undefined, code: string | undefined, message: string, requestId: string | undefined) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.requestId = requestId;
  }
}

export class StripeNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'StripeNetworkError';
  }
}

export interface StripeClientOptions {
  secretKey: string;
  fetch?: typeof fetch;
  apiBase?: string;
  apiVersion?: string;
  /** Extra attempts after the first, only for 409 or network errors. */
  maxRetries?: number;
  /** Base backoff in ms; doubles each retry. */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
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

export function createStripeClient(opts: StripeClientOptions): StripeClient {
  if (!opts.secretKey) throw new Error('Stripe secret key is missing');
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.apiBase ?? STRIPE_API_BASE).replace(/\/+$/, '');
  const version = opts.apiVersion ?? STRIPE_API_VERSION;
  const maxRetries = opts.maxRetries ?? 2;
  const retryBaseMs = opts.retryBaseMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function once(method: 'GET' | 'POST', path: string, params: FormParams | undefined, key?: string): Promise<StripeObject> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.secretKey}`,
      'Stripe-Version': version,
    };
    let url = `${base}${path}`;
    let body: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (key) headers['Idempotency-Key'] = key;
      body = encodeForm(params ?? {});
    } else if (params) {
      const q = encodeForm(params);
      if (q) url += `?${q}`;
    }
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, ...(body !== undefined ? { body } : {}) });
    } catch (e) {
      throw new StripeNetworkError(`network error on ${method} ${path}`, e);
    }
    const text = await res.text();
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
      );
    }
    if (!json) throw new StripeApiError(res.status, undefined, undefined, `stripe returned non-JSON on ${path}`, undefined);
    return json;
  }

  async function withRetry(method: 'GET' | 'POST', path: string, params: FormParams | undefined, key?: string): Promise<StripeObject> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(method, path, params, key);
      } catch (e) {
        const retryable = e instanceof StripeNetworkError || (e instanceof StripeApiError && e.status === 409);
        if (!retryable || attempt >= maxRetries) throw e;
        await sleep(retryBaseMs * 2 ** attempt);
      }
    }
  }

  return {
    get: (path, query) => withRetry('GET', path, query),
    post: (path, params, o) => {
      if (!o?.idempotencyKey) throw new Error(`idempotency key required for POST ${path}`);
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
      throw new Error(`listAll ${path} exceeded ${maxPages} pages`);
    },
  };
}
