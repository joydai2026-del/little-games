// The /api/strokes/:char proxy must not be an open proxy, and must never pass
// through bytes that differ from the pinned manifest.
import { describe, expect, it, vi } from 'vitest';
import woRaw from './fixtures/wo-6211.json?raw';
import { handleStrokes, isStrokeJson, resolveList, strokeCharFromPath } from '../src/worker/strokes';
import type { Env } from '../src/worker/env';

const ENV = {} as Env;
const REQ = new Request('https://missing.test/api/strokes/x');
// 我 (U+6211): the scan report's sample file, 2476 bytes, sha256 08616462...ac8.
// Not bundled here; the tests only need bodies that match or do not match.

describe('strokeCharFromPath', () => {
  it('accepts one manifest character, raw or encoded, with or without .json', () => {
    expect(strokeCharFromPath('我')).toBe('我');
    expect(strokeCharFromPath(encodeURIComponent('我'))).toBe('我');
    expect(strokeCharFromPath(encodeURIComponent('我') + '.json')).toBe('我');
  });
  it('rejects multi-char, traversal, slashes, ASCII and characters with no data', () => {
    for (const bad of ['我们', '..', '%2e%2e', '..%2F', 'a', '%2F', '%E6%88', '𠮷', '']) {
      expect(strokeCharFromPath(bad)).toBeNull();
    }
  });
});

describe('handleStrokes', () => {
  it('400s a rejected path without touching the network', async () => {
    const fetchSpy = vi.fn();
    const res = await handleStrokes('..%2Fhanzi-writer%2Fpackage.json', ENV, REQ, { fetch: fetchSpy as never });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('502s when the upstream body does not match the manifest hash', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"strokes":["evil"],"medians":[]}'));
    const res = await handleStrokes('我', ENV, REQ, { fetch: fetchSpy as never });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('evil');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/%E6%88%91.json',
      expect.anything()
    );
  });

  it('passes a matching body with json, nosniff and cache headers', async () => {
    // tests/fixtures/wo-6211.json is the real hanzi-writer-data 2.0.1 file for 我
    // (U+6211), byte-identical, sha256 08616462...6ac8, which is the manifest's hash.
    const bytes = new TextEncoder().encode(woRaw);
    const res = await handleStrokes('我', { STROKE_CACHE_SECONDS: '60' } as Env, REQ, {
      fetch: (async () => new Response(bytes)) as never,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, immutable');
    expect(isStrokeJson(JSON.parse(await res.text()))).toBe(true);
  });

  it('502s when the upstream is down', async () => {
    const res = await handleStrokes('我', ENV, REQ, { fetch: (async () => { throw new Error('down'); }) as never });
    expect(res.status).toBe(502);
  });
});

describe('handleStrokes round-2 guards', () => {
  it('502s an upstream body over the size cap (declared or streamed)', async () => {
    const big = 'x'.repeat(2048);
    const env = { STROKE_MAX_BYTES: '1024' } as Env;
    const declared = await handleStrokes('我', env, REQ, {
      fetch: (async () => new Response(big, { headers: { 'content-length': String(big.length) } })) as never,
    });
    expect(declared.status).toBe(502);
    expect(await declared.text()).toContain('too big');
    const streamed = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const res = await handleStrokes('我', env, REQ, { fetch: (async () => new Response(streamed)) as never });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('too big');
  });

  it('isStrokeJson accepts the real shape and rejects anything else', () => {
    expect(isStrokeJson({ strokes: ['M 1 2'], medians: [[[1, 2]]] })).toBe(true);
    for (const bad of [
      null, [], 'x', {},
      { strokes: [], medians: [] },
      { strokes: [1], medians: [[[1, 2]]] },
      { strokes: ['M'], medians: 'no' },
      { strokes: ['M'], medians: [5] },
      { strokes: ['M', 'L'], medians: [[[1, 2]]] },
      { strokes: ['M'], medians: [[]] },
      { strokes: ['M'], medians: [[[1, 'x']]] },
      { strokes: ['M'], medians: [[[1, Infinity]]] },
      { strokes: ['M'], medians: [[[1, 2, 3]]] },
    ]) {
      expect(isStrokeJson(bad)).toBe(false);
    }
  });
});

describe('resolveList', () => {
  it('keeps order, notes missing characters, and caps', () => {
    const r = resolveList('我 𠮷 你 我');
    expect(r.chars).toEqual(['我', '你']);
    expect(r.missing).toEqual(['𠮷']);
    expect(r.strokeCounts).toEqual({ 我: 7, 你: 7 });
    expect(r.repeats).toBe(1);
  });
});

describe('resolveList', () => {
  it('skips one-stroke characters with a note-able list, and keeps the rest in order', () => {
    const list = resolveList('1. 一 yī\n2. 山\n3. 乙\n4. 𠮷\n5. 人');
    expect(list.chars).toEqual(['山', '人']);
    expect(list.skipped).toEqual(['一', '乙']);
    expect(list.missing).toEqual(['𠮷']);
    expect(Object.values(list.strokeCounts).every((n) => n >= 2)).toBe(true);
  });
});
