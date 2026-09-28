// The whole game as pure functions. The Durable Object only persists, checks
// secrets, reads the clock and arms the alarm; every rule is here so it can be
// unit-tested without Cloudflare.

import { GAME, normalizeOptions, type DashOptions } from './config';
import type { Mode, Player, Progress, PublicState, RoomState, Standing, StrokeResult, WordList } from './types';

export interface Result {
  state: RoomState;
  error?: string;
  /** HTTP-ish status for the error: 400 bad input, 403 not allowed, 409 wrong moment, 429 too fast. */
  status?: number;
  /** The same send arrived again (a retry): nothing changed. */
  duplicate?: boolean;
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
    strokesDone: 0,
    finishedAt: null,
    lastProgressAt: null,
    seq: 0,
  };
}

/** Everyone who writes: kids in a class room, the one player in a solo room. */
export function writers(state: RoomState): Player[] {
  return state.players.filter((p) => p.role === 'kid');
}

/**
 * THE list of writers who are here: what the teacher's "Kids here" shows AND
 * who writes when Start is tapped. One function, so the screen and the roster
 * can never disagree.
 */
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
    roundWords: [],
    goAt: null,
    endsAt: null,
    endedAt: null,
    players: [
      {
        id: host.id,
        // In solo play the host IS the writer.
        name: cleanName(host.name) || (solo ? 'Me' : 'Teacher'),
        role: solo ? 'kid' : 'teacher',
        agent: false,
        joinedAt: now,
        lastSeenAt: now,
      },
    ],
    progress: {},
  };
}

export function join(state: RoomState, who: { id: string; name: string; agent?: boolean }, now: number): Result {
  if (state.mode === 'solo') return fail(state, 'this is a practice room for one', 409);
  const name = cleanName(who.name);
  if (!name) return fail(state, 'please type your name', 400);
  if (writers(state).length >= GAME.maxKids) return fail(state, 'this room is full', 409);
  const player: Player = { id: who.id, name: uniqueName(state.players, name), role: 'kid', agent: who.agent === true, joinedAt: now, lastSeenAt: now };
  // No progress entry: a kid who joins mid-round watches and writes the next one.
  return { state: bump({ ...state, players: [...state.players, player] }) };
}

export function setList(state: RoomState, byId: string, list: WordList): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change the list', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this round to end', 409);
  return { state: bump({ ...state, list, round: state.phase === 'lobby' ? 0 : state.round }) };
}

export function setOptions(state: RoomState, byId: string, input: Partial<Record<keyof DashOptions, unknown>>): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change settings', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this round to end', 409);
  return { state: bump({ ...state, options: normalizeOptions(input, state.options) }) };
}

/** The words for round number `round` (0-based): the next chunk of the list, wrapping, never repeating inside one round. */
export function wordsForRound(list: string[], round: number, perRound: number): string[] {
  if (list.length === 0) return [];
  const count = Math.min(perRound, list.length);
  const startAt = (round * count) % list.length;
  return Array.from({ length: count }, (_, i) => list[(startAt + i) % list.length]);
}

/** How long a round with `words` words may run, in ms: each word's time plus time to hear it. */
export function roundMs(options: DashOptions, words: number): number {
  return (options.secondsPerWord + GAME.hearSlackSeconds) * words * 1000;
}

/** Lobby -> racing (Start) and done -> racing (Next round). */
export function startRound(state: RoomState, byId: string, now: number): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can start', 403);
  if (state.phase === 'racing') return fail(state, 'the round is already on', 409);
  if (state.list.words.length === 0) return fail(state, 'the list has no words we can write yet', 409);
  const active = presentWriters(state, now);
  if (active.length === 0) return fail(state, 'wait for at least one kid to join', 409);
  const roundWords = wordsForRound(state.list.words, state.round, state.options.wordsPerRound);
  const goAt = now + GAME.countdownSeconds * 1000;
  const endsAt = goAt + roundMs(state.options, roundWords.length);
  const progress: Record<string, Progress> = {};
  for (const kid of active) progress[kid.id] = freshProgress();
  return {
    state: bump({
      ...state,
      phase: 'racing',
      round: state.round + 1,
      roundWords,
      goAt,
      endsAt,
      endedAt: null,
      // A room never expires in the middle of a round.
      expiresAt: Math.max(state.expiresAt, endsAt + ttlMs()),
      progress,
    }),
  };
}

/** Players in the current round (the roster frozen at Start). */
export function roundPlayers(state: RoomState): Player[] {
  return writers(state).filter((k) => state.progress[k.id] !== undefined);
}

export function allFinished(state: RoomState): boolean {
  const list = roundPlayers(state);
  return list.length > 0 && list.every((k) => state.progress[k.id]!.finishedAt != null);
}

/** Ends the round when time is up or everyone is done. Returns the same object when nothing changed. */
export function advanceIfDue(state: RoomState, now: number): RoomState {
  if (state.phase !== 'racing') return state;
  if ((state.endsAt != null && now >= state.endsAt) || allFinished(state)) {
    return bump({ ...state, phase: 'done', endedAt: now, expiresAt: Math.max(state.expiresAt, now + ttlMs()) });
  }
  return state;
}

export interface StrokeInput {
  /** The round this stroke belongs to (state.round). */
  race: number;
  /** This player's send counter for the round, 1, 2, 3... Strokes and skips share it. */
  seq: number;
  wordIndex: number;
  charIndex: number;
  strokeIndex: number;
  result: StrokeResult;
}

export interface SkipInput {
  race: number;
  seq: number;
  wordIndex: number;
}

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseStrokeInput(body: Record<string, unknown>): StrokeInput | null {
  const { race, seq, wordIndex, charIndex, strokeIndex, result } = body;
  if (!nonNegInt(race) || !nonNegInt(seq) || seq < 1) return null;
  if (!nonNegInt(wordIndex) || !nonNegInt(charIndex) || !nonNegInt(strokeIndex)) return null;
  if (result !== 'correct' && result !== 'mistake') return null;
  return { race, seq, wordIndex, charIndex, strokeIndex, result };
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

function commit(state: RoomState, playerId: string, next: Progress, now: number): Result {
  const updated = bump({ ...state, progress: { ...state.progress, [playerId]: next } });
  return { state: advanceIfDue(updated, now) };
}

function nextWord(state: RoomState, prog: Progress, now: number, written: boolean): Progress {
  const next: Progress = {
    ...prog,
    wordIndex: prog.wordIndex + 1,
    charIndex: 0,
    strokeIndex: 0,
    wordsDone: prog.wordsDone + (written ? 1 : 0),
    wordsSkipped: prog.wordsSkipped + (written ? 0 : 1),
  };
  return next.wordIndex >= state.roundWords.length ? { ...next, finishedAt: now } : next;
}

/**
 * One stroke from a kid (or an agent). Every send names its round and carries
 * a per-player sequence number, so a retried request, a replay from an earlier
 * round, or a double-sent mistake can never count twice. Strokes come in order
 * (word, character, stroke), and correct strokes respect the pace floor.
 */
export function submitStroke(state: RoomState, playerId: string, input: StrokeInput, now: number): Result {
  const g = gate(state, playerId, input, now);
  if ('state' in g) return g;
  const prog = g;
  const word = [...state.roundWords[prog.wordIndex]];
  if (input.charIndex !== prog.charIndex) return fail(state, 'that is not the character you are on', 409);
  const strokes = state.list.strokeCounts[word[prog.charIndex]] ?? 0;
  if (input.strokeIndex >= strokes) return fail(state, 'that character does not have that many strokes', 400);
  if (input.strokeIndex !== prog.strokeIndex) return fail(state, 'strokes go in order', 409);

  if (input.result === 'mistake') return commit(state, playerId, { ...prog, mistakes: prog.mistakes + 1, seq: input.seq }, now);

  const earliest = (state.goAt ?? 0) + (prog.strokesDone + 1) * GAME.minStrokeMs;
  if (now < earliest) return fail(state, 'too fast, slow down a little', 429);
  let next: Progress = { ...prog, strokeIndex: prog.strokeIndex + 1, strokesDone: prog.strokesDone + 1, lastProgressAt: now, seq: input.seq };
  if (next.strokeIndex >= strokes) {
    next = { ...next, charIndex: prog.charIndex + 1, strokeIndex: 0 };
    if (next.charIndex >= word.length) next = nextWord(state, next, now, true);
  }
  return commit(state, playerId, next, now);
}

/** Moves on without writing the word: it did not play, or its time ran out. Never scores. */
export function skipWord(state: RoomState, playerId: string, input: SkipInput, now: number): Result {
  const g = gate(state, playerId, input, now);
  if ('state' in g) return g;
  return commit(state, playerId, nextWord(state, { ...g, seq: input.seq }, now, false), now);
}

/**
 * The ranking key, used for BOTH the order and the place number: words written
 * (more first), correct strokes (more first), then who got there first.
 * Wrong strokes are not in it: a wrong stroke only wiggles. Skipping gains
 * nothing, so it can never lift anyone.
 */
function rankKey(p: Progress): [number, number, number] {
  return [-p.wordsDone, -p.strokesDone, p.lastProgressAt ?? Number.MAX_SAFE_INTEGER];
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
    return {
      playerId: k.id,
      name: k.name,
      agent: k.agent,
      wordsDone: p.wordsDone,
      wordsSkipped: p.wordsSkipped,
      finished: p.finishedAt != null,
      place,
    };
  });
}

export function touch(state: RoomState, playerId: string, now: number): RoomState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, lastSeenAt: now } : p)) };
}

export function publicView(state: RoomState, viewerId: string, now: number): PublicState {
  const me = state.players.find((p) => p.id === viewerId);
  return {
    ...state,
    you: viewerId,
    role: me?.role ?? 'kid',
    standings: standings(state),
    present: presentWriters(state, now).map((k) => k.id),
    serverNow: now,
  };
}

/** The single alarm: the round end while racing, otherwise the room's expiry. */
export function nextAlarmAt(state: RoomState, now: number): number {
  const candidates = [state.expiresAt];
  if (state.phase === 'racing' && state.endsAt != null) candidates.push(state.endsAt);
  return Math.max(now, Math.min(...candidates));
}

/** The word at `index` of the current round, for the speech route. Only words of a started round are spoken. */
export function wordToSay(state: RoomState, index: number): string | null {
  if (state.phase === 'lobby' || !Number.isInteger(index) || index < 0) return null;
  return state.roundWords[index] ?? null;
}
