import type { AiRunner, TtsConfig } from './tts';

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  /** Workers AI, for the word speech. */
  AI?: AiRunner;
  /** Caps room creation per IP. Policy in wrangler.jsonc `ratelimits`. */
  ROOM_CREATE_LIMITER?: RateLimit;
  /** Caps speech cache MISSES (paid calls) per IP. Policy in wrangler.jsonc `ratelimits`. */
  TTS_LIMITER?: RateLimit;
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
