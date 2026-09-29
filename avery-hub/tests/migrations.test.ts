// Schema rules from the plan's "Tables": every FK delete rule, the composite
// FKs, and the tombstone.
import { describe, it, expect } from 'vitest';
import { freshDb } from './support/fake-d1';
import { forTeacher } from '../src/db';

const NOW = 1_800_000_000_000;

function seedTeacher(db: ReturnType<typeof freshDb>, id: string) {
  db.raw.exec(`
    INSERT INTO teachers (id, google_sub, email, display_name, created_at, last_seen_at) VALUES ('${id}', 'sub-${id}', '${id}@s.org', '${id}', ${NOW}, ${NOW});
    INSERT INTO sessions (id_hash, teacher_id, key_version, browser_label, created_at, rotated_at, last_used_at, absolute_expiry) VALUES ('s-${id}', '${id}', 1, 'x', ${NOW}, ${NOW}, ${NOW}, ${NOW + 1e9});
    INSERT INTO game_sessions (id_hash, teacher_id, hub_session_id_hash, game_id, key_version, created_at, last_used_at, absolute_expiry) VALUES ('g-${id}', '${id}', 's-${id}', 'vocab', 1, ${NOW}, ${NOW}, ${NOW + 1e9});
    INSERT INTO lists (teacher_id, id, title, items_json, created_at, updated_at) VALUES ('${id}', 'L1', 't', '[]', ${NOW}, ${NOW});
    INSERT INTO classes (teacher_id, id, class_code, list_id, name, created_at) VALUES ('${id}', 'C1', 'CODE-${id}', 'L1', 'c', ${NOW});
    INSERT INTO round_history (teacher_id, id, game_id, mode, list_id, class_id, started_at) VALUES ('${id}', 'H1', 'vocab', 'race', 'L1', 'C1', ${NOW});
    INSERT INTO checkout_codes (code_hash, teacher_id, expires_at) VALUES ('cc-${id}', '${id}', ${NOW});
    INSERT INTO room_passes (id_hash, teacher_id, game_id, room_code, allowed_modes_json, entitlement_version, issued_at, expires_at) VALUES ('rp-${id}', '${id}', 'vocab', 'ABCD', '[]', 0, ${NOW}, ${NOW + 1});
    INSERT INTO seat_grants (email, school_ref, access_until, granted_by, attached_teacher_id) VALUES ('${id}@s.org', 'PS1', ${NOW + 1}, 'admin', '${id}');
  `);
}
const count = (db: ReturnType<typeof freshDb>, table: string, where = '1=1') =>
  Number((db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n);

describe('migrations', () => {
  it('deleting a teacher (hard delete, no billing rows) cascades or nulls every child table', () => {
    const db = freshDb();
    seedTeacher(db, 'a');
    seedTeacher(db, 'b');
    db.raw.exec(`DELETE FROM teachers WHERE id = 'a'`);
    for (const t of ['sessions', 'game_sessions', 'lists', 'classes', 'round_history', 'checkout_codes', 'room_passes']) {
      expect(count(db, t, `teacher_id = 'a'`), t).toBe(0);
      expect(count(db, t, `teacher_id = 'b'`), `${t} of b`).toBe(1);
    }
    expect(count(db, 'seat_grants', `email = 'a@s.org'`)).toBe(1);
    expect(count(db, 'seat_grants', `email = 'a@s.org' AND attached_teacher_id IS NULL`)).toBe(1);
  });

  it('billing rows RESTRICT a hard delete (a teacher is tombstoned instead)', () => {
    const db = freshDb();
    seedTeacher(db, 'a');
    db.raw.exec(`INSERT INTO subscriptions (stripe_subscription_id, teacher_id, status) VALUES ('sub_1', 'a', 'active')`);
    expect(() => db.raw.exec(`DELETE FROM teachers WHERE id = 'a'`)).toThrow(/FOREIGN KEY/);
    db.raw.exec(`DELETE FROM subscriptions`);
    db.raw.exec(`INSERT INTO billing_ops (op_id, teacher_id, kind, status) VALUES ('op1', 'a', 'refund', 'done')`);
    expect(() => db.raw.exec(`DELETE FROM teachers WHERE id = 'a'`)).toThrow(/FOREIGN KEY/);
  });

  it('deleting a list or class nulls only the link, keeping the class and history', () => {
    const db = freshDb();
    seedTeacher(db, 'a');
    db.raw.exec(`DELETE FROM lists WHERE teacher_id = 'a' AND id = 'L1'`);
    expect(db.raw.prepare(`SELECT teacher_id, list_id FROM classes WHERE id = 'C1'`).get()).toEqual({ teacher_id: 'a', list_id: null });
    expect(db.raw.prepare(`SELECT teacher_id, list_id FROM round_history WHERE id = 'H1'`).get()).toEqual({ teacher_id: 'a', list_id: null });
    db.raw.exec(`DELETE FROM classes WHERE teacher_id = 'a' AND id = 'C1'`);
    expect(db.raw.prepare(`SELECT class_id FROM round_history WHERE id = 'H1'`).get()).toEqual({ class_id: null });
  });

  it('game_sessions composite FK refuses a game session whose teacher differs from its hub session', () => {
    const db = freshDb();
    seedTeacher(db, 'a');
    seedTeacher(db, 'b');
    expect(() =>
      db.raw.exec(`INSERT INTO game_sessions (id_hash, teacher_id, hub_session_id_hash, game_id, key_version, created_at, last_used_at, absolute_expiry)
        VALUES ('g-x', 'b', 's-a', 'vocab', 1, 1, 1, 2)`),
    ).toThrow(/FOREIGN KEY/);
  });

  it("a class of A's cannot point at B's list (composite FK)", () => {
    const db = freshDb();
    seedTeacher(db, 'a');
    db.raw.exec(`INSERT INTO teachers (id, google_sub, created_at, last_seen_at) VALUES ('b2', 'sub-b2', 1, 1)`);
    db.raw.exec(`INSERT INTO lists (teacher_id, id, title, items_json, created_at, updated_at) VALUES ('b2', 'LB', 't', '[]', 1, 1)`);
    expect(() => db.raw.exec(`INSERT INTO classes (teacher_id, id, class_code, list_id, name, created_at) VALUES ('a', 'C9', 'Z9', 'LB', 'c', 1)`)).toThrow(/FOREIGN KEY/);
  });

  it('a live teacher must have a Google sub; a tombstone may not', () => {
    const db = freshDb();
    expect(() => db.raw.exec(`INSERT INTO teachers (id, created_at, last_seen_at) VALUES ('x', 1, 1)`)).toThrow(/CHECK/);
    db.raw.exec(`INSERT INTO teachers (id, created_at, last_seen_at, deleted_at) VALUES ('x', 1, 1, 1)`);
  });

  it('tombstone keeps id, stripe customer and billing rows; drops everything else', async () => {
    const db = freshDb();
    seedTeacher(db, 'a');
    seedTeacher(db, 'b');
    db.raw.exec(`UPDATE teachers SET stripe_customer_id = 'cus_a', analytics_id = 'an_a', free_game = 'vocab:race' WHERE id = 'a'`);
    db.raw.exec(`INSERT INTO subscriptions (stripe_subscription_id, teacher_id, status) VALUES ('sub_1', 'a', 'canceled')`);
    await forTeacher(db, 'a').tombstone(NOW);
    expect(db.raw.prepare(`SELECT * FROM teachers WHERE id = 'a'`).get()).toMatchObject({
      id: 'a', stripe_customer_id: 'cus_a', google_sub: null, email: null, display_name: null, analytics_id: null, free_game: null, deleted_at: NOW,
    });
    for (const t of ['sessions', 'game_sessions', 'lists', 'classes', 'round_history', 'checkout_codes']) {
      expect(count(db, t, `teacher_id = 'a'`), t).toBe(0);
      expect(count(db, t, `teacher_id = 'b'`), `${t} of b`).toBe(1);
    }
    // Kept so checkRoomPass answers "revoked" (the version bump), not "unknown".
    expect(count(db, 'room_passes', `teacher_id = 'a'`)).toBe(1);
    expect(count(db, 'subscriptions', `teacher_id = 'a'`)).toBe(1);
    // No personal timestamps left on the tombstone.
    expect(db.raw.prepare(`SELECT created_at, last_seen_at FROM teachers WHERE id = 'a'`).get()).toEqual({ created_at: NOW, last_seen_at: NOW });
  });
});
