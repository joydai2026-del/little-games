// RS256 JWT verification against a JWKS URL (Google ID tokens and Cloudflare
// Access assertions). The URL, issuers and audience are config, so tests point
// them at a local fake issuer.
//
// Fetching keys (per JWKS URL):
// - the last good key set is kept and used even when a refresh fails, so
//   tokens signed by keys we already hold keep verifying during an outage;
// - a refresh runs at most once at a time (single flight);
// - a failed refresh starts a backoff (JWKS_RETRY_BACKOFF_SECONDS, doubling up
//   to JWKS_RETRY_BACKOFF_MAX_SECONDS) during which nothing is fetched;
// - an unknown `kid` triggers one refresh, then is remembered as unknown for
//   JWKS_NEGATIVE_CACHE_SECONDS. This is per kid, so a legitimately rotated key
//   is fetched the first time its own kid is seen;
// - unknown-kid refreshes are spaced at least JWKS_MIN_REFRESH_SECONDS (10)
//   apart, so random forged kids cannot make us fetch on every request (at most
//   6 a minute). The cost: a brand-new key can be refused for up to 10 s if a
//   forged kid triggered a refresh just before it was published (providers
//   publish keys ahead of use).
import { b64urlDecode } from '../crypto';

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
}

const JWKS_CACHE_MS = 10 * 60_000;

interface UrlState {
  keys: Jwk[];
  fetchedAt: number; // last GOOD fetch
  failures: number;
  retryAt: number; // no fetch before this
  attemptAt: number; // last fetch attempt
  unknownKids: Map<string, number>; // kid -> remembered-unknown until
}
const states = new Map<string, UrlState>();
const inflight = new Map<string, Promise<void>>();

/** Tests only. */
export function clearJwksCache(): void {
  states.clear();
  inflight.clear();
}

export interface JwksPolicy {
  negativeMs: number;
  backoffMs: number;
  backoffMaxMs: number;
  minRefreshMs: number;
}
const DEFAULT_JWKS: JwksPolicy = { negativeMs: 60_000, backoffMs: 30_000, backoffMaxMs: 600_000, minRefreshMs: 10_000 };

function stateOf(url: string): UrlState {
  let st = states.get(url);
  if (!st) {
    st = { keys: [], fetchedAt: 0, failures: 0, retryAt: 0, attemptAt: 0, unknownKids: new Map() };
    states.set(url, st);
  }
  return st;
}

function refresh(url: string, nowMs: number, jp: JwksPolicy): Promise<void> {
  const running = inflight.get(url);
  if (running) return running;
  const st = stateOf(url);
  if (nowMs < st.retryAt) return Promise.resolve();
  st.attemptAt = nowMs;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`jwks fetch ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      st.keys = Array.isArray(body.keys) ? body.keys : [];
      st.fetchedAt = nowMs;
      st.failures = 0;
      st.retryAt = 0;
      for (const k of st.keys) if (k.kid) st.unknownKids.delete(k.kid);
    } catch {
      st.failures += 1;
      st.retryAt = nowMs + Math.min(jp.backoffMs * 2 ** (st.failures - 1), jp.backoffMaxMs);
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

async function keyFor(url: string, kid: string | undefined, nowMs: number, jp: JwksPolicy): Promise<Jwk | undefined> {
  const st = stateOf(url);
  if (st.fetchedAt === 0 || nowMs - st.fetchedAt >= JWKS_CACHE_MS) await refresh(url, nowMs, jp);
  const find = () => st.keys.find((k) => k.kid === kid);
  let jwk = find();
  if (jwk || !kid) return jwk;
  const until = st.unknownKids.get(kid);
  if (until !== undefined && nowMs < until) return undefined;
  if (!inflight.has(url) && nowMs - st.attemptAt < jp.minRefreshMs) return undefined;
  await refresh(url, nowMs, jp);
  jwk = find();
  if (!jwk) st.unknownKids.set(kid, nowMs + jp.negativeMs);
  return jwk;
}

const dec = new TextDecoder();

export interface VerifyOpts {
  jwksUrl: string;
  issuers: string[];
  audience: string;
  nowMs: number;
  skewSeconds?: number;
  jwks?: JwksPolicy;
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
    const jwk = await keyFor(o.jwksUrl, header.kid, o.nowMs, o.jwks ?? DEFAULT_JWKS);
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
