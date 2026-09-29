// Ported from crm/front-desk/test/stripe-webhook.test.ts (CRM commit 78a60c7,
// the last commit touching that file). The CRM tests go through its HTTP route
// (401 or 200); the hub's route is built in S2b, so each case here asserts the
// verifier's verdict directly (false = the route answers 401). Cases:
//   valid, wrong value, wrong length, stale timestamp, missing header,
//   malformed header shapes, unconfigured secret (the CRM's "mode whose secret
//   is unconfigured"). The CRM's "unhandled event type acknowledged 200" is
//   ported to tests/stripe/events.test.ts (allow-list), and its duplicate-event
//   and unknown-mode cases are route-level and belong to S2b.
//
// Signatures are built here with a separate helper (Web Crypto, written
// independently of computeStripeSignature), because the project has no Node
// type definitions for node:crypto.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  WebhookClockError,
  parseStripeSignatureHeader,
  verifyStripeSignature,
} from '../../src/stripe/webhook-verify';

const TEST_SECRET = 'whsec_avery_hub_test_secret';
const NOW_MS = 1_790_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(payload: string, secret = TEST_SECRET, atSec = NOW_S): Promise<string> {
  return `t=${atSec},v1=${await hmacHex(secret, `${atSec}.${payload}`)}`;
}

const payload = JSON.stringify({ id: 'evt_test_1', type: 'customer.subscription.updated', data: { object: {} } });
const verify = (header: string | undefined, extra: { secret?: string; nowMs?: number; toleranceSeconds?: number } = {}) =>
  verifyStripeSignature({
    rawBody: payload,
    header,
    secret: extra.secret ?? TEST_SECRET,
    nowMs: extra.nowMs ?? NOW_MS,
    ...(extra.toleranceSeconds !== undefined ? { toleranceSeconds: extra.toleranceSeconds } : {}),
  });

describe('stripe webhook signature verification (fail-closed, ported from the CRM)', () => {
  it('valid signature: accepted', async () => {
    expect(await verify(await sign(payload))).toBe(true);
  });

  it('invalid signature (right length, wrong value): rejected', async () => {
    expect(await verify(`t=${NOW_S},v1=${'a'.repeat(64)}`)).toBe(false);
  });

  it('wrong-length v1 signature: rejected, never throws', async () => {
    expect(await verify(`t=${NOW_S},v1=abc123`)).toBe(false);
  });

  it('stale timestamp (over 300s skew): rejected', async () => {
    expect(await verify(await sign(payload, TEST_SECRET, NOW_S - 400))).toBe(false);
  });

  it('missing Stripe-Signature header: rejected', async () => {
    expect(await verify(undefined)).toBe(false);
  });

  it('malformed signature header shapes: rejected each', async () => {
    const headers = [
      '',
      'garbage',
      't=,v1=',
      `v1=${'a'.repeat(64)}`, // no timestamp
      `t=${NOW_S}`, // no v1
      `t=notanumber,v1=${'a'.repeat(64)}`,
    ];
    for (const h of headers) {
      expect(await verify(h), `header: ${JSON.stringify(h)}`).toBe(false);
    }
  });

  it('unconfigured (empty) secret fails closed', async () => {
    expect(await verify(await sign(payload), { secret: '' })).toBe(false);
  });
});

describe('hub additions', () => {
  it('default tolerance is 300 seconds', () => {
    expect(DEFAULT_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });

  it('tolerance is a parameter: 400s old passes with 600, fails with default', async () => {
    const h = await sign(payload, TEST_SECRET, NOW_S - 400);
    expect(await verify(h, { toleranceSeconds: 600 })).toBe(true);
    expect(await verify(h)).toBe(false);
  });

  it('a timestamp too far in the future is rejected too', async () => {
    expect(await verify(await sign(payload, TEST_SECRET, NOW_S + 400))).toBe(false);
  });

  it('a bad tolerance value fails closed', async () => {
    const h = await sign(payload);
    expect(await verify(h, { toleranceSeconds: 0 })).toBe(false);
    expect(await verify(h, { toleranceSeconds: Number.NaN })).toBe(false);
  });

  it('secret roll: several v1 values, one signed by the current secret, is accepted', async () => {
    const oldSig = await hmacHex('whsec_old_secret', `${NOW_S}.${payload}`);
    const newSig = await hmacHex(TEST_SECRET, `${NOW_S}.${payload}`);
    const header = `t=${NOW_S},v1=${oldSig},v1=${newSig},v0=${'b'.repeat(64)}`;
    expect(parseStripeSignatureHeader(header)?.signatures).toHaveLength(2);
    expect(await verify(header)).toBe(true);
    expect(await verify(header, { secret: 'whsec_old_secret' })).toBe(true);
    expect(await verify(header, { secret: 'whsec_unrelated' })).toBe(false);
  });

  it('a body changed after signing is rejected', async () => {
    const h = await sign(payload);
    expect(
      await verifyStripeSignature({ rawBody: payload.replace('evt_test_1', 'evt_test_2'), header: h, secret: TEST_SECRET, nowMs: NOW_MS }),
    ).toBe(false);
  });
});

describe('nowMs unit guard and whole-second window', () => {
  it('throws a clear error when seconds are passed as nowMs', async () => {
    await expect(verify(await sign(payload), { nowMs: NOW_S })).rejects.toBeInstanceOf(WebhookClockError);
    await expect(verify(await sign(payload), { nowMs: Number.NaN })).rejects.toBeInstanceOf(WebhookClockError);
  });

  it('exactly 300 s old or ahead passes, 301 s fails, with sub-second now', async () => {
    const nowMs = NOW_MS + 999; // still second NOW_S
    for (const skew of [300, -300]) {
      expect(await verify(await sign(payload, TEST_SECRET, NOW_S - skew), { nowMs }), `skew ${skew}`).toBe(true);
    }
    for (const skew of [301, -301]) {
      expect(await verify(await sign(payload, TEST_SECRET, NOW_S - skew), { nowMs }), `skew ${skew}`).toBe(false);
    }
  });
});
