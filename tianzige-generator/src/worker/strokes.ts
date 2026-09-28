// The stroke-data proxy. NOT an open proxy (security scan, round 1, 2026-09-28):
//   - the only accepted key is ONE code point that is in the pinned manifest;
//   - the upstream URL is built from the manifest's own package and version,
//     so swapping the source means swapping the manifest, in one place;
//   - the upstream body's sha256 must match the manifest before it is used.

import manifest from './stroke-manifest.json';
// Upstream body cap default; the policy value is STROKES_MAX_BYTES in wrangler.jsonc.
// The largest file in the pinned package is 8,621 bytes.
import { DEFAULT_MAX_BYTES, readCapped } from './env';

interface Manifest {
  package: string;
  version: string;
  algo: string;
  files: Record<string, string>;
}

const M = manifest as Manifest;

export const STROKES_UPSTREAM = `https://cdn.jsdelivr.net/npm/${M.package}@${M.version}/`;
/** Our own unmodified copy of the data package's license, served as a static file. */
export const LICENSE_PATH = '/licenses/ARPHICPL.TXT';

export function inManifest(char: string): boolean {
  return Array.from(char).length === 1 && Object.prototype.hasOwnProperty.call(M.files, char);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}


/** Loose bounds for a median point: the glyph box is 1024 units with some overshoot. */
const POINT_MIN = -1024;
const POINT_MAX = 2048;

function isPoint(p: unknown): boolean {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= POINT_MIN && v <= POINT_MAX)
  );
}

/** The published shape: { strokes: string[], medians: [x, y][][] }, one median per stroke. */
export function validShape(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const { strokes, medians } = data as { strokes?: unknown; medians?: unknown };
  return (
    Array.isArray(strokes) &&
    strokes.length > 0 &&
    strokes.every((s) => typeof s === 'string') &&
    Array.isArray(medians) &&
    medians.length === strokes.length &&
    medians.every((m) => Array.isArray(m) && m.length > 0 && m.every(isPoint))
  );
}

export type StrokeFetch =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; status: 404 | 502; reason: string };

/** Fetch one character's JSON from the pinned upstream and verify its hash. */
export async function fetchVerified(
  char: string,
  cacheSeconds: number,
  fetcher: typeof fetch = fetch,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<StrokeFetch> {
  if (!inManifest(char)) return { ok: false, status: 404, reason: 'no stroke data for this character' };
  let res: Response;
  try {
    res = await fetcher(`${STROKES_UPSTREAM}${encodeURIComponent(char)}.json`, {
      cf: { cacheTtl: cacheSeconds, cacheEverything: true },
    } as RequestInit);
  } catch {
    return { ok: false, status: 502, reason: 'stroke source unreachable' };
  }
  if (!res.ok) return { ok: false, status: 502, reason: `stroke source answered ${res.status}` };
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 502, reason: 'stroke data too large' };
  // The cap is enforced while streaming, so a body without Content-Length is never fully buffered.
  const read = await readCapped(res.body, maxBytes);
  if (!read) return { ok: false, status: 502, reason: 'stroke data too large' };
  const bytes = read.buffer.slice(read.byteOffset, read.byteOffset + read.byteLength) as ArrayBuffer;
  if ((await sha256Hex(bytes)) !== M.files[char]) {
    return { ok: false, status: 502, reason: 'stroke data failed its integrity check' };
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, status: 502, reason: 'stroke data is not JSON' };
  }
  if (!validShape(data)) return { ok: false, status: 502, reason: 'stroke data has the wrong shape' };
  return { ok: true, bytes };
}
