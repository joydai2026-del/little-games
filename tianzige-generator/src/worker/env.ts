export interface Env {
  ASSETS: Fetcher;
  /** How long browsers and the edge may cache one character's stroke data. */
  STROKES_CACHE_SECONDS?: string;
  /** Largest upstream stroke file we accept, in bytes. */
  STROKES_MAX_BYTES?: string;
  /** How long a "no stroke data for this character" 404 may be cached. */
  NEGATIVE_CACHE_SECONDS?: string;
  /** Largest POST /api/sheet body accepted, in bytes. */
  SHEET_MAX_BODY_BYTES?: string;
  /** Retry-After on a rate-limited sheet request; match the limiter's period. */
  SHEET_RETRY_AFTER_SECONDS?: string;
  /** Optional per-IP cap on POST /api/sheet (each call fans out to the stroke source). */
  SHEET_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export const DEFAULT_CACHE_SECONDS = 604800;
export const DEFAULT_MAX_BYTES = 65536;
export const DEFAULT_NEGATIVE_CACHE_SECONDS = 86400;
export const DEFAULT_SHEET_MAX_BODY_BYTES = 32768;
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

function positive(value: string | undefined, fallback: number, allowZero = false): number {
  const n = Number(value);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) && value !== undefined && value !== '' ? Math.floor(n) : fallback;
}

export const maxBytes = (env: Env) => positive(env.STROKES_MAX_BYTES, DEFAULT_MAX_BYTES);
export const negativeCacheSeconds = (env: Env) => positive(env.NEGATIVE_CACHE_SECONDS, DEFAULT_NEGATIVE_CACHE_SECONDS, true);
export const sheetMaxBodyBytes = (env: Env) => positive(env.SHEET_MAX_BODY_BYTES, DEFAULT_SHEET_MAX_BODY_BYTES);
export const retryAfterSeconds = (env: Env) => positive(env.SHEET_RETRY_AFTER_SECONDS, DEFAULT_RETRY_AFTER_SECONDS);

/** Read a body stream, giving up as soon as it passes `limit` bytes. Null when too large. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function cacheSeconds(env: Env): number {
  const n = Number(env.STROKES_CACHE_SECONDS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CACHE_SECONDS;
}
