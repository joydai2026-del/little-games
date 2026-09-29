// TokenDO: one object per one-time token (hand-off token, OAuth state, or a
// pending sign-in waiting on the device picker), named by the token's HMAC.
// `take` runs one at a time inside the object and burns the token on the
// first attempt, so two redemptions can never both succeed. An alarm deletes
// the object after expiry.
import { DurableObject } from 'cloudflare:workers';
import { safeEqual } from '../crypto';
import { now } from '../clock';

export type TokenKind = 'handoff' | 'state' | 'pending';

export interface TokenRecord {
  kind: TokenKind;
  expiresAt: number;
  gameId: string | null;
  bindHash: string | null;
  data: Record<string, string | number | null>;
  used?: boolean;
}

export type TakeResult =
  | { ok: true; record: TokenRecord }
  | { ok: false; error: 'unknown' | 'used' | 'expired' | 'wrong_game' | 'wrong_bind' };

export class TokenDO extends DurableObject {
  private chain: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async create(rec: TokenRecord): Promise<void> {
    return this.serial(async () => {
      const existing = await this.ctx.storage.get<TokenRecord>('rec');
      if (existing) throw new Error('token already exists');
      await this.ctx.storage.put('rec', { ...rec, used: false });
      await this.ctx.storage.setAlarm(rec.expiresAt + 1000);
    });
  }

  /** Burn the token and return it if every check passes. Any attempt burns it. */
  async take(kind: TokenKind, expect: { gameId?: string | null; bindHash?: string | null }): Promise<TakeResult> {
    return this.serial(async () => {
      const rec = await this.ctx.storage.get<TokenRecord>('rec');
      if (!rec || rec.kind !== kind) return { ok: false, error: 'unknown' } as const;
      if (rec.used) return { ok: false, error: 'used' } as const;
      await this.ctx.storage.put('rec', { ...rec, used: true });
      if (rec.expiresAt <= now()) return { ok: false, error: 'expired' } as const;
      if (expect.gameId !== undefined && rec.gameId !== expect.gameId) return { ok: false, error: 'wrong_game' } as const;
      if (expect.bindHash !== undefined) {
        if (!rec.bindHash || typeof expect.bindHash !== 'string' || !safeEqual(rec.bindHash, expect.bindHash)) {
          return { ok: false, error: 'wrong_bind' } as const;
        }
      }
      return { ok: true, record: rec } as const;
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
