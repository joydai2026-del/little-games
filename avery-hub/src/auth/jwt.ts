// RS256 JWT verification against a JWKS URL (Google ID tokens and Cloudflare
// Access assertions). The URL, issuers and audience are config, so tests point
// them at a local fake issuer.
//
// Fetching keys: one fetch at a time per URL (single flight); a normal cache of
// JWKS_CACHE_MS; and an unknown `kid` forces a refresh at most once per
// JWKS_MIN_REFRESH_MS per URL, so forged tokens cannot make us fetch on every
// request.
import { b64urlDecode } from '../crypto';

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
}

const JWKS_CACHE_MS = 10 * 60_000;
const JWKS_MIN_REFRESH_MS = 60_000;
const cache = new Map<string, { at: number; keys: Jwk[] }>();
const inflight = new Map<string, Promise<Jwk[]>>();

/** Tests only. */
export function clearJwksCache(): void {
  cache.clear();
  inflight.clear();
}

function fetchKeys(url: string, nowMs: number): Promise<Jwk[]> {
  const running = inflight.get(url);
  if (running) return running;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`jwks fetch ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      const keys = Array.isArray(body.keys) ? body.keys : [];
      cache.set(url, { at: nowMs, keys });
      return keys;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

async function keyFor(url: string, kid: string | undefined, nowMs: number): Promise<Jwk | undefined> {
  let hit = cache.get(url);
  if (!hit || nowMs - hit.at >= JWKS_CACHE_MS) {
    await fetchKeys(url, nowMs);
    hit = cache.get(url);
  }
  let jwk = hit?.keys.find((k) => k.kid === kid);
  if (!jwk && hit && nowMs - hit.at >= JWKS_MIN_REFRESH_MS) {
    await fetchKeys(url, nowMs);
    jwk = cache.get(url)?.keys.find((k) => k.kid === kid);
  }
  return jwk;
}

const dec = new TextDecoder();

export interface VerifyOpts {
  jwksUrl: string;
  issuers: string[];
  audience: string;
  nowMs: number;
  skewSeconds?: number;
}

/** The payload of a valid token, or null. Never throws on bad input. */
export async function verifyRs256(token: unknown, o: VerifyOpts): Promise<Record<string, unknown> | null> {
  try {
    if (typeof token !== 'string' || !o.jwksUrl || !o.audience || o.issuers.length === 0) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(dec.decode(b64urlDecode(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256') return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[1]))) as Record<string, unknown>;
    const jwk = await keyFor(o.jwksUrl, header.kid, o.nowMs);
    if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const skew = o.skewSeconds ?? 60;
    const nowS = Math.floor(o.nowMs / 1000);
    if (typeof payload.exp !== 'number' || payload.exp + skew <= nowS) return null;
    if (typeof payload.nbf === 'number' && payload.nbf - skew > nowS) return null;
    if (typeof payload.iss !== 'string' || !o.issuers.includes(payload.iss)) return null;
    const aud = payload.aud;
    const audOk = Array.isArray(aud) ? aud.includes(o.audience) : aud === o.audience;
    if (!audOk) return null;
    return payload;
  } catch {
    return null;
  }
}
