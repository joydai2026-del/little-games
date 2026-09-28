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
//   - (Round 2) The upstream body is size-capped (STROKE_MAX_BYTES) and its
//     JSON shape is checked ({ strokes: string[], medians: array[] }) before
//     it is returned.
// Stroke data licence: Make Me a Hanzi / Arphic Technology, Arphic Public License.

import manifestJson from './strokes-manifest.json';
import countsJson from './stroke-counts.json';
import { parseCharList } from '../shared/parse';
import { GAME } from '../shared/config';
import type { CharGeom, CharList } from '../shared/types';
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

/**
 * Parse a paste and split it into playable characters, ones with no stroke
 * data, and ones with a single stroke (skipped: with its only stroke missing
 * there would be nothing on screen).
 */
export function resolveList(text: string): CharList {
  const parsed = parseCharList(text, Number.MAX_SAFE_INTEGER);
  const traceable: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  for (const ch of parsed.chars) {
    const n = hasStrokeData(ch) ? strokeCount(ch) : undefined;
    if (!n) missing.push(ch);
    else if (n < GAME.minStrokesToPlay) skipped.push(ch);
    else traceable.push(ch);
  }
  const chars = traceable.slice(0, GAME.maxListChars);
  const strokeCounts: Record<string, number> = {};
  for (const ch of chars) strokeCounts[ch] = strokeCount(ch)!;
  return {
    chars,
    missing,
    skipped,
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

const isPoint = (p: unknown): boolean =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * The shape hanzi-writer expects; anything else is refused: a non-empty
 * `strokes` array of strings, and a `medians` array of the SAME length whose
 * entries are non-empty lists of finite [x, y] pairs.
 */
export function isStrokeJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as { strokes?: unknown; medians?: unknown };
  if (!Array.isArray(v.strokes) || v.strokes.length === 0 || !v.strokes.every((s) => typeof s === 'string')) return false;
  if (!Array.isArray(v.medians) || v.medians.length !== v.strokes.length) return false;
  return v.medians.every((m) => Array.isArray(m) && m.length > 0 && m.every(isPoint));
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

class TooBig extends Error {}

/** Reads a body but stops (and throws) as soon as it passes `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/**
 * The verified stroke data for one character, for the room to grade answers
 * with: the same pinned upstream, size cap, manifest hash and shape check as
 * the proxy. Throws when it cannot be had.
 */
export async function loadGeometry(ch: string, env: Env, fetchImpl: typeof fetch = fetch): Promise<CharGeom> {
  if (!hasStrokeData(ch)) throw new Error(`no stroke data for ${ch}`);
  const timeoutMs = numberVar(env.STROKE_FETCH_TIMEOUT_MS, 6000, 500, 30_000);
  const maxBytes = numberVar(env.STROKE_MAX_BYTES, 65_536, 1024, 1_048_576);
  const upstream = await fetchImpl(`${UPSTREAM}${encodeURIComponent(ch)}.json`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!upstream.ok) throw new Error('stroke data is not reachable right now');
  const body = await readCapped(upstream, maxBytes);
  if ((await sha256Hex(body)) !== HASHES[ch]) throw new Error('stroke data did not match what we expected');
  const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
  if (!isStrokeJson(parsed)) throw new Error('stroke data did not match what we expected');
  const { strokes, medians } = parsed as CharGeom;
  return { strokes, medians };
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
  const maxBytes = numberVar(env.STROKE_MAX_BYTES, 65_536, 1024, 1_048_576);
  let body: ArrayBuffer;
  try {
    const upstream = await deps.fetch(`${UPSTREAM}${encodeURIComponent(ch)}.json`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!upstream.ok) return jsonError('stroke data is not reachable right now', 502);
    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return jsonError('stroke data was too big', 502);
    body = await readCapped(upstream, maxBytes);
  } catch (err) {
    if (err instanceof TooBig) return jsonError('stroke data was too big', 502);
    return jsonError('stroke data is not reachable right now', 502);
  }
  if ((await sha256Hex(body)) !== HASHES[ch]) {
    console.warn('strokes: upstream hash mismatch', ch);
    return jsonError('stroke data did not match what we expected', 502);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    parsed = null;
  }
  if (!isStrokeJson(parsed)) return jsonError('stroke data did not match what we expected', 502);
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
