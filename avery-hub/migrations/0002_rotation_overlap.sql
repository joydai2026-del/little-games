-- Additive. A rotated hub session id keeps resolving for a short overlap
-- (SESSION_ROTATE_OVERLAP_SECONDS) so two requests racing at rotation time
-- are not signed out.
ALTER TABLE sessions ADD COLUMN previous_id_hash TEXT;
ALTER TABLE sessions ADD COLUMN previous_valid_until INTEGER;
CREATE INDEX sessions_previous ON sessions(previous_id_hash);
