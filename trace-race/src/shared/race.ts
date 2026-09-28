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
  return { charIndex: 0, strokeIndex: 0, charsDone: 0, mistakes: 0, finishedAt: null, lastProgressAt: null };
}

export function kids(state: RoomState): Player[] {
  return state.players.filter((p) => p.role === 'kid');
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
  const progress = { ...state.progress, [who.id]: freshProgress() };
  return { state: bump({ ...state, players: [...state.players, player], progress }) };
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
  const roundChars = charsForRound(state.list.chars, state.round, state.options.charsPerRound);
  const goAt = now + GAME.countdownSeconds * 1000;
  const progress: Record<string, Progress> = {};
  for (const kid of kids(state)) progress[kid.id] = freshProgress();
  return {
    state: bump({
      ...state,
      phase: 'racing',
      round: state.round + 1,
      roundChars,
      goAt,
      endsAt: goAt + state.options.secondsPerChar * roundChars.length * 1000,
      endedAt: null,
      progress,
    }),
  };
}

export function allFinished(state: RoomState): boolean {
  const list = kids(state);
  return list.length > 0 && list.every((k) => state.progress[k.id]?.finishedAt != null);
}

/** Ends the race when time is up or every kid is done. Returns the same object when nothing changed. */
export function advanceIfDue(state: RoomState, now: number): RoomState {
  if (state.phase !== 'racing') return state;
  if ((state.endsAt != null && now >= state.endsAt) || allFinished(state)) {
    return bump({ ...state, phase: 'done', endedAt: now });
  }
  return state;
}

export interface StrokeInput {
  charIndex: number;
  strokeIndex: number;
  result: StrokeResult;
}

export function parseStrokeInput(body: Record<string, unknown>): StrokeInput | null {
  const { charIndex, strokeIndex, result } = body;
  if (!Number.isInteger(charIndex) || (charIndex as number) < 0) return null;
  if (!Number.isInteger(strokeIndex) || (strokeIndex as number) < 0) return null;
  if (result !== 'correct' && result !== 'mistake') return null;
  return { charIndex: charIndex as number, strokeIndex: strokeIndex as number, result };
}

/**
 * One stroke from a kid (or an agent). Strokes must come in order. A repeat of
 * a stroke already counted (a retried request, a page reload re-tracing from
 * the start) is accepted and changes nothing, so a flaky phone never errors.
 */
export function submitStroke(
  state: RoomState,
  playerId: string,
  input: StrokeInput,
  now: number
): Result & { duplicate?: boolean } {
  if (state.phase !== 'racing') return fail(state, 'the race is not on right now', 409);
  if (state.goAt != null && now < state.goAt) return fail(state, 'wait for GO', 409);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.role !== 'kid') return fail(state, 'only racers can trace', 403);
  const prog = state.progress[playerId] ?? freshProgress();
  if (prog.finishedAt != null) return { state, duplicate: true };

  const { charIndex, strokeIndex, result } = input;
  if (charIndex < prog.charIndex || (charIndex === prog.charIndex && strokeIndex < prog.strokeIndex && result === 'correct')) {
    return { state, duplicate: true };
  }
  if (charIndex > prog.charIndex) return fail(state, 'finish the character you are on first', 409);

  const char = state.roundChars[charIndex];
  const strokes = state.list.strokeCounts[char] ?? 0;
  if (strokeIndex >= strokes) return fail(state, 'that character does not have that many strokes', 400);

  let next: Progress;
  if (result === 'mistake') {
    if (strokeIndex !== prog.strokeIndex) return { state, duplicate: true };
    next = { ...prog, mistakes: prog.mistakes + 1 };
  } else {
    if (strokeIndex !== prog.strokeIndex) return fail(state, 'strokes go in order', 409);
    next = { ...prog, strokeIndex: prog.strokeIndex + 1, lastProgressAt: now };
    if (next.strokeIndex >= strokes) {
      next = { ...next, charIndex: prog.charIndex + 1, strokeIndex: 0, charsDone: prog.charsDone + 1 };
      if (next.charIndex >= state.roundChars.length) next = { ...next, finishedAt: now };
    }
  }
  const updated = bump({ ...state, progress: { ...state.progress, [playerId]: next } });
  return { state: advanceIfDue(updated, now) };
}

/** Characters finished, then fewer mistakes, then whoever got there first. */
export function standings(state: RoomState): Standing[] {
  const rows = kids(state).map((k) => {
    const p = state.progress[k.id] ?? freshProgress();
    return { k, p };
  });
  rows.sort((a, b) => {
    if (b.p.charsDone !== a.p.charsDone) return b.p.charsDone - a.p.charsDone;
    if (a.p.mistakes !== b.p.mistakes) return a.p.mistakes - b.p.mistakes;
    const at = a.p.finishedAt ?? a.p.lastProgressAt ?? Infinity;
    const bt = b.p.finishedAt ?? b.p.lastProgressAt ?? Infinity;
    if (at !== bt) return at - bt;
    return b.p.strokeIndex - a.p.strokeIndex;
  });
  let place = 0;
  let prevKey = '';
  return rows.map(({ k, p }, i) => {
    const key = `${p.charsDone}|${p.mistakes}|${p.finishedAt ?? p.lastProgressAt ?? 'x'}`;
    if (key !== prevKey) place = i + 1;
    prevKey = key;
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
  return { ...state, you: viewerId, role: me?.role ?? 'kid', standings: standings(state), serverNow: now };
}

/** The single alarm: the race end while racing, otherwise the room's expiry. */
export function nextAlarmAt(state: RoomState, now: number): number {
  const candidates = [state.expiresAt];
  if (state.phase === 'racing' && state.endsAt != null) candidates.push(state.endsAt);
  return Math.max(now, Math.min(...candidates));
}
