export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  /** Caps room creation per IP. Policy in wrangler.jsonc `ratelimits`. */
  ROOM_CREATE_LIMITER?: RateLimit;
  /** Caps joins per IP (a classroom shares one IP, so the policy is generous). Policy in wrangler.jsonc `ratelimits`. */
  JOIN_LIMITER?: RateLimit;
  /** Seconds browsers and the edge keep one character's stroke JSON. */
  STROKE_CACHE_SECONDS?: string;
  /** Largest upstream stroke JSON accepted, in bytes (largest real file is 8,621). */
  STROKE_MAX_BYTES?: string;
  /** Deadline on one upstream stroke fetch. */
  STROKE_FETCH_TIMEOUT_MS?: string;
}

export function numberVar(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
