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
  const retentionDays = Number(env.SEAT_GRANT_RETENTION_DAYS ?? 400);
  const seatGrants = await purgeExpiredSeatGrants(openDb(env), now(), (Number.isFinite(retentionDays) ? retentionDays : 400) * DAY);
  return { seatGrants };
}
