-- avery-hub schema v1. Additive only from here on: new tables and columns in
-- new numbered files; never drop or rename in the same release.
-- Every foreign key has an explicit delete rule. Deleting a teacher in the app
-- is a TOMBSTONE (src/db/teacher.ts), not a DELETE; the delete rules below
-- still matter for admin clean-up and are proven by tests/migrations.test.ts.

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  -- Google's `sub`. Nullable only for a tombstone (the plan's NOT NULL
  -- conflicts with its tombstone rule, which nulls it); the CHECK keeps a live
  -- teacher from ever lacking it.
  google_sub TEXT UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  analytics_id TEXT UNIQUE,
  email TEXT,
  display_name TEXT,
  -- "<gameId>:<mode>", e.g. "vocab:race" or "trace-race:main". NULL = not chosen.
  free_game TEXT,
  free_game_locked_until INTEGER,
  taste_day TEXT,
  taste_used INTEGER NOT NULL DEFAULT 0,
  entitlement_version INTEGER NOT NULL DEFAULT 0,
  -- JJ's manual unlock (admin grantAccess). Subscriptions arrive in S2b.
  manual_access_until INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (deleted_at IS NOT NULL OR google_sub IS NOT NULL)
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  browser_label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  absolute_expiry INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE (teacher_id, id_hash)
);
CREATE INDEX sessions_teacher ON sessions(teacher_id);

-- The composite FK makes the database refuse a game session whose teacher
-- differs from its hub session's teacher. ON UPDATE CASCADE lets a hub
-- session id rotate without orphaning its game sessions.
CREATE TABLE game_sessions (
  id_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  hub_session_id_hash TEXT NOT NULL,
  game_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  absolute_expiry INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (teacher_id, hub_session_id_hash)
    REFERENCES sessions(teacher_id, id_hash) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX game_sessions_hub ON game_sessions(hub_session_id_hash);

CREATE TABLE lists (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  level TEXT,
  items_json TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, id)
);

-- SQLite's ON DELETE SET NULL would null every column of a composite FK
-- (teacher_id included), so the plan's "SET NULL (list_id only)" is done by
-- the BEFORE DELETE triggers below; the FK itself stays NO ACTION.
CREATE TABLE classes (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  class_code TEXT NOT NULL UNIQUE,
  list_id TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, id),
  FOREIGN KEY (teacher_id, list_id) REFERENCES lists(teacher_id, id) ON UPDATE CASCADE
);

CREATE TABLE round_history (
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  list_id TEXT,
  class_id TEXT,
  started_at INTEGER NOT NULL,
  player_count_band TEXT,
  PRIMARY KEY (teacher_id, id),
  FOREIGN KEY (teacher_id, list_id) REFERENCES lists(teacher_id, id) ON UPDATE CASCADE,
  FOREIGN KEY (teacher_id, class_id) REFERENCES classes(teacher_id, id) ON UPDATE CASCADE
);

CREATE TRIGGER lists_delete_unlink BEFORE DELETE ON lists
BEGIN
  UPDATE classes SET list_id = NULL WHERE teacher_id = OLD.teacher_id AND list_id = OLD.id;
  UPDATE round_history SET list_id = NULL WHERE teacher_id = OLD.teacher_id AND list_id = OLD.id;
END;

CREATE TRIGGER classes_delete_unlink BEFORE DELETE ON classes
BEGIN
  UPDATE round_history SET class_id = NULL WHERE teacher_id = OLD.teacher_id AND class_id = OLD.id;
END;

CREATE TABLE subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  price_id TEXT,
  status TEXT NOT NULL,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  latest_charge_id TEXT,
  refunded_full INTEGER NOT NULL DEFAULT 0,
  dispute_state TEXT,
  access_until INTEGER,
  synced_at INTEGER
);
CREATE INDEX subscriptions_teacher ON subscriptions(teacher_id);

CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  customer_id TEXT,
  object_id TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE TABLE billing_ops (
  op_id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  step TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE checkout_codes (
  code_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  checkout_session_id TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE seat_grants (
  email TEXT NOT NULL,
  school_ref TEXT NOT NULL,
  access_until INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  attached_teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  PRIMARY KEY (email, school_ref)
);

-- Not in the plan's table list: the hub must remember each room pass so
-- checkRoomPass can answer "revoked" after a refund or deletion.
CREATE TABLE room_passes (
  id_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  allowed_modes_json TEXT NOT NULL,
  entitlement_version INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX room_passes_teacher ON room_passes(teacher_id);

CREATE TABLE admin_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_teacher_id TEXT,
  reason TEXT,
  at INTEGER NOT NULL
);
