// Regression tests for review round 3 (Codex).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller, Issuer, ACCESS_ISS, type Hub } from './support/harness';
import { adminPost } from './support/admin-call';
import { randomToken } from '../src/crypto';
import { unknownKidCount } from '../src/auth/jwt';
import { runCleanup } from '../src/cleanup';
import worker from '../src/index';

afterEach(() => vi.unstubAllGlobals());

const DAY = 86_400_000;
const CERTS = `${ACCESS_ISS}/cdn-cgi/access/certs`;
const certFetches = (h: Hub) => h.fetchLog.filter((u) => u === CERTS).length;
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const forged = (kid: string) => `${enc({ alg: 'RS256', kid })}.${enc({ iss: ACCESS_ISS, aud: 'aud-test', exp: 9e9 })}.AA`;
async function signedBy(h: Hub, issuer: Issuer) {
  const nowS = Math.floor(h.clock.t / 1000);
  return issuer.sign({ iss: ACCESS_ISS, aud: 'aud-test', email: 'admin@averystudio.org', exp: nowS + 300 });
}
const ok = (h: Hub, tok?: string) => adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' }, tok);

describe('1. JWKS: a failed refresh never marks a kid absent', () => {
  it('refresh fails at t=0; new kid B at t=11 is refused but NOT remembered; fetched once backoff allows', async () => {
    const h = await buildHub();
    expect((await ok(h)).status).toBe(200); // warm
    h.accessCerts.fail = true;
    h.clock.t += 11 * 60_000; // stale: this request's refresh fails (t=0), backoff 30 s
    expect((await ok(h)).status).toBe(200); // held key still verifies
    const b = await new Issuer().init();
    h.accessCerts.extra.push(b);
    h.accessCerts.fail = false;
    h.clock.t += 11_000; // t=11: still in backoff, no fetch
    const fetches = certFetches(h);
    expect((await ok(h, await signedBy(h, b))).status).toBe(403);
    expect(certFetches(h)).toBe(fetches);
    expect(unknownKidCount(CERTS)).toBe(0);
    h.clock.t += 20_000; // t=31: backoff over
    expect((await ok(h, await signedBy(h, b))).status).toBe(200);
    expect(certFetches(h)).toBe(fetches + 1);
  });
});

describe('2. JWKS: a malformed 200 keeps the last good keys and backs off', () => {
  for (const body of [{}, { keys: null }, { keys: [] }, { keys: [{ n: 'x' }] }]) {
    it(`body ${JSON.stringify(body)}`, async () => {
      const h = await buildHub();
      expect((await ok(h)).status).toBe(200);
      h.accessCerts.body = body;
      h.clock.t += 11 * 60_000;
      const before = certFetches(h);
      expect((await ok(h)).status).toBe(200); // malformed refresh, held key still works
      expect(certFetches(h)).toBe(before + 1);
      h.clock.t += 11_000;
      await ok(h, forged('zz'));
      expect(certFetches(h)).toBe(before + 1); // in backoff
    });
  }
});

describe('3. JWKS: the unknown-kid cache is bounded and expires', () => {
  it('300 unique forged kids leave at most JWKS_NEGATIVE_CACHE_MAX (256); expired ones are removed', async () => {
    const h = await buildHub({ vars: { JWKS_MIN_REFRESH_SECONDS: '1', JWKS_NEGATIVE_CACHE_SECONDS: '100000' } });
    expect((await ok(h)).status).toBe(200);
    for (let i = 0; i < 300; i++) {
      h.clock.t += 1_001;
      await ok(h, forged(`kid-${i}-${randomToken(8)}`));
    }
    expect(unknownKidCount(CERTS)).toBe(256);
    h.clock.t += 100_001_000; // all expired
    await ok(h, forged('last'));
    expect(unknownKidCount(CERTS)).toBeLessThanOrEqual(1);
  });
});

describe('5. a missing limiter binding fails closed', () => {
  for (const name of ['AUTH_START_LIMITER', 'AUTH_ADDRESS_LIMITER']) {
    it(`/auth/start without ${name} is "Can't sign in right now"`, async () => {
      const h = await buildHub({ vars: { [name]: undefined } });
      expect((await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`)).status).toBe(503);
    });
  }
  it('redeemHandoff without its limiters is unavailable', async () => {
    const h = await buildHub({ vars: { REDEEM_GAME_LIMITER: undefined } });
    expect(await h.core.redeemHandoff(h.env, caller(h), `v1.${randomToken(32)}`, randomToken(32))).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('6. redemption: per-game ceiling', () => {
  it('the 601st redemption for one game in a minute is rate_limited, whatever the binds; another game is unaffected', async () => {
    const h = await buildHub();
    let last: { ok: boolean; error?: string } = { ok: true };
    for (let i = 0; i < 601; i++) last = await h.core.redeemHandoff(h.env, caller(h), `v1.${randomToken(32)}`, randomToken(32));
    expect(last).toEqual({ ok: false, error: 'rate_limited' });
    expect(await h.core.redeemHandoff(h.env, caller(h, 'trace-race'), `v1.${randomToken(32)}`, randomToken(32))).toEqual({ ok: false, error: 'refused' });
  });
});

describe('7. seat-grant retention', () => {
  it('the daily clean-up deletes grants expired more than SEAT_GRANT_RETENTION_DAYS (400) ago, and only those', async () => {
    const h = await buildHub({ vars: { SEAT_GRANT_RETENTION_DAYS: '400' } });
    const t = h.clock.t;
    h.db.raw.exec(`INSERT INTO seat_grants (email, school_ref, access_until, granted_by) VALUES
      ('old@s.org', 'PS1', ${t - 401 * DAY}, 'admin'), ('recent@s.org', 'PS1', ${t - 399 * DAY}, 'admin'), ('live@s.org', 'PS1', ${t + DAY}, 'admin')`);
    expect(await runCleanup(h.env)).toEqual({ seatGrants: 1 });
    expect(h.db.raw.prepare('SELECT email FROM seat_grants ORDER BY email').all().map((r) => r.email)).toEqual(['live@s.org', 'recent@s.org']);
  });

  it('the scheduled handler runs it', async () => {
    const h = await buildHub();
    h.db.raw.exec(`INSERT INTO seat_grants (email, school_ref, access_until, granted_by) VALUES ('old@s.org', 'PS1', ${h.clock.t - 500 * DAY}, 'admin')`);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker.scheduled({} as ScheduledController, h.env);
    spy.mockRestore();
    expect(h.db.raw.prepare('SELECT COUNT(*) AS n FROM seat_grants').get()).toEqual({ n: 0 });
  });
});

void signIn;
