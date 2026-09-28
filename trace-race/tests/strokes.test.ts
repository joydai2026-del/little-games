// The /api/strokes/:char proxy must not be an open proxy, and must never pass
// through bytes that differ from the pinned manifest.
import { describe, expect, it, vi } from 'vitest';
import { handleStrokes, resolveList, strokeCharFromPath } from '../src/worker/strokes';
import type { Env } from '../src/worker/env';

const ENV = {} as Env;
const REQ = new Request('https://trace.test/api/strokes/x');
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
    // Build a body whose sha256 IS the manifest's, by reading the real file the
    // manifest was made from when it is on this machine; otherwise skip.
    const nodeFs = 'node:fs';
    const fs: any = await import(/* @vite-ignore */ nodeFs);
    const path = '/Users/joyd/lg-scans/hwd/package/我.json';
    if (!fs.existsSync(path)) return;
    const bytes = fs.readFileSync(path);
    const res = await handleStrokes('我', { STROKE_CACHE_SECONDS: '60' } as Env, REQ, {
      fetch: (async () => new Response(bytes)) as never,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, immutable');
  });

  it('502s when the upstream is down', async () => {
    const res = await handleStrokes('我', ENV, REQ, { fetch: (async () => { throw new Error('down'); }) as never });
    expect(res.status).toBe(502);
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
