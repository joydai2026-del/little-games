export interface Env {
  ASSETS: Fetcher;
  /** How long browsers and the edge may cache one character's stroke data. */
  STROKES_CACHE_SECONDS?: string;
  /** Largest upstream stroke file we accept, in bytes. */
  STROKES_MAX_BYTES?: string;
  /** Optional per-IP cap on POST /api/sheet (each call fans out to the stroke source). */
  SHEET_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export const DEFAULT_CACHE_SECONDS = 604800;
export const DEFAULT_MAX_BYTES = 65536;

export function maxBytes(env: Env): number {
  const n = Number(env.STROKES_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES;
}

export function cacheSeconds(env: Env): number {
  const n = Number(env.STROKES_CACHE_SECONDS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CACHE_SECONDS;
}
