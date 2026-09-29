// COPIED from joydai2026-del/crm, file crm/front-desk/src/payments/webhook-verify.ts,
// last changed there in commit de8d4ca (2026-06-10, 'stage1 lane C: Stripe payment
// adapter, webhooks, refunds, links'). Changes for the hub, and only these:
//   - the 300-second window is a parameter, `toleranceSeconds`, fed from the
//     config var STRIPE_SIGNATURE_TOLERANCE_SECONDS (default 300);
//   - `nowMs` below 1e11 (Unix SECONDS passed by mistake) throws
//     `WebhookClockError` instead of rejecting every real event;
//   - the window compares whole seconds (Math.floor), like Stripe's own SDK;
//   - quotes and formatting follow this repo's style.
// Everything else (parse rules, 64-hex check, constant-time compare, several v1
// values accepted while a secret is rolled) is unchanged. Keep in sync by hand.
//
// Stripe webhook signature verification, fail-closed (qa C3 pattern: bad
// input is a 401, never a 500). Web Crypto only, so it runs in Workers
// and Node tests identically.

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

/** Programming error: the caller passed seconds where milliseconds are required. */
export class WebhookClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookClockError';
  }
}
/** v1 signatures are HMAC-SHA256 hex: exactly 64 lowercase hex chars. */
const V1_HEX_RE = /^[0-9a-f]{64}$/;

export interface ParsedStripeSignature {
  /** Unix seconds from the t= item. */
  timestamp: number;
  /** All v1= items (Stripe sends several while rolling a secret). */
  signatures: string[];
}

/** Parse `t=...,v1=...[,v1=...,v0=...]`. Returns undefined on malformed input. */
export function parseStripeSignatureHeader(header: string): ParsedStripeSignature | undefined {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) return undefined;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') {
      if (!/^\d{1,12}$/.test(value)) return undefined;
      timestamp = Number(value);
    } else if (key === 'v1') {
      signatures.push(value);
    }
    // other schemes (v0 etc.) are ignored
  }
  if (timestamp === undefined || signatures.length === 0) return undefined;
  return { timestamp, signatures };
}

/** HMAC-SHA256 hex over `${timestamp}.${rawBody}` (Stripe's signed_payload). */
export async function computeStripeSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  let hex = '';
  for (const b of new Uint8Array(mac)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Constant-time string compare (no early exit on first mismatching char). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Full check: parse -> timestamp within +/- tolerance (default 300s) of now -> every v1 well-formed
 * (64 hex chars; wrong length rejects the request) -> constant-time compare
 * against the expected HMAC. Any failure returns false (caller sends 401).
 */
export async function verifyStripeSignature(args: {
  rawBody: string;
  header: string | undefined;
  secret: string;
  /** Current time in MILLISECONDS (Date.now()). Unlike accessFor, which takes seconds. */
  nowMs: number;
  /** Allowed clock skew in seconds; config STRIPE_SIGNATURE_TOLERANCE_SECONDS. */
  toleranceSeconds?: number;
}): Promise<boolean> {
  if (!Number.isFinite(args.nowMs) || args.nowMs < 1e11) {
    throw new WebhookClockError('verifyStripeSignature: nowMs must be milliseconds (Date.now()), not seconds');
  }
  if (!args.header || !args.secret) return false;
  const tolerance = args.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (!Number.isFinite(tolerance) || tolerance <= 0) return false;
  const parsed = parseStripeSignatureHeader(args.header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(args.nowMs / 1000) - parsed.timestamp) > tolerance) return false;
  for (const sig of parsed.signatures) {
    if (!V1_HEX_RE.test(sig)) return false;
  }
  const expected = await computeStripeSignature(args.secret, parsed.timestamp, args.rawBody);
  let ok = false;
  for (const sig of parsed.signatures) {
    if (constantTimeEqual(sig, expected)) ok = true;
  }
  return ok;
}
