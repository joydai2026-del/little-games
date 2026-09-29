// SQL for JJ's admin tools. Lives in src/db (the only place allowed to touch
// the database) but is imported ONLY by src/admin/ (tests/structure.test.ts).
import type { Db } from './index';

function log(db: Db, a: { actor: string; action: string; target: string | null; reason: string; now: number }) {
  return db
    .prepare(`INSERT INTO admin_log (id, actor, action, target_teacher_id, reason, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(crypto.randomUUID(), a.actor, a.action, a.target, a.reason, a.now);
}

export async function adminGrantAccess(db: Db, actor: string, teacherId: string, until: number, reason: string, now: number): Promise<boolean> {
  const [r] = await db.batch([
    db
      .prepare(`UPDATE teachers SET manual_access_until = ?2, entitlement_version = entitlement_version + 1 WHERE id = ?1 AND deleted_at IS NULL`)
      .bind(teacherId, until),
    log(db, { actor, action: 'grantAccess', target: teacherId, reason: `${reason} (until ${new Date(until).toISOString()})`, now }),
  ]);
  return r.meta.changes === 1;
}

export async function adminRevokeAccess(db: Db, actor: string, teacherId: string, reason: string, now: number): Promise<boolean> {
  const [r] = await db.batch([
    db
      .prepare(`UPDATE teachers SET manual_access_until = NULL, entitlement_version = entitlement_version + 1 WHERE id = ?1 AND deleted_at IS NULL`)
      .bind(teacherId),
    db.prepare(`DELETE FROM sessions WHERE teacher_id = ?1`).bind(teacherId),
    log(db, { actor, action: 'revokeAccess', target: teacherId, reason, now }),
  ]);
  return r.meta.changes === 1;
}

/**
 * Move everything of `from` onto `to` (lost school account). One batch: lists
 * (classes and history follow by ON UPDATE CASCADE), the rest of classes and
 * history, subscriptions, billing ops, seats, Stripe customer id; every
 * session of `from` is ended. Its room passes stay and read as revoked (version bump). TODO(S2b): update the Stripe customer metadata.
 */
export async function adminMoveTeacher(db: Db, actor: string, from: string, to: string, reason: string, now: number): Promise<'ok' | 'not_found' | 'both_have_stripe'> {
  const rows = await db
    .prepare(`SELECT id, stripe_customer_id FROM teachers WHERE id IN (?1, ?2) AND deleted_at IS NULL`)
    .bind(from, to)
    .all<{ id: string; stripe_customer_id: string | null }>();
  if (from === to || rows.results.length !== 2) return 'not_found';
  const f = rows.results.find((r) => r.id === from)!;
  const t = rows.results.find((r) => r.id === to)!;
  if (f.stripe_customer_id && t.stripe_customer_id) return 'both_have_stripe';
  await db.batch([
    // Moving lists cascades history rows to `to` while their classes still sit
    // under `from`; defer the FK checks to the end of this transaction.
    db.prepare(`PRAGMA defer_foreign_keys = ON`),
    db.prepare(`UPDATE lists SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(from, to),
    db.prepare(`UPDATE classes SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(from, to),
    db.prepare(`UPDATE round_history SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(from, to),
    db.prepare(`UPDATE subscriptions SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(from, to),
    db.prepare(`UPDATE billing_ops SET teacher_id = ?2 WHERE teacher_id = ?1`).bind(from, to),
    db.prepare(`UPDATE seat_grants SET attached_teacher_id = ?2 WHERE attached_teacher_id = ?1`).bind(from, to),
    db.prepare(`UPDATE teachers SET stripe_customer_id = NULL WHERE id = ?1`).bind(from),
    db.prepare(`UPDATE teachers SET stripe_customer_id = COALESCE(stripe_customer_id, ?2), entitlement_version = entitlement_version + 1 WHERE id = ?1`).bind(to, f.stripe_customer_id),
    db.prepare(`UPDATE teachers SET entitlement_version = entitlement_version + 1 WHERE id = ?1`).bind(from),
    db.prepare(`DELETE FROM sessions WHERE teacher_id = ?1`).bind(from),
    log(db, { actor, action: 'moveTeacher', target: to, reason: `${reason} (from ${from})`, now }),
  ]);
  return 'ok';
}

export async function adminGrantSeats(db: Db, actor: string, emails: string[], until: number, school: string, now: number): Promise<number> {
  const stmts = emails.map((e) =>
    db
      .prepare(
        `INSERT INTO seat_grants (email, school_ref, access_until, granted_by, attached_teacher_id)
         VALUES (lower(?1), ?2, ?3, ?4, (SELECT id FROM teachers WHERE lower(email) = lower(?1) AND deleted_at IS NULL LIMIT 1))
         ON CONFLICT(email, school_ref) DO UPDATE SET access_until = excluded.access_until, granted_by = excluded.granted_by`,
      )
      .bind(e, school, until, actor),
  );
  await db.batch([...stmts, log(db, { actor, action: 'grantSeats', target: null, reason: `${school}: ${emails.length} seat(s) until ${new Date(until).toISOString()}`, now })]);
  return emails.length;
}
