import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildHub, signIn, caller } from './support/harness';

afterEach(() => vi.unstubAllGlobals());

describe('smoke', () => {
  it('signs in and redeems', async () => {
    const h = await buildHub();
    const s = await signIn(h, { sub: 'g-a', email: 'a@school.org' });
    expect(s.gameSessionId).toMatch(/^v1\./);
    const r = await h.core.resolveSession(h.env, caller(h), s.gameSessionId);
    expect(r).toMatchObject({ ok: true, email: 'a@school.org' });
  });
});
