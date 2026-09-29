// Reach the TokenDO named by a token's HMAC.
import type { Env } from '../env';
import type { TokenRecord, TakeResult, TokenKind } from '../do/token-do';

export function tokenObject(env: Env, hash: string) {
  return env.TOKENS.get(env.TOKENS.idFromName(hash));
}

export async function createToken(env: Env, hash: string, rec: TokenRecord): Promise<void> {
  await tokenObject(env, hash).create(rec);
}

export async function takeToken(env: Env, hash: string, kind: TokenKind, expect: { gameId?: string | null; bindHash?: string | null }): Promise<TakeResult> {
  return (await tokenObject(env, hash).take(kind, expect)) as TakeResult;
}
