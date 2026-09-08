// The photo fetch, driven by a fake `fetch`. Everything asserted here is a
// behaviour that a live probe on 2026-09-07 showed is real: loremflickr answers
// a no-match tag with a 200 image at a URL containing `defaultImage`, and both
// hosts redirect before they answer.

import { describe, it, expect } from 'vitest';
import { fetchPhoto, loremflickrUrl, picsumUrl, sha256Hex, PhotoError } from '../src/worker/photo';
import { fixturePhoto, FIXTURE_PHOTO_SHA256 } from '../src/shared/fixture-photo';

const SETTINGS = {
  photoTags: ['goat', 'dog', 'awkward'],
  photoWidth: 800,
  photoHeight: 600,
  photoMaxBytes: 2_000_000,
  photoTimeoutMs: 8_000,
};

/** A deterministic "random" so the tag sequence in a test is predictable. */
function fixedRandom(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function imageResponse(bytes: Uint8Array, finalUrl: string, contentType = 'image/jpeg'): Response {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const response = new Response(body, { status: 200, headers: { 'content-type': contentType } });
  // `Response.url` is read-only and empty for a synthesised response; the real
  // one carries the post-redirect URL, which is the only way to spot
  // loremflickr's placeholder.
  Object.defineProperty(response, 'url', { value: finalUrl });
  return response;
}

describe('fetchPhoto', () => {
  it('returns the bytes, the source, and a sha256 that matches the content', async () => {
    const bytes = fixturePhoto();
    const seen: string[] = [];
    const result = await fetchPhoto(SETTINGS, 'ABCD', 1, {
      random: fixedRandom([0, 0]),
      fetchImpl: async (url) => {
        seen.push(url);
        return imageResponse(bytes, 'https://loremflickr.com/cache/resized/1_800_600_nofilter.jpg');
      },
    });

    expect(seen).toEqual([loremflickrUrl(800, 600, 'goat')]);
    expect(result.meta.source).toBe('loremflickr');
    expect(result.meta.credit).toBe('loremflickr.com');
    expect(result.meta.round).toBe(1);
    expect(result.meta.bytes).toBe(bytes.byteLength);
    expect(result.meta.sha256).toBe(FIXTURE_PHOTO_SHA256);
    expect(result.contentType).toBe('image/jpeg');
  });

  it('rejects the loremflickr defaultImage placeholder and retries with another tag', async () => {
    const bytes = fixturePhoto();
    const seen: string[] = [];
    const result = await fetchPhoto(SETTINGS, 'ABCD', 1, {
      random: fixedRandom([0, 0]), // 'goat', then 'dog' (the retry avoids the first tag)
      fetchImpl: async (url) => {
        seen.push(url);
        return seen.length === 1
          ? imageResponse(bytes, 'https://loremflickr.com/cache/resized/defaultImage.jpg')
          : imageResponse(bytes, 'https://loremflickr.com/cache/resized/9_800_600_nofilter.jpg');
      },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('goat');
    expect(seen[1]).not.toContain('goat');
    expect(result.meta.source).toBe('loremflickr');
  });

  it('falls back to picsum when both loremflickr attempts fail', async () => {
    const bytes = fixturePhoto();
    const seen: string[] = [];
    const result = await fetchPhoto(SETTINGS, 'ABCD', 3, {
      random: fixedRandom([0, 0]),
      fetchImpl: async (url) => {
        seen.push(url);
        if (url.includes('loremflickr')) return new Response('nope', { status: 503 });
        return imageResponse(bytes, 'https://fastly.picsum.photos/id/507/800/600.jpg?hmac=x');
      },
    });

    expect(seen).toHaveLength(3);
    expect(seen[2]).toBe(picsumUrl(800, 600, 'ABCD', 3));
    expect(result.meta.source).toBe('picsum');
    expect(result.meta.credit).toBe('picsum.photos');
  });

  it('rejects a response that is not an image', async () => {
    await expect(
      fetchPhoto(SETTINGS, 'ABCD', 1, {
        random: fixedRandom([0]),
        fetchImpl: async () =>
          new Response('<html>rate limited</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      })
    ).rejects.toBeInstanceOf(PhotoError);
  });

  it('aborts a body that goes past the byte cap instead of buffering it', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(400);

    const makeStream = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk); // never closes: only the cap can stop this
        },
        cancel() {
          cancelled = true;
        },
      });

    await expect(
      fetchPhoto({ ...SETTINGS, photoMaxBytes: 1000 }, 'ABCD', 1, {
        random: fixedRandom([0]),
        fetchImpl: async () => {
          const res = new Response(makeStream(), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          });
          Object.defineProperty(res, 'url', { value: 'https://loremflickr.com/cache/resized/1.jpg' });
          return res;
        },
      })
    ).rejects.toThrow(/could not load a photo/);

    expect(cancelled).toBe(true);
  });

  it('accepts a body right up to the cap', async () => {
    const bytes = new Uint8Array(1000).fill(7);
    const result = await fetchPhoto({ ...SETTINGS, photoMaxBytes: 1000 }, 'ABCD', 1, {
      random: fixedRandom([0]),
      fetchImpl: async () => imageResponse(bytes, 'https://loremflickr.com/cache/resized/1.jpg'),
    });
    expect(result.meta.bytes).toBe(1000);
    expect(result.meta.sha256).toBe(await sha256Hex(bytes));
  });

  it('rejects an SVG, which is an image that can also run script', async () => {
    // Neither host serves SVG today. This is the belt to the nosniff header's
    // braces: these bytes come back from OUR origin, where the room's
    // playerSecret lives in sessionStorage.
    await expect(
      fetchPhoto(SETTINGS, 'ABCD', 1, {
        random: fixedRandom([0]),
        fetchImpl: async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
          }),
      })
    ).rejects.toThrow(/can carry script/);
  });

  it('passes a deadline into the fetch, so a stalled host cannot park the room', async () => {
    // The signal is the whole point: the photo download happens inside settle(),
    // which every authenticated request runs, so a host that accepts the
    // connection and then says nothing used to park every player's poll in the
    // same never-resolving fetch. The fake honours the signal the way a real
    // fetch does, and never resolves otherwise.
    const signals: Array<AbortSignal | undefined> = [];
    const started = Date.now();

    await expect(
      fetchPhoto({ ...SETTINGS, photoTimeoutMs: 40 }, 'ABCD', 1, {
        random: fixedRandom([0, 0]),
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            signals.push(init?.signal);
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      })
    ).rejects.toThrow(/could not load a photo/);

    // All three attempts (two loremflickr tags, then picsum) got a live signal,
    // and the whole thing ended in well under the 8s production deadline.
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('gives up with one error naming every attempt when nothing works', async () => {
    await expect(
      fetchPhoto(SETTINGS, 'ABCD', 1, {
        random: fixedRandom([0, 0]),
        fetchImpl: async () => new Response('down', { status: 500 }),
      })
    ).rejects.toThrow(/loremflickr.*loremflickr.*picsum/s);
  });
});
