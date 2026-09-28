// The stroke-data proxy. NOT an open proxy (security scan, round 1, 2026-09-28):
//   - the only accepted key is ONE code point that is in the pinned manifest;
//   - the upstream URL is built from the manifest's own package and version,
//     so swapping the source means swapping the manifest, in one place;
//   - the upstream body's sha256 must match the manifest before it is used.

import manifest from './stroke-manifest.json';

interface Manifest {
  package: string;
  version: string;
  algo: string;
  files: Record<string, string>;
}

const M = manifest as Manifest;

export const STROKES_UPSTREAM = `https://cdn.jsdelivr.net/npm/${M.package}@${M.version}/`;
export const LICENSE_URL = `${STROKES_UPSTREAM}ARPHICPL.TXT`;

export function inManifest(char: string): boolean {
  return Array.from(char).length === 1 && Object.prototype.hasOwnProperty.call(M.files, char);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type StrokeFetch =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; status: 404 | 502; reason: string };

/** Fetch one character's JSON from the pinned upstream and verify its hash. */
export async function fetchVerified(char: string, cacheSeconds: number, fetcher: typeof fetch = fetch): Promise<StrokeFetch> {
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
  const bytes = await res.arrayBuffer();
  if ((await sha256Hex(bytes)) !== M.files[char]) {
    return { ok: false, status: 502, reason: 'stroke data failed its integrity check' };
  }
  return { ok: true, bytes };
}
