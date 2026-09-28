// The whole game as pure functions. The Durable Object only persists, checks
// secrets, loads stroke data, reads the clock and arms the alarm; every rule is
// here so it can be unit-tested without Cloudflare.
//
// The ROOM is the authority (Codex review of PR #20, 2026-09-28):
//   - Writers never receive the word, its stroke counts, or the round's other
//     words: publicView builds a per-viewer MyRound (audio handle, grid count,
//     accepted strokes as geometry, Easy's outline after hearing).
//   - A stroke is sent as the POINTS drawn; the room grades it against the
//     target stroke's median with the shared matcher (src/shared/matcher.ts,
//     the same file as Missing Stroke). A verdict sent by a caller is refused.
//   - The word clock starts when the room first serves that player the word's
//     audio; strokes before that, or after the deadline, are refused, and a
//     word past its deadline closes as skipped.
//   - A skipped word scores 0: correct strokes earned on it are taken back.

import { GAME, WORD_CLOCK, normalizeOptions, type DashOptions } from './config';
import { gradeStroke, parsePoints, type Point } from './matcher';
import type { CharGeom, Mode, MyRound, Player, Progress, PublicList, PublicState, RoomState, Standing, WordList } from './types';

export interface Result {
  state: RoomState;
  error?: string;
  /** HTTP-ish status for the error: 400 bad input, 403 not allowed, 409 wrong moment, 429 too fast. */
  status?: number;
  /** The same send arrived again (a retry): nothing changed. */
  duplicate?: boolean;
  /** The room's verdict on a drawn stroke. */
  verdict?: 'correct' | 'mistake';
}

const bump = (s: RoomState): RoomState => ({ ...s, version: s.version + 1 });
const fail = (state: RoomState, error: string, status: number): Result => ({ state, error, status });
const ttlMs = () => GAME.roomTtlMinutes * 60_000;

export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GAME.maxNameLength)
    .trim();
}

function uniqueName(players: Player[], name: string): string {
  const taken = new Set(players.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const candidate = `${name.slice(0, GAME.maxNameLength - 3)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

export function freshProgress(): Progress {
  return {
    wordIndex: 0,
    charIndex: 0,
    strokeIndex: 0,
    wordsDone: 0,
    wordsSkipped: 0,
    mistakes: 0,
    strokeMisses: 0,
    helped: 0,
    wordMisses: 0,
    lastGradedAt: null,
    drawn: [],
    serveFailed: false,
    strokesDone: 0,
    scoreStrokes: 0,
    wordStrokes: 0,
    heardAt: null,
    deadlineAt: null,
    finishedAt: null,
    lastProgressAt: null,
    wordStartProgressAt: null,
    results: [],
    seq: 0,
  };
}

/** Everyone who writes: kids in a class room, the one player in a solo room. */
export function writers(state: RoomState): Player[] {
  return state.players.filter((p) => p.role === 'kid');
}

/** THE list of writers who are here: the teacher's "Kids here" AND the next Start roster. */
export function presentWriters(state: RoomState, now: number): Player[] {
  return writers(state).filter((k) => now - k.lastSeenAt <= GAME.rosterActiveMs);
}

export function createRoom(
  code: string,
  host: { id: string; name: string },
  mode: Mode,
  options: Partial<Record<keyof DashOptions, unknown>> | undefined,
  list: WordList,
  now: number
): RoomState {
  const solo = mode === 'solo';
  return {
    code,
    mode,
    version: 1,
    hostId: host.id,
    createdAt: now,
    expiresAt: now + ttlMs(),
    phase: 'lobby',
    options: normalizeOptions(options),
    list,
    round: 0,
    cursor: 0,
    roundWords: [],
    goAt: null,
    endsAt: null,
    endedAt: null,
    players: [
      { id: host.id, name: cleanName(host.name) || (solo ? 'Me' : 'Teacher'), role: solo ? 'kid' : 'teacher', agent: false, joinedAt: now, lastSeenAt: now },
    ],
    progress: {},
  };
}

export function join(state: RoomState, who: { id: string; name: string; agent?: boolean }, now: number): Result {
  if (state.mode === 'solo') return fail(state, 'this is a practice room for one', 409);
  const name = cleanName(who.name);
  if (!name) return fail(state, 'please type your name', 400);
  // The rate is checked BEFORE fullness, and is below the seat count: a script cannot take every seat at once.
  const recent = state.players.filter((p) => p.role === 'kid' && now - p.joinedAt < 60_000).length;
  if (recent >= GAME.joinsPerMinute) return fail(state, 'too many people joined at once, wait a minute and try again', 429);
  if (writers(state).length >= GAME.maxKids) return fail(state, 'this room is full', 409);
  const player: Player = { id: who.id, name: uniqueName(state.players, name), role: 'kid', agent: who.agent === true, joinedAt: now, lastSeenAt: now };
  // No progress entry: a kid who joins mid-round watches and writes the next one.
  return { state: bump({ ...state, players: [...state.players, player] }) };
}

/** A new list starts from its first word again (the round counter keeps going: it is the send id). */
export function setList(state: RoomState, byId: string, list: WordList): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change the list', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this round to end', 409);
  return { state: bump({ ...state, list, cursor: 0 }) };
}

export function setOptions(state: RoomState, byId: string, input: Partial<Record<keyof DashOptions, unknown>>): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change settings', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this round to end', 409);
  return { state: bump({ ...state, options: normalizeOptions(input, state.options) }) };
}

/**
 * The next round's words: `perRound` words from `cursor`, wrapping, never
 * repeating inside a round. The cursor (not the round number) plans rounds, so
 * changing words-per-round never skips or repeats a word, and a new list
 * starts at its top.
 */
export function wordsForRound(list: string[], cursor: number, perRound: number): string[] {
  if (list.length === 0) return [];
  const count = Math.min(perRound, list.length);
  return Array.from({ length: count }, (_, i) => list[(cursor + i) % list.length]);
}

/** The characters the room must have stroke data for before the next round can start. */
export function nextRoundChars(state: RoomState): string[] {
  const words = wordsForRound(state.list.words, state.cursor, state.options.wordsPerRound);
  return [...new Set(words.flatMap((w) => [...w]))];
}

/** Strokes in a whole word (0 for a character with no count). */
export function wordStrokes(word: string, strokeCounts: Record<string, number>): number {
  return [...word].reduce((n, ch) => n + (strokeCounts[ch] ?? 0), 0);
}

/**
 * One word's clock, in ms: the teacher's base seconds + seconds per stroke
 * (per level) x the word's strokes, rounded UP to a whole bucket.
 */
export function wordClockMs(options: DashOptions, strokes: number): number {
  const raw = options.secondsPerWord + WORD_CLOCK.secondsPerStroke[options.level] * strokes;
  return Math.ceil(raw / WORD_CLOCK.bucketSeconds) * WORD_CLOCK.bucketSeconds * 1000;
}

/** How long a round may run, in ms: every word's clock plus time to hear it. */
export function roundMs(options: DashOptions, words: string[], strokeCounts: Record<string, number>): number {
  return words.reduce((ms, w) => ms + wordClockMs(options, wordStrokes(w, strokeCounts)) + GAME.hearSlackSeconds * 1000, 0);
}

/** Lobby -> racing (Start) and done -> racing (Next round). */
export function startRound(state: RoomState, byId: string, now: number): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can start', 403);
  if (state.phase === 'racing') return fail(state, 'the round is already on', 409);
  if (state.list.words.length === 0) return fail(state, 'the list has no words we can write yet', 409);
  const active = presentWriters(state, now);
  if (active.length === 0) return fail(state, 'wait for at least one kid to join', 409);
  const roundWords = wordsForRound(state.list.words, state.cursor, state.options.wordsPerRound);
  const goAt = now + GAME.countdownSeconds * 1000;
  const endsAt = goAt + roundMs(state.options, roundWords, state.list.strokeCounts);
  const progress: Record<string, Progress> = {};
  for (const kid of active) progress[kid.id] = freshProgress();
  return {
    state: bump({
      ...state,
      phase: 'racing',
      round: state.round + 1,
      cursor: (state.cursor + roundWords.length) % state.list.words.length,
      roundWords,
      goAt,
      endsAt,
      endedAt: null,
      expiresAt: Math.max(state.expiresAt, endsAt + ttlMs()),
      progress,
    }),
  };
}

export function roundPlayers(state: RoomState): Player[] {
  return writers(state).filter((k) => state.progress[k.id] !== undefined);
}

export function allFinished(state: RoomState): boolean {
  const list = roundPlayers(state);
  return list.length > 0 && list.every((k) => state.progress[k.id]!.finishedAt != null);
}

/** Closes the current word: written, or skipped (its strokes are taken back). */
function closeWord(state: RoomState, prog: Progress, now: number, written: boolean): Progress {
  const next: Progress = {
    ...prog,
    wordIndex: prog.wordIndex + 1,
    charIndex: 0,
    strokeIndex: 0,
    strokeMisses: 0,
    wordMisses: 0,
    drawn: [],
    serveFailed: false,
    heardAt: null,
    deadlineAt: null,
    wordsDone: prog.wordsDone + (written ? 1 : 0),
    wordsSkipped: prog.wordsSkipped + (written ? 0 : 1),
    scoreStrokes: written ? prog.scoreStrokes : prog.scoreStrokes - prog.wordStrokes,
    lastProgressAt: written ? prog.lastProgressAt : prog.wordStartProgressAt,
    wordStrokes: 0,
    results: [...prog.results, written ? 'written' : 'skipped'],
  };
  next.wordStartProgressAt = next.lastProgressAt;
  return next.wordIndex >= state.roundWords.length ? { ...next, finishedAt: now } : next;
}

/**
 * The clock: a word past its deadline closes as skipped, then the round ends
 * when time is up or everyone is done. Returns the same object when nothing changed.
 */
export function advanceIfDue(state: RoomState, now: number): RoomState {
  if (state.phase !== 'racing') return state;
  let changed = false;
  const progress = { ...state.progress };
  for (const [id, p] of Object.entries(progress)) {
    if (p.finishedAt == null && p.deadlineAt != null && now >= p.deadlineAt) {
      progress[id] = closeWord(state, p, p.deadlineAt, false);
      changed = true;
    }
  }
  let next = changed ? bump({ ...state, progress }) : state;
  if ((next.endsAt != null && now >= next.endsAt) || allFinished(next)) {
    next = bump({ ...next, phase: 'done', endedAt: now, expiresAt: Math.max(next.expiresAt, now + ttlMs()) });
  }
  return next;
}

/**
 * The room served player `playerId` the audio of word `index`. The first time
 * for the current word, its clock starts. Returns the same object when nothing changed.
 */
export function markHeard(state: RoomState, playerId: string, index: number, now: number): RoomState {
  const prog = state.progress[playerId];
  if (state.phase !== 'racing' || !prog || prog.finishedAt != null || prog.wordIndex !== index || prog.heardAt != null) return state;
  if (state.goAt != null && now < state.goAt) return state;
  const clock = wordClockMs(state.options, wordStrokes(state.roundWords[index], state.list.strokeCounts));
  const heard = { ...prog, heardAt: now, deadlineAt: now + clock };
  return bump({ ...state, progress: { ...state.progress, [playerId]: heard } });
}

/** The room tried to serve the current word's clip to this player and failed: Skip is allowed without hearing. */
export function markServeFailed(state: RoomState, playerId: string, index: number): RoomState {
  const prog = state.progress[playerId];
  if (state.phase !== 'racing' || !prog || prog.wordIndex !== index || prog.heardAt != null || prog.serveFailed) return state;
  return bump({ ...state, progress: { ...state.progress, [playerId]: { ...prog, serveFailed: true } } });
}

/** Keeps at most `max` points, evenly spread, both ends kept. */
function thin(points: Point[], max: number): number[][] {
  const pick = points.length <= max ? points : Array.from({ length: max }, (_, i) => points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return pick.map((p) => [Math.round(p.x), Math.round(p.y)]);
}

export interface StrokeInput {
  /** The round this stroke belongs to (state.round). */
  race: number;
  /** This player's send counter for the round, 1, 2, 3... Strokes and skips share it. */
  seq: number;
  wordIndex: number;
  charIndex: number;
  /** The drawn stroke, in stroke-data coordinates (1024 box, y up). */
  points: Point[];
}

export interface SkipInput {
  race: number;
  seq: number;
  wordIndex: number;
}

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** A stroke is its points. A body that asserts a result instead is refused (returns a reason). */
export function parseStrokeInput(body: Record<string, unknown>): StrokeInput | string {
  const { race, seq, wordIndex, charIndex } = body;
  if ('result' in body && !('points' in body)) return 'send the points you drew; the room decides if a stroke is right';
  if (!nonNegInt(race) || !nonNegInt(seq) || seq < 1 || !nonNegInt(wordIndex) || !nonNegInt(charIndex)) return 'send race, seq, wordIndex, charIndex and points';
  const points = parsePoints(body.points);
  if (!points) return `points must be 2 to ${GAME.maxStrokePoints} [x, y] pairs`;
  return { race, seq, wordIndex, charIndex, points };
}

export function parseSkipInput(body: Record<string, unknown>): SkipInput | null {
  const { race, seq, wordIndex } = body;
  if (!nonNegInt(race) || !nonNegInt(seq) || seq < 1 || !nonNegInt(wordIndex)) return null;
  return { race, seq, wordIndex };
}

/** The checks every send shares. Returns the player's progress, or a Result to answer with. */
function gate(state: RoomState, playerId: string, input: { race: number; seq: number; wordIndex: number }, now: number): Progress | Result {
  if (state.phase !== 'racing') return fail(state, 'the round is not on right now', 409);
  if (input.race !== state.round) return fail(state, 'that was for a different round', 409);
  if (state.goAt != null && now < state.goAt) return fail(state, 'wait for GO', 409);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.role !== 'kid') return fail(state, 'only writers can write', 403);
  const prog = state.progress[playerId];
  if (!prog) return fail(state, 'this round started before you joined, you are in the next one', 409);
  if (input.seq <= prog.seq || prog.finishedAt != null) return { state, duplicate: true };
  if (input.seq > prog.seq + GAME.maxSeqJump) return fail(state, 'that send number is too far ahead', 400);
  if (input.wordIndex !== prog.wordIndex) return fail(state, 'that is not the word you are on', 409);
  return prog;
}

function commit(state: RoomState, playerId: string, next: Progress, now: number, verdict?: 'correct' | 'mistake'): Result {
  const updated = bump({ ...state, progress: { ...state.progress, [playerId]: next } });
  return { state: advanceIfDue(updated, now), verdict };
}

/**
 * One drawn stroke. The room grades the points against the target stroke's
 * median (the shared matcher). Every send names its round and carries a
 * per-player sequence number, so a retry never counts twice. Strokes go in
 * order; a word must have been heard (the room served its audio) and its
 * deadline not passed; correct strokes respect the pace floor.
 */
export function submitStroke(state: RoomState, playerId: string, input: StrokeInput, geom: Record<string, CharGeom>, now: number): Result {
  const g = gate(state, playerId, input, now);
  if ('state' in g) return g;
  const prog = g;
  if (prog.heardAt == null) return fail(state, 'listen to the word first', 409);
  if (prog.deadlineAt != null && now >= prog.deadlineAt) return fail(state, 'time is up for that word', 409);
  if (input.charIndex !== prog.charIndex) return fail(state, 'that is not the character you are on', 409);
  if (prog.wordMisses >= GAME.maxMissesPerWord) return fail(state, 'no more tries on this word, tap Skip', 409);
  if (prog.lastGradedAt != null && now - prog.lastGradedAt < GAME.minStrokeGapMs) return fail(state, 'too fast, slow down a little', 429);
  const char = [...state.roundWords[prog.wordIndex]][prog.charIndex];
  const data = geom[char];
  if (!data) return fail(state, 'the room is missing the stroke data for this word, try again in a moment', 503);
  const verdict = gradeStroke(input.points, data.medians, prog.strokeIndex);
  if (verdict === 'mistake') {
    return commit(
      state,
      playerId,
      { ...prog, mistakes: prog.mistakes + 1, strokeMisses: prog.strokeMisses + 1, wordMisses: prog.wordMisses + 1, lastGradedAt: now, seq: input.seq },
      now,
      'mistake'
    );
  }
  const earliest = (state.goAt ?? 0) + (prog.strokesDone + 1) * GAME.minStrokeMs;
  if (now < earliest) return fail(state, 'too fast, slow down a little', 429);
  const helped = prog.strokeMisses >= GAME.hintAfterMisses;
  const drawn = prog.drawn.map((c) => c.slice());
  while (drawn.length <= prog.charIndex) drawn.push([]);
  drawn[prog.charIndex].push(thin(input.points, GAME.echoPoints));
  const score = GAME.strokeScore[state.options.level][helped ? 'helped' : 'plain'];
  let next: Progress = {
    ...prog,
    strokeIndex: prog.strokeIndex + 1,
    strokeMisses: 0,
    helped: prog.helped + (helped && score < 1 ? 1 : 0),
    strokesDone: prog.strokesDone + 1,
    scoreStrokes: prog.scoreStrokes + score,
    wordStrokes: prog.wordStrokes + score,
    lastProgressAt: now,
    lastGradedAt: now,
    drawn,
    seq: input.seq,
  };
  if (next.strokeIndex >= data.strokes.length) {
    next = { ...next, charIndex: prog.charIndex + 1, strokeIndex: 0 };
    if (next.charIndex >= [...state.roundWords[prog.wordIndex]].length) next = closeWord(state, next, now, true);
  }
  return commit(state, playerId, next, now, 'correct');
}

/** Moves on without writing this word. A skipped word scores 0: its strokes are taken back. */
export function skipWord(state: RoomState, playerId: string, input: SkipInput, now: number): Result {
  const g = gate(state, playerId, input, now);
  if ('state' in g) return g;
  // Codex review round 2: no skipping a word you have not been served (it would close the word unheard).
  if (g.heardAt == null && !g.serveFailed) return fail(state, 'listen to the word first', 409);
  return commit(state, playerId, closeWord(state, { ...g, seq: input.seq }, now, false), now);
}

/**
 * The ranking key, used for BOTH the order and the place number: words written
 * (more first), scoring strokes (more first; a Hard stroke only right after
 * the hint scores less), then who got there first. Wrong strokes are not in it.
 */
function rankKey(p: Progress): [number, number, number] {
  return [-p.wordsDone, -p.scoreStrokes, p.lastProgressAt ?? Number.MAX_SAFE_INTEGER];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The class board, best first. Only players in the current round are on it. Equal keys share a place. */
export function standings(state: RoomState): Standing[] {
  const rows = roundPlayers(state).map((k) => ({ k, p: state.progress[k.id]!, key: rankKey(state.progress[k.id]!) }));
  rows.sort((a, b) => compareKeys(a.key, b.key));
  let place = 0;
  return rows.map(({ k, p, key }, i) => {
    if (i === 0 || compareKeys(rows[i - 1].key, key) !== 0) place = i + 1;
    return { playerId: k.id, name: k.name, agent: k.agent, wordsDone: p.wordsDone, wordsSkipped: p.wordsSkipped, helped: p.helped, finished: p.finishedAt != null, place };
  });
}

export function touch(state: RoomState, playerId: string, now: number): RoomState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, lastSeenAt: now } : p)) };
}

/** The opaque audio handle for word `index` of round `round`: indices only, never text. */
export const audioHandle = (code: string, round: number, index: number) => `/api/rooms/${code}/say?r=${round}&w=${index}`;

/** One writer's own round. See MyRound: nothing here names the word or counts its strokes. */
export function myRound(state: RoomState, playerId: string, geom: Record<string, CharGeom>): MyRound | null {
  const p = state.progress[playerId];
  if (!p || state.round === 0) return null;
  const done = p.finishedAt != null;
  const word = done ? [] : [...(state.roundWords[p.wordIndex] ?? '')];
  // The kid's OWN drawing, never the canonical shapes (those fingerprint the character).
  const accepted: number[][][][] = done ? [] : Array.from({ length: Math.min(p.charIndex + 1, word.length) }, (_, c) => p.drawn[c] ?? []);
  const current = word[p.charIndex];
  const heard = p.heardAt != null;
  const outline = !done && heard && state.options.level === 'easy' && current ? geom[current]?.strokes ?? null : null;
  const hint = !done && heard && current && p.strokeMisses >= GAME.hintAfterMisses ? geom[current]?.strokes[p.strokeIndex] ?? null : null;
  return {
    wordIndex: p.wordIndex,
    charIndex: p.charIndex,
    charCount: done ? null : word.length,
    audio: done || state.phase !== 'racing' ? null : audioHandle(state.code, state.round, p.wordIndex),
    heard,
    deadlineAt: p.deadlineAt,
    clockMs: p.deadlineAt != null && p.heardAt != null ? p.deadlineAt - p.heardAt : null,
    accepted,
    outline,
    hint,
    wordsDone: p.wordsDone,
    wordsSkipped: p.wordsSkipped,
    mistakes: p.mistakes,
    seq: p.seq,
    finishedAt: p.finishedAt,
    closed: p.results.map((result, i) => ({ word: closedForAll(state, i) ? state.roundWords[i] : null, result })),
    missesLeft: Math.max(0, GAME.maxMissesPerWord - p.wordMisses),
  };
}

/** True when word `i` is closed for EVERY player of the round (or the round is over): only then may its text reach a writer. */
export function closedForAll(state: RoomState, i: number): boolean {
  if (state.phase === 'done') return true;
  const players = Object.values(state.progress);
  return players.length > 0 && players.every((p) => p.finishedAt != null || p.wordIndex > i);
}

/** The teacher gets the whole list report; a writer (kid, agent, solo) only how many words there are. */
function publicList(list: WordList, teacher: boolean): PublicList {
  const { strokeCounts: _counts, ...rest } = list;
  if (teacher) return { ...rest, count: list.words.length };
  return { words: [], missing: [], tooLong: [], skipped: [], overflow: [], repeats: 0, count: list.words.length };
}

/**
 * What one viewer receives. The teacher (a class room's host) sees the list
 * and the round's words. A writer (every kid, and the solo player) sees only
 * their own round (MyRound) and, once the round is over, its words.
 */
export function publicView(state: RoomState, viewerId: string, now: number, geom: Record<string, CharGeom> = {}): PublicState {
  const me = state.players.find((p) => p.id === viewerId);
  const role = me?.role ?? 'kid';
  const teacher = role === 'teacher';
  return {
    code: state.code,
    mode: state.mode,
    version: state.version,
    hostId: state.hostId,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    phase: state.phase,
    options: state.options,
    list: publicList(state.list, teacher),
    round: state.round,
    roundSize: state.roundWords.length,
    roundWords: teacher || state.phase === 'done' ? state.roundWords : [],
    goAt: state.goAt,
    endsAt: state.endsAt,
    endedAt: state.endedAt,
    players: state.players,
    you: viewerId,
    role,
    present: presentWriters(state, now).map((k) => k.id),
    standings: standings(state),
    me: teacher ? null : myRound(state, viewerId, geom),
    serverNow: now,
  };
}

/** The single alarm: the earliest word deadline or round end while racing, otherwise the room's expiry. */
export function nextAlarmAt(state: RoomState, now: number): number {
  const candidates = [state.expiresAt];
  if (state.phase === 'racing') {
    if (state.endsAt != null) candidates.push(state.endsAt);
    for (const p of Object.values(state.progress)) if (p.finishedAt == null && p.deadlineAt != null) candidates.push(p.deadlineAt);
  }
  return Math.max(now, Math.min(...candidates));
}

/** The word at `index` of the current round, for the speech route. Only words of a started round are spoken. */
export function wordToSay(state: RoomState, index: number): string | null {
  if (state.phase === 'lobby' || !Number.isInteger(index) || index < 0) return null;
  return state.roundWords[index] ?? null;
}
