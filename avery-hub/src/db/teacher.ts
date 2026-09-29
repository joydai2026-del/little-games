// forTeacher(db, teacherId): every statement binds teacher_id = ?1, joins and
// counts included. The teacherId comes only from a session the hub resolved
// itself (src/auth/hub-session.ts, src/rpc/hub-service.ts), never from input.
import type { Db } from './index';

export interface TeacherProfile {
  id: string;
  email: string;
  display_name: string;
  free_game: string | null;
  free_game_locked_until: number | null;
  taste_day: string | null;
  taste_used: number;
  entitlement_version: number;
  manual_access_until: number | null;
  created_at: number;
}

export interface ListRow {
  id: string;
  title: string;
  level: string | null;
  items: unknown;
  created_at: number;
  updated_at: number;
}

export interface ClassRow {
  id: string;
  name: string;
  class_code: string;
  list_id: string | null;
  created_at: number;
}

export interface DeviceRow {
  id_hash: string;
  browser_label: string;
  created_at: number;
  last_used_at: number;
}

// "Is she paid right now?" as one SQL expression over ?1 (teacher) and ?2 (now).
// TODO(S2b): add live subscriptions via accessFor once Stripe lands.
const PAID_SQL = `(
  COALESCE((SELECT manual_access_until FROM teachers WHERE id = ?1), 0) > ?2
  OR EXISTS (SELECT 1 FROM seat_grants WHERE attached_teacher_id = ?1 AND access_until > ?2)
)`;

export function forTeacher(db: Db, teacherId: string) {
  const T = teacherId;
  return {
    teacherId: T,

    async profile(): Promise<TeacherProfile | null> {
      return db
        .prepare(
          `SELECT id, email, display_name, free_game, free_game_locked_until, taste_day, taste_used, entitlement_version, manual_access_until, created_at
           FROM teachers WHERE id = ?1 AND deleted_at IS NULL`,
        )
        .bind(T)
        .first<TeacherProfile>();
    },

    async isPaid(now: number): Promise<boolean> {
      const r = await db.prepare(`SELECT ${PAID_SQL} AS paid`).bind(T, now).first<{ paid: number }>();
      return r?.paid === 1;
    },

    // ---- devices (hub sessions) ----
    async devices(now: number, idleMs: number): Promise<DeviceRow[]> {
      const r = await db
        .prepare(
          `SELECT id_hash, browser_label, created_at, last_used_at FROM sessions
           WHERE teacher_id = ?1 AND revoked_at IS NULL AND absolute_expiry > ?2 AND last_used_at > ?3
           ORDER BY last_used_at DESC`,
        )
        .bind(T, now, now - idleMs)
        .all<DeviceRow>();
      return r.results;
    },
    async endDevice(idHash: string): Promise<boolean> {
      const r = await db.prepare(`DELETE FROM sessions WHERE teacher_id = ?1 AND id_hash = ?2`).bind(T, idHash).run();
      return r.meta.changes === 1;
    },
    async endAllDevices(): Promise<void> {
      await db.prepare(`DELETE FROM sessions WHERE teacher_id = ?1`).bind(T).run();
    },

    // ---- free game, taste ----
    /** Spend one taste round today. Single statement: at most `perDay` succeed however many race. */
    async useTaste(day: string, perDay: number): Promise<boolean> {
      const r = await db
        .prepare(
          `UPDATE teachers SET taste_day = ?1, taste_used = CASE WHEN taste_day = ?1 THEN taste_used + 1 ELSE 1 END
           WHERE id = ?2 AND deleted_at IS NULL AND (taste_day IS NULL OR taste_day <> ?1 OR taste_used < ?3)`,
        )
        .bind(day, T, perDay)
        .run();
      return r.meta.changes === 1;
    },
    /** Change her free game ("<gameId>:<mode>"), only when the cooldown has passed. Single statement. */
    async switchFreeGame(key: string, now: number, cooldownMs: number): Promise<boolean> {
      const r = await db
        .prepare(
          `UPDATE teachers SET free_game = ?1, free_game_locked_until = ?2
           WHERE id = ?3 AND deleted_at IS NULL AND (free_game_locked_until IS NULL OR free_game_locked_until <= ?4)
             AND (free_game IS NULL OR free_game <> ?1)`,
        )
        .bind(key, now + cooldownMs, T, now)
        .run();
      return r.meta.changes === 1;
    },

    // ---- lists ----
    async countLists(): Promise<number> {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM lists WHERE teacher_id = ?1 AND hidden = 0`).bind(T).first<{ n: number }>();
      return r?.n ?? 0;
    },
    async listLists(): Promise<Omit<ListRow, 'items'>[]> {
      const r = await db
        .prepare(`SELECT id, title, level, created_at, updated_at FROM lists WHERE teacher_id = ?1 AND hidden = 0 ORDER BY updated_at DESC`)
        .bind(T)
        .all<Omit<ListRow, 'items'>>();
      return r.results;
    },
    async getList(id: string): Promise<ListRow | null> {
      const r = await db
        .prepare(`SELECT id, title, level, items_json, created_at, updated_at FROM lists WHERE teacher_id = ?1 AND id = ?2 AND hidden = 0`)
        .bind(T, id)
        .first<Omit<ListRow, 'items'> & { items_json: string }>();
      if (!r) return null;
      const { items_json, ...rest } = r;
      return { ...rest, items: JSON.parse(items_json) };
    },
    /** New list, only while her visible lists are under `limit`. Single statement. */
    async insertList(l: { id: string; title: string; level: string | null; itemsJson: string }, now: number, limit: number): Promise<boolean> {
      const r = await db
        .prepare(
          `INSERT INTO lists (teacher_id, id, title, level, items_json, hidden, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, 0, ?6, ?6
           WHERE (SELECT COUNT(*) FROM lists WHERE teacher_id = ?1 AND hidden = 0) < ?7`,
        )
        .bind(T, l.id, l.title, l.level, l.itemsJson, now, limit)
        .run();
      return r.meta.changes === 1;
    },
    /** Replace one of her lists (always allowed; a free teacher may replace her list any time). */
    async updateList(l: { id: string; title: string; level: string | null; itemsJson: string }, now: number): Promise<boolean> {
      const r = await db
        .prepare(`UPDATE lists SET title = ?3, level = ?4, items_json = ?5, updated_at = ?6 WHERE teacher_id = ?1 AND id = ?2 AND hidden = 0`)
        .bind(T, l.id, l.title, l.level, l.itemsJson, now)
        .run();
      return r.meta.changes === 1;
    },
    async deleteList(id: string): Promise<boolean> {
      const r = await db.prepare(`DELETE FROM lists WHERE teacher_id = ?1 AND id = ?2`).bind(T, id).run();
      return r.meta.changes === 1;
    },

    // ---- classes (paid) ----
    async listClasses(): Promise<ClassRow[]> {
      const r = await db
        .prepare(`SELECT id, name, class_code, list_id, created_at FROM classes WHERE teacher_id = ?1 ORDER BY created_at`)
        .bind(T)
        .all<ClassRow>();
      return r.results;
    },
    /** New class; the paid check and the list ownership (composite FK) are enforced inside this one statement. */
    async insertClass(c: { id: string; name: string; code: string; listId: string | null }, now: number): Promise<boolean> {
      const r = await db
        .prepare(
          `INSERT INTO classes (teacher_id, id, class_code, list_id, name, created_at)
           SELECT ?1, ?3, ?4, ?5, ?6, ?2 WHERE ${PAID_SQL}`,
        )
        .bind(T, now, c.id, c.code, c.listId, c.name)
        .run();
      return r.meta.changes === 1;
    },
    async updateClass(c: { id: string; name: string; listId: string | null }, now: number): Promise<boolean> {
      const r = await db
        .prepare(`UPDATE classes SET name = ?3, list_id = ?4 WHERE teacher_id = ?1 AND id = ?5 AND ${PAID_SQL}`)
        .bind(T, now, c.name, c.listId, c.id)
        .run();
      return r.meta.changes === 1;
    },
    async deleteClass(id: string, now: number): Promise<boolean> {
      const r = await db.prepare(`DELETE FROM classes WHERE teacher_id = ?1 AND id = ?3 AND ${PAID_SQL}`).bind(T, now, id).run();
      return r.meta.changes === 1;
    },

    // ---- room passes ----
    async insertRoomPass(p: { hash: string; gameId: string; roomCode: string; modes: string[]; now: number; ttlMs: number }): Promise<boolean> {
      const r = await db
        .prepare(
          `INSERT INTO room_passes (id_hash, teacher_id, game_id, room_code, allowed_modes_json, entitlement_version, issued_at, expires_at)
           SELECT ?2, ?1, ?3, ?4, ?5, entitlement_version, ?6, ?7 FROM teachers WHERE id = ?1 AND deleted_at IS NULL`,
        )
        .bind(T, p.hash, p.gameId, p.roomCode, JSON.stringify(p.modes), p.now, p.now + p.ttlMs)
        .run();
      return r.meta.changes === 1;
    },

    // ---- lifecycle ----
    async exportAll(): Promise<Record<string, unknown>> {
      const [profile, lists, classes, history, subs] = await db.batch([
        db.prepare(`SELECT email, display_name, free_game, free_game_locked_until, created_at FROM teachers WHERE id = ?1`).bind(T),
        db.prepare(`SELECT id, title, level, items_json, hidden, created_at, updated_at FROM lists WHERE teacher_id = ?1`).bind(T),
        db.prepare(`SELECT id, name, class_code, list_id, created_at FROM classes WHERE teacher_id = ?1`).bind(T),
        db.prepare(`SELECT id, game_id, mode, list_id, class_id, started_at, player_count_band FROM round_history WHERE teacher_id = ?1`).bind(T),
        db.prepare(`SELECT status, current_period_end, cancel_at_period_end, access_until FROM subscriptions WHERE teacher_id = ?1`).bind(T),
      ]);
      return {
        profile: profile.results[0] ?? null,
        lists: (lists.results as { items_json: string }[]).map(({ items_json, ...l }) => ({ ...l, items: JSON.parse(items_json) })),
        classes: classes.results,
        history: history.results,
        subscriptions: subs.results,
      };
    },
    /**
     * Delete her account: one batch. Lists, classes, history, sessions (and by
     * cascade game sessions), room passes and checkout codes go; the teacher
     * row becomes a tombstone keeping only id, stripe_customer_id, deleted_at.
     * TODO(S2b): cancel any Stripe subscription first (plan "Teacher data lifecycle").
     */
    async tombstone(now: number): Promise<void> {
      await db.batch([
        db.prepare(`DELETE FROM round_history WHERE teacher_id = ?1`).bind(T),
        db.prepare(`DELETE FROM classes WHERE teacher_id = ?1`).bind(T),
        db.prepare(`DELETE FROM lists WHERE teacher_id = ?1`).bind(T),
        db.prepare(`DELETE FROM sessions WHERE teacher_id = ?1`).bind(T),
        db.prepare(`DELETE FROM room_passes WHERE teacher_id = ?1`).bind(T),
        db.prepare(`DELETE FROM checkout_codes WHERE teacher_id = ?1`).bind(T),
        db.prepare(`UPDATE seat_grants SET attached_teacher_id = NULL WHERE attached_teacher_id = ?1`).bind(T),
        db
          .prepare(
            `UPDATE teachers SET google_sub = NULL, email = NULL, display_name = NULL, analytics_id = NULL, free_game = NULL,
               free_game_locked_until = NULL, taste_day = NULL, taste_used = 0, manual_access_until = NULL,
               entitlement_version = entitlement_version + 1, deleted_at = ?2
             WHERE id = ?1`,
          )
          .bind(T, now),
      ]);
    },
  };
}

export type TeacherScope = ReturnType<typeof forTeacher>;
