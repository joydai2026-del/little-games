// Retention clean-up run by the daily cron (src/cleanup.ts).
import type { Db } from './index';

/**
 * School seat grants keep the school roster email until the seat expires plus
 * SEAT_GRANT_RETENTION_DAYS (the school's purchase record); then the row goes.
 */
export async function purgeExpiredSeatGrants(db: Db, now: number, retentionMs: number): Promise<number> {
  const r = await db.prepare(`DELETE FROM seat_grants WHERE access_until < ?1`).bind(now - retentionMs).run();
  return r.meta.changes;
}
