// The whole Missing Stroke game as pure functions. The Durable Object (and
// solo mode on one phone) only persists, checks secrets, reads the clock and
// arms the alarm; every rule is here so it can be unit-tested without
// Cloudflare.
//
// A race is a row of characters. Each character is one "turn": it opens for
// everyone at the same moment with ONE stroke missing, kids draw the missing
// stroke, the fastest right stroke wins the character. The turn closes when
// the clock runs out, when everyone has it, or GAME.graceAfterFirstRightMs
// after the first right stroke. Then everyone sees the answer for
// GAME.revealMs, and the next character opens.

import { GAME, LEVELS, normalizeOptions, type RaceOptions } from './config';
import type { CharGeom, CharList, Player, Progress, PublicState, PublicTurn, RoomState, Standing, Turn, TurnResult } from './types';
import { gradeStroke, parsePoints, type Point, type Verdict } from './matcher';

export interface Result {
  state: RoomState;
  /** For an answer: how the room graded it. */
  verdict?: Verdict;
  error?: string;
  /** HTTP-ish status for the error: 400 bad input, 403 not allowed, 409 wrong moment, 429 too fast. */
  status?: number;
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

function freshProgress(): Progress {
  return { wins: 0, rights: 0, mistakes: 0, totalMs: 0, seq: 0, turn: 0, rightAt: null, turnMistakes: 0 };
}

export function kids(state: RoomState): Player[] {
  return state.players.filter((p) => p.role === 'kid');
}

/**
 * THE list of kids who are here: what the teacher's "Kids here" shows AND who
 * races when the teacher taps Start. One function, so the screen and the
 * roster can never disagree.
 */
export function presentKids(state: RoomState, now: number): Player[] {
  return kids(state).filter((k) => now - k.lastSeenAt <= GAME.rosterActiveMs);
}

export function createRoom(
  code: string,
  host: { id: string; name: string },
  options: Partial<Record<keyof RaceOptions, unknown>> | undefined,
  list: CharList,
  now: number
): RoomState {
  return {
    code,
    version: 1,
    hostId: host.id,
    createdAt: now,
    expiresAt: now + ttlMs(),
    phase: 'lobby',
    options: normalizeOptions(options),
    list,
    round: 0,
    listPos: 0,
    roundChars: [],
    hidden: [],
    goAt: null,
    turn: null,
    results: [],
    endedAt: null,
    players: [
      { id: host.id, name: cleanName(host.name) || 'Teacher', role: 'teacher', agent: false, joinedAt: now, lastSeenAt: now },
    ],
    progress: {},
  };
}

export function join(state: RoomState, who: { id: string; name: string; agent?: boolean }, now: number): Result {
  const name = cleanName(who.name);
  if (!name) return fail(state, 'please type your name', 400);
  // The cap counts kids who are HERE, so seats of kids who left are reused. The
  // player list itself is bounded by maxPlayersEver (names only, for the room's life).
  const recent = state.players.filter((p) => p.role === 'kid' && now - p.joinedAt < GAME.joinWindowMs).length;
  if (recent >= GAME.joinsPerRoomPerWindow) return fail(state, 'lots of people are joining right now, wait a minute and try again', 429);
  if (presentKids(state, now).length >= GAME.maxKids) return fail(state, 'this room is full', 409);
  if (state.players.length >= GAME.maxPlayersEver) return fail(state, 'this room is full, ask your teacher for a new one', 409);
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
  // A new list starts from its first character.
  return { state: bump({ ...state, list, listPos: 0 }) };
}

export function setOptions(state: RoomState, byId: string, input: Partial<Record<keyof RaceOptions, unknown>>): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change settings', 403);
  if (state.phase === 'racing') return fail(state, 'wait for this race to end', 409);
  return { state: bump({ ...state, options: normalizeOptions({ ...state.options, ...input }) }) };
}

/**
 * The characters for the next game: `perRound` of them starting at list
 * position `pos`, wrapping, never repeating inside one game. Starting from a
 * stored position (not round x count) means changing "characters per game"
 * between games never skips or repeats characters.
 */
export function charsForRound(list: string[], pos: number, perRound: number): string[] {
  if (list.length === 0) return [];
  const count = Math.min(perRound, list.length);
  const at = Number.isInteger(pos) ? pos : 0; // a room saved before listPos existed starts at the top
  const startAt = ((at % list.length) + list.length) % list.length;
  return Array.from({ length: count }, (_, i) => list[(startAt + i) % list.length]);
}

/**
 * Which stroke is missing: a pure function of the stroke count, the race's
 * seed and the character's place in the race, so every phone in the room (and
 * a replay) agrees without sending anything extra. Always in [0, strokeCount).
 */
export function hiddenStrokeFor(strokeCount: number, seed: number, index: number): number {
  if (!Number.isInteger(strokeCount) || strokeCount < 1) return 0;
  // xorshift-style integer mix of (seed, index); no floating point drift.
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) % strokeCount;
}

export const secondsPerChar = (options: RaceOptions) => LEVELS[options.level].secondsPerChar;
export const hintAfterMisses = (options: RaceOptions) => LEVELS[options.level].hintAfterMisses;

/**
 * Wrong tries left before the hint shows on a pad that is (re)built after
 * `alreadyMissed` wrong tries on this character: a kid whose pad reloads
 * mid-character does not have to earn the hint again. Never below 1 (the pad
 * only flashes the hint after a miss, never before the first try).
 */
export function hintMissesLeft(hintAfter: number, alreadyMissed: number): number {
  return Math.max(1, hintAfter - Math.max(0, alreadyMissed));
}

function openTurn(state: RoomState, index: number, at: number): RoomState {
  const turn: Turn = {
    index,
    char: state.roundChars[index],
    hidden: state.hidden[index],
    opensAt: at,
    closesAt: at + secondsPerChar(state.options) * 1000,
    closedAt: null,
    firstRightAt: null,
    winners: [],
  };
  const progress: Record<string, Progress> = {};
  for (const [id, p] of Object.entries(state.progress)) progress[id] = { ...p, turn: index, rightAt: null, turnMistakes: 0 };
  return { ...state, turn, progress };
}

/** The characters the next Start would use. */
export function nextChars(state: RoomState): string[] {
  const pos = Number.isInteger(state.listPos) ? state.listPos : 0;
  return charsForRound(state.list.chars, pos, state.options.charsPerRound);
}

/** Lobby -> racing (Start) and done -> racing (Race again). `seed` picks the missing strokes. */
export function startRace(state: RoomState, byId: string, now: number, seed: number): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can start', 403);
  if (state.phase === 'racing') return fail(state, 'the race is already on', 409);
  if (state.list.chars.length === 0) return fail(state, 'the list has no characters we can use yet', 409);
  const active = presentKids(state, now);
  if (active.length === 0) return fail(state, 'wait for at least one kid to join', 409);
  const pos = Number.isInteger(state.listPos) ? state.listPos : 0;
  const roundChars = charsForRound(state.list.chars, pos, state.options.charsPerRound);
  const hidden = roundChars.map((c, i) => hiddenStrokeFor(state.list.strokeCounts[c] ?? 1, seed >>> 0, i));
  const goAt = now + GAME.countdownSeconds * 1000;
  const progress: Record<string, Progress> = {};
  for (const kid of active) progress[kid.id] = freshProgress();
  // Longest possible race: every character runs its whole clock plus the reveal.
  const longest = roundChars.length * (secondsPerChar(state.options) * 1000 + GAME.revealMs);
  const started: RoomState = {
    ...state,
    phase: 'racing',
    round: state.round + 1,
    listPos: state.list.chars.length ? (pos + roundChars.length) % state.list.chars.length : 0,
    roundChars,
    hidden,
    goAt,
    results: [],
    endedAt: null,
    // A room never expires in the middle of a race.
    expiresAt: Math.max(state.expiresAt, goAt + longest + ttlMs()),
    progress,
  };
  return { state: bump(openTurn(started, 0, goAt)) };
}

/** Kids in the current race (the roster frozen at Start). */
export function racers(state: RoomState): Player[] {
  return kids(state).filter((k) => state.progress[k.id] !== undefined);
}

function everyoneRight(state: RoomState): boolean {
  const list = racers(state);
  return list.length > 0 && list.every((k) => state.progress[k.id]!.rightAt != null);
}

/** When the open turn closes by the clock: its own end, or the grace after the first right stroke. */
export function turnDeadline(turn: Pick<Turn, 'closesAt' | 'firstRightAt'>): number {
  if (turn.firstRightAt != null && GAME.graceAfterFirstRightMs > 0) {
    return Math.min(turn.closesAt, turn.firstRightAt + GAME.graceAfterFirstRightMs);
  }
  return turn.closesAt;
}

function closeTurn(state: RoomState, at: number): RoomState {
  const turn = state.turn!;
  const times: Record<string, number> = {};
  for (const k of racers(state)) {
    const p = state.progress[k.id]!;
    if (p.rightAt != null) times[k.id] = p.rightAt - turn.opensAt;
  }
  const result: TurnResult = { char: turn.char, hidden: turn.hidden, winners: turn.winners, times };
  return { ...state, turn: { ...turn, closedAt: at }, results: [...state.results, result] };
}

/**
 * Moves the race along the clock: closes the open character, ends the answer
 * reveal, opens the next character, ends the race. Loops, so one late alarm
 * catches up on every step it missed. Returns the same object when nothing
 * changed.
 */
export function advanceIfDue(state: RoomState, now: number): RoomState {
  let s = state;
  for (let guard = 0; guard <= s.roundChars.length * 2 + 2; guard++) {
    if (s.phase !== 'racing' || !s.turn) break;
    const turn = s.turn;
    if (turn.closedAt == null) {
      if (everyoneRight(s)) {
        const last = Math.max(...racers(s).map((k) => s.progress[k.id]!.rightAt!));
        s = closeTurn(s, Math.min(now, last));
        continue;
      }
      const deadline = turnDeadline(turn);
      if (now < deadline) break;
      s = closeTurn(s, deadline);
      continue;
    }
    const revealEnd = turn.closedAt + GAME.revealMs;
    if (now < revealEnd) break;
    if (turn.index + 1 >= s.roundChars.length) {
      s = { ...s, phase: 'done', endedAt: revealEnd, expiresAt: Math.max(s.expiresAt, now + ttlMs()) };
      break;
    }
    s = openTurn(s, turn.index + 1, revealEnd);
  }
  return s === state ? state : bump(s);
}

export interface StrokeInput {
  /** The race this answer belongs to (state.round). An answer from another race is refused. */
  race: number;
  /** This racer's counter for the race, 1, 2, 3... A number already applied is a no-op. */
  seq: number;
  /** The character (state.turn.index) this answer is for. */
  turn: number;
  /** The stroke as drawn, in stroke-data coordinates. The room grades it; a bare "correct" is refused. */
  points: Point[];
}

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseStrokeInput(body: Record<string, unknown>): StrokeInput | null {
  const { race, seq, turn } = body;
  if (!nonNegInt(race) || !nonNegInt(seq) || seq < 1 || !nonNegInt(turn)) return null;
  const points = parsePoints(body.points);
  if (!points) return null;
  return { race, seq, turn, points };
}

/**
 * One drawn stroke from a kid (or an agent). The room grades the points
 * against the missing stroke (`geom` is the open character's stroke data).
 * Every answer names its race and carries a per-racer sequence number, so a
 * retried request, a replay from an earlier race, or a double-sent mistake
 * can never count twice. A right stroke must respect the pace floor
 * (GAME.minAnswerMs).
 */
export function submitStroke(
  state: RoomState,
  playerId: string,
  input: StrokeInput,
  now: number,
  geom: CharGeom | null | undefined
): Result & { duplicate?: boolean } {
  if (state.phase !== 'racing' || !state.turn) return fail(state, 'the race is not on right now', 409);
  if (input.race !== state.round) return fail(state, 'that answer was for a different race', 409);
  if (state.goAt != null && now < state.goAt) return fail(state, 'wait for GO', 409);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.role !== 'kid') return fail(state, 'only racers can draw', 403);
  const prog = state.progress[playerId];
  if (!prog) return fail(state, 'this race started before you joined, you are in the next one', 409);
  if (input.seq <= prog.seq) return { state, duplicate: true };
  if (input.seq > prog.seq + GAME.maxSeqJump) return fail(state, 'that answer number is too far ahead', 400);

  const turn = state.turn;
  if (input.turn !== turn.index || turn.closedAt != null) return fail(state, 'that character is over', 409);
  if (prog.rightAt != null) return fail(state, 'you already got this one', 409);
  if (!geom || !geom.medians[turn.hidden]) return fail(state, 'the strokes are still loading, try again', 503);

  const verdict = gradeStroke(input.points, geom.medians, turn.hidden);
  if (verdict === 'correct' && now < turn.opensAt + GAME.minAnswerMs) return fail(state, 'too fast, slow down a little', 429);
  let next: Progress;
  let nextTurn = turn;
  if (verdict === 'mistake') {
    next = { ...prog, mistakes: prog.mistakes + 1, turnMistakes: prog.turnMistakes + 1, seq: input.seq };
  } else {
    const ms = now - turn.opensAt;
    next = { ...prog, rights: prog.rights + 1, totalMs: prog.totalMs + ms, rightAt: now, seq: input.seq };
    if (turn.firstRightAt == null || now === turn.firstRightAt) {
      // The fastest right stroke wins the character; an exact same-millisecond tie shares it.
      next = { ...next, wins: next.wins + 1 };
      nextTurn = { ...turn, firstRightAt: now, winners: [...turn.winners, playerId] };
    }
  }
  const updated = bump({ ...state, turn: nextTurn, progress: { ...state.progress, [playerId]: next } });
  return { state: advanceIfDue(updated, now), verdict };
}

/**
 * The ranking key, used for BOTH the order and the place number: characters
 * won (more first), characters right (more first), mistakes (fewer first),
 * total time on right answers (less first). Mistakes and time only count once
 * a kid has got one right: trying and missing never ranks a kid below a kid
 * who has not touched the pad.
 */
function rankKey(p: Progress): [number, number, number, number] {
  const scored = p.rights > 0;
  return [-p.wins, -p.rights, scored ? p.mistakes : 0, scored ? p.totalMs : Number.MAX_SAFE_INTEGER];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The race board, best first. Only kids in the current race are on it. Equal keys share a place. */
export function standings(state: RoomState): Standing[] {
  const rows = racers(state).map((k) => ({ k, p: state.progress[k.id]!, key: rankKey(state.progress[k.id]!) }));
  rows.sort((a, b) => compareKeys(a.key, b.key));
  let place = 0;
  return rows.map(({ k, p, key }, i) => {
    if (i === 0 || compareKeys(rows[i - 1].key, key) !== 0) place = i + 1;
    const right = p.rightAt != null && state.turn != null;
    return {
      playerId: k.id,
      name: k.name,
      agent: k.agent,
      wins: p.wins,
      rights: p.rights,
      mistakes: p.mistakes,
      now: right ? 'right' : p.turnMistakes > 0 ? 'trying' : 'none',
      nowMs: right ? p.rightAt! - state.turn!.opensAt : null,
      place,
    };
  });
}

export function touch(state: RoomState, playerId: string, now: number): RoomState {
  const players = state.players.map((p) => (p.id === playerId ? { ...p, lastSeenAt: now } : p));
  return { ...state, players };
}

/**
 * The open character as `viewerId` may see it: never the missing stroke's
 * number; its shape only after the character closes, once this player got it
 * right, or as this player's earned hint.
 */
export function publicTurn(state: RoomState, viewerId: string, geom: CharGeom | null | undefined): PublicTurn | null {
  const t = state.turn;
  if (!t) return null;
  const { hidden, ...rest } = t;
  const visible = geom ? geom.strokes.filter((_, i) => i !== hidden) : [];
  const mine = state.progress[viewerId];
  const right = mine?.turn === t.index && mine.rightAt != null;
  const hinted = mine?.turn === t.index && mine.turnMistakes >= hintAfterMisses(state.options);
  const show = t.closedAt != null || right || hinted;
  return { ...rest, visible, answer: show && geom ? geom.strokes[hidden] ?? null : null, hint: show && !right && t.closedAt == null };
}

export function publicView(state: RoomState, viewerId: string, now: number, geom?: CharGeom | null): PublicState {
  const me = state.players.find((p) => p.id === viewerId);
  const { hidden, turn, ...rest } = state;
  return {
    ...rest,
    turn: publicTurn(state, viewerId, geom),
    you: viewerId,
    role: me?.role ?? 'kid',
    standings: standings(state),
    present: presentKids(state, now).map((k) => k.id),
    serverNow: now,
    rules: {
      secondsPerChar: secondsPerChar(state.options),
      hintAfterMisses: hintAfterMisses(state.options),
      revealMs: GAME.revealMs,
      graceAfterFirstRightMs: GAME.graceAfterFirstRightMs,
      minAnswerMs: GAME.minAnswerMs,
    },
  };
}

/** The single alarm: the next step of the race while racing, otherwise the room's expiry. */
export function nextAlarmAt(state: RoomState, now: number): number {
  const candidates = [state.expiresAt];
  if (state.phase === 'racing' && state.turn) {
    candidates.push(state.turn.closedAt == null ? turnDeadline(state.turn) : state.turn.closedAt + GAME.revealMs);
  }
  return Math.max(now, Math.min(...candidates));
}
