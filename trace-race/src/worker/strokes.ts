// Stroke data: which characters we can trace, how many strokes each has, and
// the /api/strokes/:char proxy the tracer loads from.
//
// SECURITY (two-round scan, 2026-09-28, verdict WARN with required mitigations):
//   - The upstream is PINNED here, not configurable: hanzi-writer-data@2.0.1 on
//     jsDelivr. The manifest below holds the sha256 of every one of its 9574
//     files, so the pin and the hashes cannot drift apart.
//   - The proxy is NOT an open proxy. It accepts exactly one code point that is
//     a key in the manifest, and 400s everything else.
//   - Every upstream body is hashed and compared with the manifest before a
//     byte of it is returned. A mismatch is a 502, never a pass-through.
//   - Responses are application/json with X-Content-Type-Options: nosniff.
// Stroke data licence: Make Me a Hanzi / Arphic Technology, Arphic Public License.

import manifestJson from './strokes-manifest.json';
import countsJson from './stroke-counts.json';
import { parseCharList } from '../shared/parse';
import { GAME } from '../shared/config';
import type { CharList } from '../shared/types';
import { numberVar, type Env } from './env';

export const STROKE_DATA_VERSION = '2.0.1';
const UPSTREAM = `https://cdn.jsdelivr.net/npm/hanzi-writer-data@${STROKE_DATA_VERSION}/`;

const HASHES = (manifestJson as { files: Record<string, string> }).files;
const COUNTS = countsJson as Record<string, number>;

export function strokeCount(ch: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(COUNTS, ch) ? COUNTS[ch] : undefined;
}

export function hasStrokeData(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(HASHES, ch);
}

/** Parse a paste and split it into traceable characters and ones with no stroke data. */
export function resolveList(text: string): CharList {
  const parsed = parseCharList(text, Number.MAX_SAFE_INTEGER);
  const traceable: string[] = [];
  const missing: string[] = [];
  for (const ch of parsed.chars) (hasStrokeData(ch) && strokeCount(ch) ? traceable : missing).push(ch);
  const chars = traceable.slice(0, GAME.maxListChars);
  const strokeCounts: Record<string, number> = {};
  for (const ch of chars) strokeCounts[ch] = strokeCount(ch)!;
  return {
    chars,
    missing,
    strokeCounts,
    repeats: parsed.repeats,
    overflow: traceable.slice(GAME.maxListChars),
  };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decodes the route segment; returns the single manifest character or null. */
export function strokeCharFromPath(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (decoded.endsWith('.json')) decoded = decoded.slice(0, -5);
  if ([...decoded].length !== 1) return null;
  return hasStrokeData(decoded) ? decoded : null;
}

export interface StrokeDeps {
  fetch: typeof fetch;
  cache?: Cache | null;
}

export async function handleStrokes(
  segment: string,
  env: Env,
  request: Request,
  deps: StrokeDeps
): Promise<Response> {
  const ch = strokeCharFromPath(segment);
  if (!ch) return jsonError('no stroke data for that', 400);

  const maxAge = numberVar(env.STROKE_CACHE_SECONDS, 2_592_000, 0, 31_536_000);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${maxAge}, immutable`,
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  };
  const cacheKey = new Request(new URL(`/api/strokes/${encodeURIComponent(ch)}`, request.url).toString());
  if (deps.cache) {
    const hit = await deps.cache.match(cacheKey);
    if (hit) return hit;
  }

  const timeoutMs = numberVar(env.STROKE_FETCH_TIMEOUT_MS, 6000, 500, 30_000);
  let body: ArrayBuffer;
  try {
    const upstream = await deps.fetch(`${UPSTREAM}${encodeURIComponent(ch)}.json`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!upstream.ok) return jsonError('stroke data is not reachable right now', 502);
    body = await upstream.arrayBuffer();
  } catch {
    return jsonError('stroke data is not reachable right now', 502);
  }
  if ((await sha256Hex(body)) !== HASHES[ch]) {
    console.warn('strokes: upstream hash mismatch', ch);
    return jsonError('stroke data did not match what we expected', 502);
  }
  const response = new Response(body, { status: 200, headers });
  if (deps.cache) {
    try {
      await deps.cache.put(cacheKey, response.clone());
    } catch {
      // A cache that is down must not take tracing down.
    }
  }
  return response;
}
