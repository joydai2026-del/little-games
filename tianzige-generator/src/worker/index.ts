// Worker entry. Anything that is not /api/* is served from static assets.
//
// Routes:
//   GET  /api/strokes/:char  -> the pinned, hash-verified stroke JSON for ONE character
//   POST /api/sheet          { chars, options? } -> a standalone printable HTML sheet
//
// No accounts, no storage, nothing about the caller is kept.

import { normalizeOptions, type SheetSpec } from '../shared/config';
import { buildSheet } from '../shared/layout';
import { pageCss } from '../shared/pagecss';
import { parseChars } from '../shared/parse';
import { renderPages } from '../shared/render';
import { readStrokes, type StrokeMap } from '../shared/strokes';
import { escapeXml, toMarkup } from '../shared/svg';
import { cacheSeconds, type Env } from './env';
import { fetchVerified, inManifest, LICENSE_URL } from './strokes';

export type { Env } from './env';

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra },
  });
}

async function handleStrokes(raw: string, env: Env, fetcher: typeof fetch): Promise<Response> {
  let char: string;
  try {
    char = decodeURIComponent(raw);
  } catch {
    return json({ error: 'one character, please' }, 400);
  }
  // Exactly one code point from the manifest. No slashes, no "..", no words.
  if (Array.from(char).length !== 1 || !inManifest(char)) {
    // A single Han character we have no data for is a 404 (the page falls back
    // to the font); anything else is a malformed request.
    const single = Array.from(char).length === 1 && /^\p{Script=Han}$/u.test(char);
    return json({ error: single ? 'no stroke data for this character' : 'one character, please' }, single ? 404 : 400, single ? { 'Cache-Control': 'public, max-age=86400' } : {});
  }
  const seconds = cacheSeconds(env);
  const got = await fetchVerified(char, seconds, fetcher);
  if (!got.ok) return json({ error: got.reason }, got.status);
  return new Response(got.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${seconds}`,
      ...SECURITY_HEADERS,
    },
  });
}

async function loadStrokes(chars: string[], env: Env, fetcher: typeof fetch): Promise<StrokeMap> {
  const map: StrokeMap = new Map();
  const seconds = cacheSeconds(env);
  await Promise.all(
    [...new Set(chars)].map(async (c) => {
      const got = await fetchVerified(c, seconds, fetcher);
      if (!got.ok) {
        map.set(c, null);
        return;
      }
      try {
        map.set(c, readStrokes(JSON.parse(new TextDecoder().decode(got.bytes))));
      } catch {
        map.set(c, null);
      }
    }),
  );
  return map;
}

async function assetText(env: Env, request: Request, path: string): Promise<string> {
  try {
    const res = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

async function handleSheet(request: Request, env: Env, fetcher: typeof fetch): Promise<Response> {
  if (env.SHEET_LIMITER) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.SHEET_LIMITER.limit({ key });
    if (!success) return json({ error: 'too many sheets at once, try again in a minute' }, 429, { 'Retry-After': '60' });
  }
  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'send JSON like {"chars": "大 小 山"}' }, 400);
  }
  if (typeof body.chars !== 'string') return json({ error: '"chars" must be a string' }, 400);

  const spec: SheetSpec = { version: 1, chars: body.chars, options: normalizeOptions(body.options) };
  const parsed = parseChars(spec.chars);
  if (parsed.chars.length === 0) return json({ error: 'no Chinese characters found in "chars"' }, 400);

  const strokes = await loadStrokes(parsed.chars, env, fetcher);
  const sheet = buildSheet(parsed.words, strokes, spec.options);
  const pages = renderPages(sheet, strokes).map(toMarkup).join('\n');
  const [theme, sheetCss] = await Promise.all([assetText(env, request, '/theme.css'), assetText(env, request, '/sheet.css')]);

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>田字格 ${escapeXml(parsed.chars.join(''))}</title>
<style>
${theme}
${sheetCss}
${pageCss(spec.options.paper)}
body { margin: 0; background: var(--cream); }
main { max-width: 820px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
.credits { font: 12px/1.4 system-ui, sans-serif; color: var(--ink-soft); text-align: center; }
@media print { body { background: none; } main { padding: 0; display: block; max-width: none; } .credits { display: none; } }
</style>
</head>
<body>
<main>
${pages}
</main>
<p class="credits">Character stroke data: <a href="${escapeXml(LICENSE_URL)}">Make Me a Hanzi / Arphic Technology, Arphic Public License</a></p>
</body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'X-Sheet-Pages': String(sheet.pages.length),
      'X-Sheet-Chars': encodeURIComponent(parsed.chars.join('')),
      'X-Sheet-Missing': encodeURIComponent(sheet.missing.join('')),
      'X-Sheet-Truncated': String(parsed.truncated),
      ...SECURITY_HEADERS,
    },
  });
}

export function makeHandler(fetcher: typeof fetch = (...a) => fetch(...a)) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const strokesMatch = url.pathname.match(/^\/api\/strokes\/([^/]+)$/);
    if (strokesMatch) {
      if (request.method !== 'GET') return json({ error: 'use GET' }, 405);
      return handleStrokes(strokesMatch[1], env, fetcher);
    }
    if (url.pathname.startsWith('/api/strokes')) return json({ error: 'one character, please' }, 400);
    if (url.pathname === '/api/sheet') {
      if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
      return handleSheet(request, env, fetcher);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  };
}

export default { fetch: makeHandler() };
