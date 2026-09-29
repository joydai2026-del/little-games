// Closing fix (review round 4): config bounds, JWKS floors, LRU order, alert tags.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, caller, ACCESS_ISS, type Hub } from './support/harness';
import { adminPost } from './support/admin-call';
import { randomToken } from '../src/crypto';
import { policy } from '../src/config';
import { unknownKidList } from '../src/auth/jwt';
import { runCleanup } from '../src/cleanup';
import worker from '../src/index';
import type { Env } from '../src/env';

afterEach(() => vi.unstubAllGlobals());

const DAY = 86_400_000;
const CERTS = `${ACCESS_ISS}/cdn-cgi/access/certs`;
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const forged = (kid: string) => `${enc({ alg: 'RS256', kid })}.${enc({ iss: ACCESS_ISS, aud: 'aud-test', exp: 9e9 })}.AA`;
const seed = (h: Hub) =>
  h.db.raw.exec(`INSERT INTO seat_grants (email, school_ref, access_until, granted_by) VALUES ('old@s.org', 'PS1', ${h.clock.t - 5000 * DAY}, 'admin')`);

describe('SEAT_GRANT_RETENTION_DAYS is bounded (30 to 3650) and fails closed', () => {
  for (const bad of ['', '0', '-400', 'abc', '1e9', '29', '3651', '400.5']) {
    it(`"${bad}" deletes nothing and raises an AVERY_ALERT`, async () => {
      const h = await buildHub({ vars: { SEAT_GRANT_RETENTION_DAYS: bad } });
      expect(policy(h.env).seatGrantRetentionDays).toBeNull();
      seed(h);
      await expect(runCleanup(h.env)).rejects.toThrow(/SEAT_GRANT_RETENTION_DAYS is invalid/);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await worker.scheduled({} as ScheduledController, h.env);
      expect(spy.mock.calls.some((c) => String(c[0]).startsWith('AVERY_ALERT cleanup failed'))).toBe(true);
      spy.mockRestore();
      expect(h.db.raw.prepare('SELECT COUNT(*) AS n FROM seat_grants').get()).toEqual({ n: 1 });
    });
  }
  it('valid bounds work; absent means the 400-day default', () => {
    expect(policy({ SEAT_GRANT_RETENTION_DAYS: '30' } as unknown as Env).seatGrantRetentionDays).toBe(30);
    expect(policy({ SEAT_GRANT_RETENTION_DAYS: '3650' } as unknown as Env).seatGrantRetentionDays).toBe(3650);
    expect(policy({} as unknown as Env).seatGrantRetentionDays).toBe(400);
  });
});

describe('JWKS config floors', () => {
  const cases: [string, 'negativeMs' | 'backoffMs' | 'backoffMaxMs' | 'minRefreshMs' | 'negativeMax', number][] = [
    ['JWKS_NEGATIVE_CACHE_SECONDS', 'negativeMs', 1000],
    ['JWKS_RETRY_BACKOFF_SECONDS', 'backoffMs', 1000],
    ['JWKS_RETRY_BACKOFF_MAX_SECONDS', 'backoffMaxMs', 1000],
    ['JWKS_MIN_REFRESH_SECONDS', 'minRefreshMs', 1000],
    ['JWKS_NEGATIVE_CACHE_MAX', 'negativeMax', 1],
  ];
  for (const [name, field, floor] of cases) {
    for (const v of ['0', '-5']) {
      it(`${name}="${v}" is raised to the floor`, () => {
        expect(policy({ [name]: v } as unknown as Env).jwks[field]).toBe(floor);
      });
    }
  }
});

describe('JWKS unknown-kid LRU evicts the least recently used entry', () => {
  it('a, b, c remembered; a is touched; d arrives: b is evicted', async () => {
    const h = await buildHub({ vars: { JWKS_NEGATIVE_CACHE_MAX: '3', JWKS_MIN_REFRESH_SECONDS: '1', JWKS_NEGATIVE_CACHE_SECONDS: '100000' } });
    const hit = (kid: string) => adminPost(h, '/admin/x', { reason: 'r' }, forged(kid));
    await adminPost(h, '/admin/revoke-access', { teacherId: 'x', reason: 'r' }); // warm
    for (const k of ['a', 'b', 'c']) {
      h.clock.t += 1_001;
      await hit(k);
    }
    expect(unknownKidList(CERTS)).toEqual(['a', 'b', 'c']);
    await hit('a'); // touch: a becomes most recent
    expect(unknownKidList(CERTS)).toEqual(['b', 'c', 'a']);
    h.clock.t += 1_001;
    await hit('d');
    expect(unknownKidList(CERTS)).toEqual(['c', 'a', 'd']);
  });
});

describe('missing limiter bindings', () => {
  it('redeemHandoff with only REDEEM_LIMITER missing is unavailable and alert-tagged', async () => {
    const h = await buildHub({ vars: { REDEEM_LIMITER: undefined } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await h.core.redeemHandoff(h.env, caller(h), `v1.${randomToken(32)}`, randomToken(32))).toEqual({ ok: false, error: 'unavailable' });
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('AVERY_ALERT redeemHandoff'))).toBe(true);
    spy.mockRestore();
  });
  it('/auth/start with a missing binding is alert-tagged', async () => {
    const h = await buildHub({ vars: { AUTH_ADDRESS_LIMITER: undefined } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.fetch(`/auth/start?game=vocab&bind=${'a'.repeat(64)}`)).status).toBe(503);
    expect(spy.mock.calls.some((c) => String(c[0]).startsWith('AVERY_ALERT /auth/start'))).toBe(true);
    spy.mockRestore();
  });
});
