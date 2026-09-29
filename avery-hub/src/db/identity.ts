// Lookups that run BEFORE we know which teacher is asking: sign-in by Google
// `sub`, and resolving a presented hub session, game session or room pass
// hash. Each returns the teacher id the hub then passes to forTeacher().
import type { Db } from './index';

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

/** Find the teacher by Google `sub` (never by email) or create her; refresh email and name. */
export async function upsertTeacherBySub(db: Db, who: GoogleIdentity, now: number): Promise<string> {
  const id = crypto.randomUUID();
  const row = await db
    .prepare(
      `INSERT INTO teachers (id, google_sub, email, display_name, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, last_seen_at = excluded.last_seen_at
       RETURNING id`,
    )
    .bind(id, who.sub, who.email, who.name, now)
    .first<{ id: string }>();
  if (!row) throw new Error('teacher upsert returned nothing');
  // School purchase-order seats: attach a waiting seat for her verified email.
  await db
    .prepare(`UPDATE seat_grants SET attached_teacher_id = ?1 WHERE lower(email) = lower(?2) AND attached_teacher_id IS NULL AND access_until > ?3`)
    .bind(row.id, who.email, now)
    .run();
  return row.id;
}

export interface HubSessionRow {
  id_hash: string;
  teacher_id: string;
  key_version: number;
  rotated_at: number;
  last_used_at: number;
  absolute_expiry: number;
}

export async function createHubSession(
  db: Db,
  s: { teacherId: string; hash: string; version: number; label: string; now: number; maxMs: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id_hash, teacher_id, key_version, browser_label, created_at, rotated_at, last_used_at, absolute_expiry)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?6)`,
    )
    .bind(s.hash, s.teacherId, s.version, s.label, s.now, s.now + s.maxMs)
    .run();
}

/** A live hub session of a live teacher, or null. Touches last_used_at. */
export async function resolveHubSession(db: Db, hash: string, now: number, idleMs: number): Promise<HubSessionRow | null> {
  const row = await db
    .prepare(
      `SELECT s.id_hash, s.teacher_id, s.key_version, s.rotated_at, s.last_used_at, s.absolute_expiry
       FROM sessions s JOIN teachers t ON t.id = s.teacher_id
       WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.absolute_expiry > ?2 AND s.last_used_at > ?3 AND t.deleted_at IS NULL`,
    )
    .bind(hash, now, now - idleMs)
    .first<HubSessionRow>();
  if (!row) return null;
  await db.prepare(`UPDATE sessions SET last_used_at = ?2 WHERE id_hash = ?1`).bind(hash, now).run();
  return row;
}

/** New id for the same hub session; its game sessions follow (ON UPDATE CASCADE). */
export async function rotateHubSession(db: Db, oldHash: string, newHash: string, version: number, now: number): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE sessions SET id_hash = ?2, key_version = ?3, rotated_at = ?4 WHERE id_hash = ?1 AND revoked_at IS NULL`)
    .bind(oldHash, newHash, version, now)
    .run();
  return r.meta.changes === 1;
}

/** End one hub session and (by cascade) every game session made from it. */
export async function endHubSession(db: Db, hash: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE id_hash = ?1`).bind(hash).run();
}

export async function createGameSession(
  db: Db,
  g: { hash: string; version: number; teacherId: string; hubHash: string; gameId: string; now: number; maxMs: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO game_sessions (id_hash, teacher_id, hub_session_id_hash, game_id, key_version, created_at, last_used_at, absolute_expiry)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)`,
    )
    .bind(g.hash, g.teacherId, g.hubHash, g.gameId, g.version, g.now, g.now + g.maxMs)
    .run();
}

export interface GameSessionRow {
  teacher_id: string;
  hub_session_id_hash: string;
  game_id: string;
  email: string;
  display_name: string;
}

/**
 * A live game session minted for THIS game (audience check), whose hub session
 * is also live, for a live teacher. Touches both last-used stamps.
 */
export async function resolveGameSession(
  db: Db,
  hash: string,
  gameId: string,
  now: number,
  idle: { game: number; hub: number },
): Promise<GameSessionRow | null> {
  const row = await db
    .prepare(
      `SELECT g.teacher_id, g.hub_session_id_hash, g.game_id, t.email, t.display_name
       FROM game_sessions g
       JOIN sessions s ON s.teacher_id = g.teacher_id AND s.id_hash = g.hub_session_id_hash
       JOIN teachers t ON t.id = g.teacher_id
       WHERE g.id_hash = ?1 AND g.game_id = ?2 AND g.revoked_at IS NULL AND g.absolute_expiry > ?3 AND g.last_used_at > ?4
         AND s.revoked_at IS NULL AND s.absolute_expiry > ?3 AND s.last_used_at > ?5
         AND t.deleted_at IS NULL`,
    )
    .bind(hash, gameId, now, now - idle.game, now - idle.hub)
    .first<GameSessionRow>();
  if (!row) return null;
  await db.batch([
    db.prepare(`UPDATE game_sessions SET last_used_at = ?2 WHERE id_hash = ?1`).bind(hash, now),
    db.prepare(`UPDATE sessions SET last_used_at = ?2 WHERE id_hash = ?1`).bind(row.hub_session_id_hash, now),
  ]);
  return row;
}

export interface RoomPassCheck {
  valid: boolean;
  reason?: 'unknown' | 'expired' | 'revoked';
  roomCode?: string;
  allowedModes?: string[];
  expiresAt?: number;
}

/** Is this pass (for THIS game) still good? Revoked when the teacher's entitlement version moved or she was deleted. */
export async function checkRoomPassRow(db: Db, hash: string, gameId: string, now: number): Promise<RoomPassCheck> {
  const row = await db
    .prepare(
      `SELECT p.room_code, p.allowed_modes_json, p.expires_at, p.entitlement_version AS pv, t.entitlement_version AS tv, t.deleted_at
       FROM room_passes p JOIN teachers t ON t.id = p.teacher_id
       WHERE p.id_hash = ?1 AND p.game_id = ?2`,
    )
    .bind(hash, gameId)
    .first<{ room_code: string; allowed_modes_json: string; expires_at: number; pv: number; tv: number; deleted_at: number | null }>();
  if (!row) return { valid: false, reason: 'unknown' };
  if (row.deleted_at !== null || row.pv !== row.tv) return { valid: false, reason: 'revoked' };
  if (row.expires_at <= now) return { valid: false, reason: 'expired' };
  return { valid: true, roomCode: row.room_code, allowedModes: JSON.parse(row.allowed_modes_json) as string[], expiresAt: row.expires_at };
}

export async function teacherExists(db: Db, teacherId: string): Promise<boolean> {
  const r = await db.prepare(`SELECT 1 AS ok FROM teachers WHERE id = ?1 AND deleted_at IS NULL`).bind(teacherId).first();
  return r !== null;
}
