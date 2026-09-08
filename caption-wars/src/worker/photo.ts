// Fetching the round's photo, once, server-side (plan amendment 3).
//
// The Worker owns the bytes. Every player and the vision model read the SAME
// bytes out of Durable Object storage, so nobody is captioning a different
// picture than the one being judged.
//
// Two things verified live on 2026-09-07 shape this file:
//   - loremflickr answers a HEAD request with a placeholder image called
//     `defaultImage`, and picsum answers HEAD with 405. So: GET only, always.
//   - a good loremflickr GET redirects to
//     https://loremflickr.com/cache/resized/<id>_800_600_nofilter.jpg
//     and returns 200 image/jpeg, 40-110 KB. A tag with no match redirects to a
//     URL containing `defaultImage`, which is a valid 200 image and would
//     otherwise sail through every other check.
//
// No Cloudflare types here on purpose: this module is exercised by vitest with
// a fake fetch.

import type { PhotoMeta } from '../shared/types';

export interface PhotoSettings {
  photoTags: string[];
  photoWidth: number;
  photoHeight: number;
  photoMaxBytes: number;
  /** Hard deadline on ONE attempt. See PHOTO_TIMEOUT_MS in src/shared/config.ts. */
  photoTimeoutMs: number;
}

export interface FetchedPhoto {
  bytes: Uint8Array;
  contentType: string;
  meta: PhotoMeta;
}

export type FetchLike = (
  url: string,
  init?: { redirect?: 'follow'; signal?: AbortSignal }
) => Promise<Response>;

/**
 * An SVG is an image content type that also runs script. The photo route serves
 * these bytes from our own origin with the stored content type, and the room's
 * `playerSecret` lives in sessionStorage on that origin, so an SVG opened
 * directly would be same-origin script with access to it. Neither host serves
 * SVG today; this is the belt to the nosniff header's braces.
 */
const BANNED_CONTENT_TYPES = ['image/svg+xml', 'image/svg'];

/**
 * A deadline for one attempt. AbortSignal.timeout exists in workerd and Node
 * 18+; guard anyway so a missing implementation degrades to "no timeout"
 * instead of throwing (same guard as src/worker/bots.ts).
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const ctor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  return typeof ctor.timeout === 'function' ? ctor.timeout(ms) : undefined;
}

export interface PhotoDeps {
  fetchImpl?: FetchLike;
  random?: () => number;
}

export class PhotoError extends Error {}

function pickTag(tags: string[], random: () => number, avoid?: string): string {
  const pool = tags.filter((t) => t !== avoid);
  const from = pool.length > 0 ? pool : tags;
  return from[Math.floor(random() * from.length) % from.length];
}

/**
 * Reads the body with a hard byte cap, aborting the stream the moment the cap
 * is passed rather than buffering a hostile 500 MB response first.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) throw new PhotoError('empty response body');

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PhotoError(`image is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** One attempt: GET, follow redirects, and refuse anything that is not a real photo. */
async function attempt(
  url: string,
  maxBytes: number,
  timeoutMs: number,
  fetchImpl: FetchLike,
  rejectDefaultImage: boolean
): Promise<{ bytes: Uint8Array; contentType: string }> {
  // The deadline covers the whole attempt, body included: an abort throws, which
  // is the failure path that already backs the room off instead of parking every
  // player's poll inside a download that never finishes.
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: timeoutSignal(timeoutMs),
  });

  if (response.status !== 200) throw new PhotoError(`photo host answered ${response.status}`);

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new PhotoError(`photo host answered with ${contentType || 'no content type'}`);
  }
  if (BANNED_CONTENT_TYPES.some((banned) => contentType.startsWith(banned))) {
    throw new PhotoError(`photo host answered with ${contentType}, which can carry script`);
  }

  // loremflickr's "no photo matched that tag" placeholder is a perfectly valid
  // 200 image, so the only way to catch it is the resolved URL.
  const finalUrl = response.url || url;
  if (rejectDefaultImage && finalUrl.includes('defaultImage')) {
    throw new PhotoError('photo host had no match for that tag');
  }

  const bytes = await readCapped(response, maxBytes);
  if (bytes.byteLength === 0) throw new PhotoError('photo host sent 0 bytes');

  return { bytes, contentType: contentType.split(';')[0] };
}

export function loremflickrUrl(width: number, height: number, tag: string): string {
  return `https://loremflickr.com/${width}/${height}/${encodeURIComponent(tag)}`;
}

export function picsumUrl(width: number, height: number, code: string, round: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(`${code}-${round}`)}/${width}/${height}`;
}

/**
 * The round's photo: loremflickr with a random tag, one retry with a different
 * tag, then picsum seeded by `<code>-<round>` so a re-fetch of the same round
 * gets the same picture.
 *
 * `credit` is the source site, not a person. loremflickr burns the
 * photographer's name into the image itself and exposes no machine-readable
 * attribution, so naming one here would be inventing it.
 */
export async function fetchPhoto(
  settings: PhotoSettings,
  code: string,
  round: number,
  deps: PhotoDeps = {}
): Promise<FetchedPhoto> {
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  const random = deps.random ?? Math.random;
  const { photoWidth: w, photoHeight: h, photoMaxBytes: cap, photoTimeoutMs: deadline } = settings;

  const firstTag = pickTag(settings.photoTags, random);
  const secondTag = pickTag(settings.photoTags, random, firstTag);

  const tries: Array<{ url: string; source: PhotoMeta['source']; guardDefault: boolean }> = [
    { url: loremflickrUrl(w, h, firstTag), source: 'loremflickr', guardDefault: true },
    { url: loremflickrUrl(w, h, secondTag), source: 'loremflickr', guardDefault: true },
    { url: picsumUrl(w, h, code, round), source: 'picsum', guardDefault: false },
  ];

  const failures: string[] = [];
  for (const t of tries) {
    try {
      const { bytes, contentType } = await attempt(t.url, cap, deadline, fetchImpl, t.guardDefault);
      return {
        bytes,
        contentType,
        meta: {
          round,
          source: t.source,
          credit: t.source === 'loremflickr' ? 'loremflickr.com' : 'picsum.photos',
          sha256: await sha256Hex(bytes),
          bytes: bytes.byteLength,
        },
      };
    } catch (err) {
      failures.push(`${t.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new PhotoError(`could not load a photo (${failures.join(' | ')})`);
}
