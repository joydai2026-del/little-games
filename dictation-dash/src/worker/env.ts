import type { AiRunner, TtsConfig } from './tts';

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  /** Workers AI, for the word speech. */
  AI?: AiRunner;
  /** Caps room creation per IP. Policy in wrangler.jsonc `ratelimits`. */
  ROOM_CREATE_LIMITER?: RateLimit;
  /** Caps paid speech calls per IP. Policy in wrangler.jsonc `ratelimits`. Missing = speech OFF (fail closed). */
  TTS_LIMITER?: RateLimit;
  /** One global counter of paid speech calls per UTC day (BudgetDO). Missing = speech OFF. */
  BUDGET?: DurableObjectNamespace;
  /** Paid speech calls one room may make per UTC day. */
  TTS_ROOM_DAILY_CALLS?: string;
  /** Paid speech calls the whole game may make per UTC day. */
  TTS_GLOBAL_DAILY_CALLS?: string;
  /** Paid speech calls one IP may make per UTC day (below the global cap, so one IP cannot switch speech off for everyone). */
  TTS_IP_DAILY_CALLS?: string;
  /** Seconds browsers and the edge keep one character's stroke JSON. */
  STROKE_CACHE_SECONDS?: string;
  /** Largest upstream stroke JSON accepted, in bytes (largest real file is 8,621). */
  STROKE_MAX_BYTES?: string;
  /** Deadline on one upstream stroke fetch. */
  STROKE_FETCH_TIMEOUT_MS?: string;
  /** Speech model id and settings (policy, not code). */
  TTS_MODEL?: string;
  TTS_LANG?: string;
  TTS_MAX_ATTEMPTS?: string;
  TTS_CACHE_SECONDS?: string;
  TTS_MAX_BYTES?: string;
}

export function numberVar(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Safe defaults; wrangler.jsonc `vars` override every one. */
export function ttsConfig(env: Env): TtsConfig {
  return {
    model: env.TTS_MODEL?.trim() || '@cf/myshell-ai/melotts',
    lang: env.TTS_LANG?.trim() || 'zh',
    maxAttempts: numberVar(env.TTS_MAX_ATTEMPTS, 3, 1, 5),
    retryDelaysMs: [150, 400],
    cacheSeconds: numberVar(env.TTS_CACHE_SECONDS, 86_400, 0, 31_536_000),
    maxBytes: numberVar(env.TTS_MAX_BYTES, 1_048_576, 16_384, 8_388_608),
  };
}

export function budgetConfig(env: Env): { roomDaily: number; globalDaily: number; ipDaily: number } {
  return {
    roomDaily: numberVar(env.TTS_ROOM_DAILY_CALLS, 150, 0, 100_000),
    globalDaily: numberVar(env.TTS_GLOBAL_DAILY_CALLS, 3000, 0, 10_000_000),
    ipDaily: numberVar(env.TTS_IP_DAILY_CALLS, 400, 0, 10_000_000),
  };
}

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
