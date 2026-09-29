// Small Web Crypto helpers. Tokens are opaque random bytes; only HMACs of them
// are stored, tagged with the key version that made them.
import type { Env } from './env';

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

/** Constant-time string compare (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class NoKeyError extends Error {}

function hashKey(env: Env, version: number): string {
  const v = env[`SESSION_HASH_KEY_V${version}`];
  if (typeof v !== 'string' || v.length < 16) throw new NoKeyError(`hash key v${version} missing`);
  return v;
}

export async function hmacHex(env: Env, version: number, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(hashKey(env, version)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

/** A new opaque value "v<N>.<random>" plus its stored hash. */
export async function mintSecret(env: Env, version: number): Promise<{ value: string; hash: string; version: number }> {
  const value = `v${version}.${randomToken(32)}`;
  return { value, hash: await hmacHex(env, version, value), version };
}

/** Hash a presented "v<N>.<random>" with the key named in it; null if malformed or unknown key. */
export async function hashPresented(env: Env, value: unknown): Promise<{ hash: string; version: number } | null> {
  if (typeof value !== 'string') return null;
  const m = /^v(\d{1,3})\.([A-Za-z0-9_-]{20,100})$/.exec(value);
  if (!m) return null;
  const version = Number(m[1]);
  try {
    return { hash: await hmacHex(env, version, value), version };
  } catch {
    return null;
  }
}
