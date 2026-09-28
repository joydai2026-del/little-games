import { describe, expect, it } from 'vitest';
import da from './fixtures/大.json?raw';
import ren from './fixtures/人.json?raw';
import shan from './fixtures/山.json?raw';
import xue from './fixtures/学.json?raw';
import xiao from './fixtures/校.json?raw';
import { makeHandler, type Env } from '../src/worker/index';
import { STROKES_UPSTREAM, validShape } from '../src/worker/strokes';

const RAW: Record<string, string> = { 大: da, 人: ren, 山: shan, 学: xue, 校: xiao };
const fixture = (c: string) => {
  if (!(c in RAW)) throw new Error('no fixture');
  return new TextEncoder().encode(RAW[c]);
};

/** A fake upstream that serves the real fixture bytes, and records every URL asked for. */
function upstream(overrides: Record<string, string | number> = {}) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const char = decodeURIComponent(url.slice(STROKES_UPSTREAM.length).replace(/\.json$/, ''));
    const o = overrides[char];
    if (typeof o === 'number') return new Response('nope', { status: o });
    if (typeof o === 'string') return new Response(o, { status: 200 });
    try {
      return new Response(fixture(char), { status: 200 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
  return { fetcher, calls };
}

const env = {
  ASSETS: {
    fetch: async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path === '/theme.css') return new Response(':root { --ink: #2D3436; }');
      if (path === '/sheet.css') return new Response('.sheet-page { display: block; }');
      return new Response('asset', { status: 200 });
    },
  },
  STROKES_CACHE_SECONDS: '600',
} as unknown as Env;

const get = (path: string) => new Request(`https://t.test${path}`);
const post = (body: unknown) =>
  new Request('https://t.test/api/sheet', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

describe('GET /api/strokes/:char', () => {
  it('serves the verified upstream bytes with safe headers', async () => {
    const { fetcher, calls } = upstream();
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('大')}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(((await res.json()) as { strokes: string[] }).strokes.length).toBe(3);
    expect(calls).toEqual([`${STROKES_UPSTREAM}${encodeURIComponent('大')}.json`]);
  });

  it('rejects anything that is not one manifest character, without calling upstream', async () => {
    const { fetcher, calls } = upstream();
    const handle = makeHandler(fetcher);
    for (const bad of ['大人', 'a', '%2F', '..%2F..%2Fpackage', '%E5%A4%A7%E4%BA%BA', '%ZZ']) {
      const res = await handle(get(`/api/strokes/${bad}`), env);
      expect(res.status, bad).toBe(400);
    }
    // A literal ".." is normalized away by the URL parser before routing; it never reaches the proxy.
    expect((await handle(get('/api/strokes/..'), env)).status).toBe(404);
    expect((await handle(get('/api/strokes/%2e%2e'), env)).status).toBe(404);
    expect((await handle(get('/api/strokes/a/b'), env)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 404 for a real Han character that has no data, without calling upstream', async () => {
    const { fetcher, calls } = upstream();
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('㐀')}`), env);
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('refuses upstream bytes whose sha256 does not match the manifest', async () => {
    const tampered = JSON.stringify({ strokes: ['M 0 0 L 10 10 Z'], medians: [] });
    const { fetcher } = upstream({ 大: tampered });
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('大')}`), env);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('M 0 0');
  });

  it('refuses an upstream body over the size cap, even when the hash would match', async () => {
    const { fetcher } = upstream();
    const small = { ...env, STROKES_MAX_BYTES: '100' } as Env; // 大.json is 1,034 bytes
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('大')}`), small);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('too large');
  });

  it('refuses a declared Content-Length over the cap before reading the body', async () => {
    const fetcher = (async () =>
      new Response('{}', { status: 200, headers: { 'Content-Length': '999999' } })) as unknown as typeof fetch;
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('大')}`), env);
    expect(res.status).toBe(502);
  });

  it('checks the JSON shape: strokes are strings, medians are arrays, one per stroke', () => {
    expect(validShape(JSON.parse(da))).toBe(true);
    expect(validShape(JSON.parse(xiao))).toBe(true);
    expect(validShape({ strokes: ['M 1 1 Z'] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: 'x' })).toBe(false);
    expect(validShape({ strokes: [1], medians: [[]] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[], []] })).toBe(false);
    expect(validShape({ strokes: [], medians: [] })).toBe(false);
    expect(validShape([])).toBe(false);
    expect(validShape(null)).toBe(false);
    // Medians must be arrays of finite numeric [x, y] pairs.
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [['not-a-point']] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[{ x: 1, y: 2 }]] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[[1, 2, 3]]] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[[1, Number.NaN]]] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[[1, 99999]]] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[]] })).toBe(false);
    expect(validShape({ strokes: ['M 1 1 Z'], medians: [[[1, 2], [3, 4]]] })).toBe(true);
  });

  it('enforces the size cap while streaming a body that has no Content-Length', async () => {
    let pulled = 0;
    const fetcher = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            if (pulled > 1000) return controller.close();
            controller.enqueue(new Uint8Array(1024));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('大')}`), env);
    expect(res.status).toBe(502);
    expect(pulled).toBeLessThan(80); // stopped near 64 KB, not after 1 MB
  });

  it('turns an upstream failure into 502', async () => {
    const { fetcher } = upstream({ 大: 503 });
    const res = await makeHandler(fetcher)(get(`/api/strokes/${encodeURIComponent('大')}`), env);
    expect(res.status).toBe(502);
  });
});

describe('POST /api/sheet (the agent path)', () => {
  it('returns a standalone printable HTML sheet from a messy paste', async () => {
    const { fetcher } = upstream();
    const res = await makeHandler(fetcher)(post({ chars: '1. 大 dà big\n2. 学校 xuéxiào', options: { paper: 'a4', trace: 1 } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(decodeURIComponent(res.headers.get('X-Sheet-Chars')!)).toBe('大学校');
    expect(res.headers.get('X-Sheet-Missing')).toBe('');
    const html = await res.text();
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('size: A4');
    expect(html).toContain('--ink: #2D3436');
    expect(html).toContain('Arphic Public License');
    expect(html).toContain('href="https://t.test/licenses/ARPHICPL.TXT"');
    expect((html.match(/class="ink-model"/g) ?? []).length).toBe(3);
    // Shapes are defined once and reused, so a sheet stays small.
    expect(html.length).toBeLessThan(120_000);
  });

  it('falls back to a plain glyph when a character has no data, and says which', async () => {
    const { fetcher } = upstream();
    const res = await makeHandler(fetcher)(post({ chars: '大 㐀' }), env);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get('X-Sheet-Missing')!)).toBe('㐀');
    expect(await res.text()).toContain('>㐀</text>');
  });

  it('degrades to plain glyphs when the stroke source is down, instead of failing', async () => {
    const { fetcher } = upstream({ 大: 500 });
    const res = await makeHandler(fetcher)(post({ chars: '大' }), env);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get('X-Sheet-Missing')!)).toBe('大');
  });

  it('reports skipped headings in a header, and in the 400 when nothing else is left', async () => {
    const handle = makeHandler(upstream().fetcher);
    const ok = await handle(post({ chars: '第三课\n大' }), env);
    expect(ok.status).toBe(200);
    expect(JSON.parse(decodeURIComponent(ok.headers.get('X-Sheet-Skipped')!))).toEqual(['第三课']);
    const empty = await handle(post({ chars: '第三课' }), env);
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as { error: string; skipped: string[] };
    expect(body.skipped).toEqual(['第三课']);
    expect(body.error).toContain('第三课');
  });

  it('rejects bad bodies in plain words', async () => {
    const handle = makeHandler(upstream().fetcher);
    expect((await handle(post({ chars: 5 }), env)).status).toBe(400);
    expect((await handle(post({ chars: 'hello' }), env)).status).toBe(400);
    expect(
      (await handle(new Request('https://t.test/api/sheet', { method: 'POST', body: 'not json', headers: { 'Content-Type': 'application/json' } }), env)).status,
    ).toBe(400);
    expect((await handle(get('/api/sheet'), env)).status).toBe(405);
  });

  it('refuses a body that is not declared as JSON (415)', async () => {
    const handle = makeHandler(upstream().fetcher);
    const res = await handle(new Request('https://t.test/api/sheet', { method: 'POST', body: '{"chars":"大"}', headers: { 'Content-Type': 'text/plain' } }), env);
    expect(res.status).toBe(415);
    const none = await handle(new Request('https://t.test/api/sheet', { method: 'POST', body: '{"chars":"大"}' }), env);
    expect(none.status).toBe(415);
  });

  it('refuses an oversized body by Content-Length before reading it (413)', async () => {
    const handle = makeHandler(upstream().fetcher);
    const req = new Request('https://t.test/api/sheet', {
      method: 'POST',
      body: '{"chars":"大"}',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '99999999' },
    });
    expect((await handle(req, env)).status).toBe(413);
  });

  it('refuses an oversized streamed body with no Content-Length (413), 5 MB of chars', async () => {
    const handle = makeHandler(upstream().fetcher);
    const res = await handle(post({ chars: '大'.repeat(5_000_001) }), env);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain('too big');
  });

  it('honours the rate limiter', async () => {
    const limited = { ...env, SHEET_LIMITER: { limit: async () => ({ success: false }) } } as Env;
    const res = await makeHandler(upstream().fetcher)(post({ chars: '大' }), limited);
    expect(res.status).toBe(429);
  });

  it('never fetches more than LIMITS.maxChars stroke files per call', async () => {
    const { fetcher, calls } = upstream();
    const chars = '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事';
    await makeHandler(fetcher)(post({ chars }), env);
    expect(calls.length).toBeLessThanOrEqual(40);
  });
});
