// Google OpenID Connect, authorization-code flow, all server side.
import type { Env } from '../env';
import type { Policy } from '../config';
import { verifyRs256 } from './jwt';
import type { GoogleIdentity } from '../db';

export function googleReady(env: Env, p: Policy): boolean {
  return Boolean(p.googleClientId && env.GOOGLE_CLIENT_SECRET && p.googleAuthUrl && p.googleTokenUrl && p.googleJwksUrl && p.hubOrigin);
}

export function callbackUrl(p: Policy): string {
  return `${p.hubOrigin}/auth/callback`;
}

export function authUrl(p: Policy, state: string, nonce: string): string {
  const u = new URL(p.googleAuthUrl);
  u.searchParams.set('client_id', p.googleClientId);
  u.searchParams.set('redirect_uri', callbackUrl(p));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/** Swap the code for an ID token and verify it. Null on any failure. */
export async function exchangeAndVerify(env: Env, p: Policy, code: string, nonce: string, nowMs: number): Promise<GoogleIdentity | null> {
  const res = await fetch(p.googleTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: p.googleClientId,
      client_secret: String(env.GOOGLE_CLIENT_SECRET ?? ''),
      redirect_uri: callbackUrl(p),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { id_token?: string } | null;
  const claims = await verifyRs256(body?.id_token, { jwksUrl: p.googleJwksUrl, issuers: p.googleIssuers, audience: p.googleClientId, nowMs, jwks: p.jwks });
  if (!claims) return null;
  if (claims.nonce !== nonce) return null;
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null;
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string') return null;
  const name = typeof claims.name === 'string' && claims.name ? claims.name : claims.email;
  return { sub: claims.sub, email: claims.email, name };
}
