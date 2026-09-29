// The daily clean-up (cron in wrangler.jsonc). TODO(later slice): expired
// sessions, game sessions and room passes; INACTIVE_DELETE_DAYS profiles.
import type { Env } from './env';
import { policy } from './config';
import { openDb } from './db';
import { purgeExpiredSeatGrants } from './db/cleanup';
import { now } from './clock';

const DAY = 86_400_000;

export async function runCleanup(env: Env): Promise<{ seatGrants: number }> {
  const p = policy(env);
  if (!p.dbReady) return { seatGrants: 0 };
  if (p.seatGrantRetentionDays === null) {
    // Invalid config: delete nothing (fail closed) and say so loudly.
    throw new Error('SEAT_GRANT_RETENTION_DAYS is invalid (whole number 30 to 3650 required); nothing deleted');
  }
  const seatGrants = await purgeExpiredSeatGrants(openDb(env), now(), p.seatGrantRetentionDays * DAY);
  return { seatGrants };
}
