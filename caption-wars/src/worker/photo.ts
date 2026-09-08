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
  /**
   * Hard deadline on the WHOLE CALL, every attempt included. See
   * PHOTO_TIMEOUT_MS in src/shared/config.ts, and the note on the budget in
   * fetchPhoto below.
   */
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
 * A deadline for one attempt.
 *
 * `AbortSignal.timeout` exists in workerd and in Node 18+. The fallback used to
 * return `undefined`, which fetched with NO SIGNAL AT ALL: the exact unbounded
 * state the deadline exists to prevent, reached silently. Now the fallback is a
 * real one, built from AbortController plus a timer, so the promise below can
 * always be raced and the socket is always released.
 *
 * Returns the signal and a `cancel` that clears the timer, so a fast success
 * does not leave a pending timeout behind.
 */
function attemptDeadline(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof ctor.timeout === 'function') {
    return { signal: ctor.timeout(ms), cancel: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export interface PhotoDeps {
  fetchImpl?: FetchLike;
  random?: () => number;
  /** Injected clock, so the whole-call budget can be tested without waiting. */
  now?: () => number;
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
  if (timeoutMs <= 0) throw new PhotoError('photo budget spent');
  // The deadline covers the whole attempt, body included: an abort throws, which
  // is the failure path that already backs the room off instead of parking every
  // player's poll inside a download that never finishes.
  const { signal, cancel } = attemptDeadline(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: 'follow', signal });
  } catch (err) {
    cancel();
    throw err;
  }

  try {
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
  } finally {
    cancel();
  }
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
 * ONE BUDGET FOR THE WHOLE CALL (review round 4). The three attempts run in
 * sequence, and each used to get its own `photoTimeoutMs`, so the legal worst
 * case for this function was 3 x PHOTO_TIMEOUT_MS = 24s while the browser gives
 * up on POST /start and POST /next after ACTION_TIMEOUT_MS = 20s. On a slow
 * night (both image hosts alive but crawling, the normal shape of a
 * rate-limited free API) the host's button re-enabled itself WHILE the first
 * start was still running inside the Durable Object, and the second tap got
 * "This game already started." at the moment the game started: verbatim the
 * failure plan rule 33 exists to prevent. So `photoTimeoutMs` is now a deadline
 * for the whole call and each attempt gets `min(perAttempt, remaining)`.
 * `tests/photo.test.ts` also asserts ACTION_TIMEOUT_MS >= PHOTO_TIMEOUT_MS +
 * 5000, so the two constants cannot drift apart again.
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
  const now = deps.now ?? Date.now;
  const { photoWidth: w, photoHeight: h, photoMaxBytes: cap, photoTimeoutMs: budget } = settings;
  const deadlineAt = now() + budget;

  const firstTag = pickTag(settings.photoTags, random);
  const secondTag = pickTag(settings.photoTags, random, firstTag);

  const tries: Array<{ url: string; source: PhotoMeta['source']; guardDefault: boolean }> = [
    { url: loremflickrUrl(w, h, firstTag), source: 'loremflickr', guardDefault: true },
    { url: loremflickrUrl(w, h, secondTag), source: 'loremflickr', guardDefault: true },
    { url: picsumUrl(w, h, code, round), source: 'picsum', guardDefault: false },
  ];

  const failures: string[] = [];
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    const remaining = deadlineAt - now();
    if (remaining <= 0) {
      failures.push(`${t.url}: photo budget of ${budget}ms spent before this attempt`);
      continue;
    }
    // Half of what is left, except for the last attempt, which gets all of it.
    // So a stalling first host cannot eat the time the fallbacks need, a host
    // that fails FAST hands its unused milliseconds on, and the sum of the three
    // attempts can never exceed the budget.
    const attemptsLeft = tries.length - i;
    const slice = attemptsLeft === 1 ? remaining : Math.max(1, Math.floor(remaining / 2));
    try {
      const { bytes, contentType } = await attempt(t.url, cap, slice, fetchImpl, t.guardDefault);
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
