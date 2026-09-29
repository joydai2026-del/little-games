// Everything the hub Worker is bound to. Vars come from wrangler.jsonc; the
// secrets (names only here) are set by JJ with `wrangler secret put`.
import type { TokenDO } from './do/token-do';
import type { BillingDO } from './do/billing-do';

export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  TOKENS: DurableObjectNamespace<TokenDO>;
  BILLING: DurableObjectNamespace<BillingDO>;
  ASSETS?: Fetcher;
  AUTH_START_LIMITER?: RateLimiter;
  REDEEM_LIMITER?: RateLimiter;

  // Secrets (never in config).
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_HASH_KEY_V1?: string;
  SESSION_HASH_KEY_V2?: string;

  // Vars: strings, except GAME_REGISTRY which may arrive as an object.
  [key: string]: unknown;
}
