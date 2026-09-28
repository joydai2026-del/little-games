// The whole game as pure functions. The Durable Object only persists, checks
// secrets, reads the clock and arms the alarm; every rule is here so it can be
// unit-tested without Cloudflare.

import { GAME, normalizeOptions, type RaceOptions } from './config';
import type { CharList, Player, Progress, PublicState, RoomState, Standing, StrokeResult } from './types';

export interface Result {
  state: RoomState;
  error?: string;
  /** HTTP-ish status for the error: 400 bad input, 403 not allowed, 409 wrong moment. */
  status?: number;
}

const bump = (s: RoomState): RoomState => ({ ...s, version: s.version + 1 });
const fail = (state: RoomState, error: string, status: number): Result => ({ state, error, status });

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

function freshProgress(): Progress {
  return { charIndex: 0, strokeIndex: 0, charsDone: 0, mistakes: 0, finishedAt: null, lastProgressAt: null, strokesDone: 0, seq: 0 };
}

const ttlMs = () => GAME.roomTtlMinutes * 60_000;

export function kids(state: RoomState): Player[] {
  return state.players.filter((p) => p.role === 'kid');
}

/**
 * THE list of kids who are here: what the teacher's "Kids here" shows AND who
 * races when the teacher taps Start. One function, so the screen and the
 * roster can never disagree. A kid drops off only when their phone has not
 * checked in for GAME.rosterActiveMs (closed tab, gone home).
 */
export function presentKids(state: RoomState, now: number): Player[] {
  return kids(state).filter((k) => now - k.lastSeenAt <= GAME.rosterActiveMs);
}

export function createRoom(
  code: string,
  host: { id: string; name: string },
  options: Partial<RaceOptions> | undefined,
  list: CharList,
  now: number
): RoomState {
  return {
    code,
    version: 1,
    hostId: host.id,
    createdAt: now,
    expiresAt: now + GAME.roomTtlMinutes * 60_000,
    phase: 'lobby',
    options: normalizeOptions(options),
    list,
    round: 0,
    roundChars: [],
    goAt: null,
    endsAt: null,
    endedAt: null,
    players: [
      { id: host.id, name: cleanName(host.name) || 'Teacher', role: 'teacher', agent: false, joinedAt: now, lastSeenAt: now },
    ],
    progress: {},
  };
}

export function join(
  state: RoomState,
  who: { id: string; name: string; agent?: boolean },
  now: number
): Result {
  const name = cleanName(who.name);
  if (!name) return fail(state, 'please type your name', 400);
  if (kids(state).length >= GAME.maxKids) return fail(state, 'this room is full', 409);
  const player: Player = {
    id: who.id,
    name: uniqueName(state.players, name),
    role: 'kid',
    agent: who.agent === true,
    joinedAt: now,
    lastSeenAt: now,
  };
  // No progress entry: a kid who joins mid-race watches and races the next one.
  return { state: bump({ ...state, players: [...state.players, player] }) };
}

export function setList(state: RoomState, byId: string, list: CharList): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change the list', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this race to end', 409);
  return { state: bump({ ...state, list, round: state.phase === 'lobby' ? 0 : state.round }) };
}

export function setOptions(state: RoomState, byId: string, input: Partial<Record<keyof RaceOptions, unknown>>): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change settings', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this race to end', 409);
  return { state: bump({ ...state, options: normalizeOptions({ ...state.options, ...input }) }) };
}

/** The characters for race number `round` (0-based): the next chunk of the list, wrapping, never repeating inside one race. */
export function charsForRound(list: string[], round: number, perRound: number): string[] {
  if (list.length === 0) return [];
  const count = Math.min(perRound, list.length);
  const startAt = (round * count) % list.length;
  return Array.from({ length: count }, (_, i) => list[(startAt + i) % list.length]);
}

/** Lobby -> racing (Start) and done -> racing (Race again). */
export function startRace(state: RoomState, byId: string, now: number): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can start', 403);
  if (state.phase === 'racing') return fail(state, 'the race is already on', 409);
  if (state.list.chars.length === 0) return fail(state, 'the list has no characters we can trace yet', 409);
  if (kids(state).length === 0) return fail(state, 'wait for at least one kid to join', 409);
  // Only kids seen recently race: a kid who closed the tab is not a ghost at 0 on the board.
  const active = presentKids(state, now);
  if (active.length === 0) return fail(state, 'wait for at least one kid to join', 409);
  const roundChars = charsForRound(state.list.chars, state.round, state.options.charsPerRound);
  const goAt = now + GAME.countdownSeconds * 1000;
  const progress: Record<string, Progress> = {};
  for (const kid of active) progress[kid.id] = freshProgress();
  return {
    state: bump({
      ...state,
      phase: 'racing',
      round: state.round + 1,
      roundChars,
      goAt,
      endsAt: goAt + state.options.secondsPerChar * roundChars.length * 1000,
      endedAt: null,
      // A room never expires in the middle of a race.
      expiresAt: Math.max(state.expiresAt, goAt + state.options.secondsPerChar * roundChars.length * 1000 + ttlMs()),
      progress,
    }),
  };
}

/** Kids in the current race (the roster frozen at Start). */
export function racers(state: RoomState): Player[] {
  return kids(state).filter((k) => state.progress[k.id] !== undefined);
}

export function allFinished(state: RoomState): boolean {
  const list = racers(state);
  return list.length > 0 && list.every((k) => state.progress[k.id]!.finishedAt != null);
}

/** Ends the race when time is up or every kid is done. Returns the same object when nothing changed. */
export function advanceIfDue(state: RoomState, now: number): RoomState {
  if (state.phase !== 'racing') return state;
  if ((state.endsAt != null && now >= state.endsAt) || allFinished(state)) {
    return bump({ ...state, phase: 'done', endedAt: now, expiresAt: Math.max(state.expiresAt, now + ttlMs()) });
  }
  return state;
}

export interface StrokeInput {
  /** The race this stroke belongs to (state.round). A stroke from another race is refused. */
  race: number;
  /** This racer's stroke counter for the race, 1, 2, 3... A number already applied is a no-op. */
  seq: number;
  charIndex: number;
  strokeIndex: number;
  result: StrokeResult;
}

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseStrokeInput(body: Record<string, unknown>): StrokeInput | null {
  const { race, seq, charIndex, strokeIndex, result } = body;
  if (!nonNegInt(race) || !nonNegInt(seq) || seq < 1) return null;
  if (!nonNegInt(charIndex) || !nonNegInt(strokeIndex)) return null;
  if (result !== 'correct' && result !== 'mistake') return null;
  return { race, seq, charIndex, strokeIndex, result };
}

/**
 * One stroke from a kid (or an agent). Every stroke names its race and carries
 * a per-racer sequence number, so a retried request, a replay from an earlier
 * race, or a double-sent mistake can never count twice. Strokes must come in
 * order, and correct strokes must respect the pace floor (GAME.minStrokeMs).
 */
export function submitStroke(
  state: RoomState,
  playerId: string,
  input: StrokeInput,
  now: number
): Result & { duplicate?: boolean } {
  if (state.phase !== 'racing') return fail(state, 'the race is not on right now', 409);
  if (input.race !== state.round) return fail(state, 'that stroke was for a different race', 409);
  if (state.goAt != null && now < state.goAt) return fail(state, 'wait for GO', 409);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.role !== 'kid') return fail(state, 'only racers can trace', 403);
  const prog = state.progress[playerId];
  if (!prog) return fail(state, 'this race started before you joined, you are in the next one', 409);
  if (input.seq <= prog.seq || prog.finishedAt != null) return { state, duplicate: true };
  if (input.seq > prog.seq + GAME.maxSeqJump) return fail(state, 'that stroke number is too far ahead', 400);

  const { charIndex, strokeIndex, result } = input;
  if (charIndex !== prog.charIndex) return fail(state, 'that is not the character you are on', 409);
  const char = state.roundChars[charIndex];
  const strokes = state.list.strokeCounts[char] ?? 0;
  if (strokeIndex >= strokes) return fail(state, 'that character does not have that many strokes', 400);
  if (strokeIndex !== prog.strokeIndex) return fail(state, 'strokes go in order', 409);

  let next: Progress;
  if (result === 'mistake') {
    next = { ...prog, mistakes: prog.mistakes + 1, seq: input.seq };
  } else {
    const earliest = (state.goAt ?? 0) + (prog.strokesDone + 1) * GAME.minStrokeMs;
    if (now < earliest) return fail(state, 'too fast, slow down a little', 429);
    next = { ...prog, strokeIndex: prog.strokeIndex + 1, strokesDone: prog.strokesDone + 1, lastProgressAt: now, seq: input.seq };
    if (next.strokeIndex >= strokes) {
      next = { ...next, charIndex: prog.charIndex + 1, strokeIndex: 0, charsDone: prog.charsDone + 1 };
      if (next.charIndex >= state.roundChars.length) next = { ...next, finishedAt: now };
    }
  }
  const updated = bump({ ...state, progress: { ...state.progress, [playerId]: next } });
  return { state: advanceIfDue(updated, now) };
}

/**
 * The ranking key, used for BOTH the order and the place number: characters
 * finished (more first), strokes into the current character (more first),
 * mistakes (fewer first), then who reached that spot first. Mistakes only
 * count once a kid has made progress: a kid who tried and missed is never
 * ranked below a kid who has not touched the pad.
 */
function rankKey(p: Progress): [number, number, number, number] {
  const progressed = p.strokesDone > 0;
  return [-p.charsDone, -p.strokeIndex, progressed ? p.mistakes : 0, p.lastProgressAt ?? Number.MAX_SAFE_INTEGER];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The race board, best first. Only kids in the current race are on it. */
export function standings(state: RoomState): Standing[] {
  const rows = racers(state).map((k) => ({ k, p: state.progress[k.id]!, key: rankKey(state.progress[k.id]!) }));
  rows.sort((a, b) => compareKeys(a.key, b.key));
  let place = 0;
  return rows.map(({ k, p, key }, i) => {
    if (i === 0 || compareKeys(rows[i - 1].key, key) !== 0) place = i + 1;
    return {
      playerId: k.id,
      name: k.name,
      agent: k.agent,
      charsDone: p.charsDone,
      mistakes: p.mistakes,
      finished: p.finishedAt != null,
      currentChar: p.finishedAt != null ? null : state.roundChars[p.charIndex] ?? null,
      strokeIndex: p.strokeIndex,
      place,
    };
  });
}

export function touch(state: RoomState, playerId: string, now: number): RoomState {
  const players = state.players.map((p) => (p.id === playerId ? { ...p, lastSeenAt: now } : p));
  return { ...state, players };
}

export function publicView(state: RoomState, viewerId: string, now: number): PublicState {
  const me = state.players.find((p) => p.id === viewerId);
  return {
    ...state,
    you: viewerId,
    role: me?.role ?? 'kid',
    standings: standings(state),
    present: presentKids(state, now).map((k) => k.id),
    serverNow: now,
  };
}

/** The single alarm: the race end while racing, otherwise the room's expiry. */
export function nextAlarmAt(state: RoomState, now: number): number {
  const candidates = [state.expiresAt];
  if (state.phase === 'racing' && state.endsAt != null) candidates.push(state.endsAt);
  return Math.max(now, Math.min(...candidates));
}
