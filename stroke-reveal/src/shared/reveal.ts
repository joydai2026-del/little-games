// The whole game as pure functions. The Durable Object only persists, checks
// secrets, reads the clock, draws a random seed and arms the alarm; every rule
// is here so it can be unit-tested without Cloudflare.
//
// A round is a row of questions. For each one Momo draws one character stroke
// by stroke on the big screen, and every kid picks one of the word cards on
// their phone. Timeline of one question:
//
//   qStartAt ........ first stroke starts drawing
//   + firstStrokeShowMs + minRevealDelayMs ... openAt: guessing opens, points count from here
//   + strokes x strokeMs ... the drawing is complete
//   + holdAfterDrawnMs ..... qEndsAt: guessing closes (sooner if every kid is done)
//   qClosedAt ....... the answer shows for answerShowMs, then the next question
//                     starts (or the round is done after the last one)

import { GAME, LEVELS, SCORING, normalizeOptions, type RevealOptions } from './config';
import { drawnChar } from './parse';
import type { Attempt, Player, PublicQuestion, PublicState, Question, QuestionStatus, RoomState, Score, Standing, WordList } from './types';

export interface Result {
  state: RoomState;
  error?: string;
  /** HTTP-ish status for the error: 400 bad input, 403 not allowed, 409 wrong moment, 429 wait. */
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

export function kids(state: RoomState): Player[] {
  return state.players.filter((p) => p.role === 'kid');
}

/** THE list of kids who are here: the teacher's "Kids here" AND who plays when the teacher taps Start. */
export function presentKids(state: RoomState, now: number): Player[] {
  return kids(state).filter((k) => now - k.lastSeenAt <= GAME.rosterActiveMs);
}

/** Kids in the current round (the roster frozen at Start). */
export function players(state: RoomState): Player[] {
  return kids(state).filter((k) => state.scores[k.id] !== undefined);
}

export function createRoom(
  code: string,
  host: { id: string; name: string },
  options: Partial<RevealOptions> | undefined,
  list: WordList,
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
    questions: [],
    qIndex: 0,
    qStartAt: null,
    qEndsAt: null,
    qClosedAt: null,
    endedAt: null,
    players: [
      { id: host.id, name: cleanName(host.name) || 'Teacher', role: 'teacher', agent: false, joinedAt: now, lastSeenAt: now },
    ],
    scores: {},
    attempts: {},
    deck: [],
  };
}

export function join(state: RoomState, who: { id: string; name: string; agent?: boolean }, now: number): Result {
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
  // No score entry: a kid who joins mid-round watches and plays the next one.
  return { state: bump({ ...state, players: [...state.players, player] }) };
}

export function setList(state: RoomState, byId: string, list: WordList): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change the list', 403);
  if (state.phase === 'playing') return fail(state, 'wait for this round to end', 409);
  return { state: bump({ ...state, list, deck: [], round: state.phase === 'lobby' ? 0 : state.round }) };
}

export function setOptions(state: RoomState, byId: string, input: Partial<Record<keyof RevealOptions, unknown>>): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can change settings', 403);
  if (state.phase === 'playing') return fail(state, 'wait for this round to end', 409);
  return { state: bump({ ...state, options: normalizeOptions({ ...state.options, ...input }) }) };
}

/** Fisher-Yates with an injected random source, so tests are repeatable. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The cards for one word: the right one plus wrong ones from the teacher's own
 * list. A wrong card never starts with the drawn character (大 and 大人 would
 * both match the drawing), so there is always exactly one right card.
 * Returns null when the list has no word that starts with another character.
 */
export function buildQuestion(word: string, list: WordList, random: () => number, playerIds: string[] = []): Question | null {
  const char = drawnChar(word);
  const pool = list.words.filter((w) => drawnChar(w) !== char);
  if (pool.length < GAME.minCardsPerQuestion - 1) return null;
  const wrong = shuffle(pool, random).slice(0, GAME.cardsPerQuestion - 1);
  const cards = shuffle([word, ...wrong], random);
  const base = cards.map((_, i) => i);
  const orders: Record<string, number[]> = {};
  for (const id of playerIds) orders[id] = shuffle(base, random);
  return { word, char, strokes: list.strokeCounts[char] ?? 0, cards, answer: cards.indexOf(word), orders };
}

/**
 * Deals the next round's words from the private shuffled deck, refilling it
 * with a fresh shuffle when it runs out (never repeating a word inside one
 * round). Pasted order says nothing about play order.
 */
export function dealWords(deck: string[], words: string[], perRound: number, random: () => number): { picked: string[]; deck: string[] } {
  let d = deck.filter((w) => words.includes(w));
  const picked: string[] = [];
  const count = Math.min(perRound, words.length);
  while (picked.length < count) {
    if (d.length === 0) d = shuffle(words.filter((w) => !picked.includes(w)), random);
    if (d.length === 0) break;
    picked.push(d.shift()!);
  }
  return { picked, deck: d };
}

/** Taps count from here: stroke 1 fully visible on the big screen plus the minimum reveal delay. */
export function openAt(state: RoomState): number {
  return (state.qStartAt ?? 0) + GAME.firstStrokeShowMs + GAME.minRevealDelayMs;
}

/** Points reach the floor here: the drawing is complete (never sooner than one stroke after opening). */
function scoreEndAt(state: RoomState): number {
  const q = state.questions[state.qIndex];
  return Math.max((state.qStartAt ?? 0) + drawMs(state, q), openAt(state) + LEVELS[state.options.level].strokeMs);
}

/** A kid's own card index -> the room's card index (and back). */
const toBase = (q: Question, playerId: string, local: number): number => q.orders?.[playerId]?.[local] ?? local;
const toLocal = (q: Question, playerId: string, base: number): number => {
  const order = q.orders?.[playerId];
  return order ? order.indexOf(base) : base;
};

export function drawMs(state: RoomState, q: Question): number {
  return q.strokes * LEVELS[state.options.level].strokeMs;
}

/** Lobby -> playing (Start) and done -> playing (Play again). */
export function startRound(state: RoomState, byId: string, now: number, random: () => number): Result {
  if (byId !== state.hostId) return fail(state, 'only the teacher can start', 403);
  if (state.phase === 'playing') return fail(state, 'the game is already on', 409);
  if (state.list.words.length === 0) return fail(state, 'the list has no words Momo can draw yet', 409);
  const active = presentKids(state, now);
  if (active.length === 0) return fail(state, 'wait for at least one kid to join', 409);
  const questions: Question[] = [];
  const dealt = dealWords(state.deck ?? [], state.list.words, state.options.charsPerRound, random);
  for (const word of dealt.picked) {
    const q = buildQuestion(word, state.list, random, active.map((k) => k.id));
    if (!q) return fail(state, `add at least ${GAME.minCardsPerQuestion} words that start with different characters`, 409);
    questions.push(q);
  }
  const goAt = now + GAME.countdownSeconds * 1000;
  const scores: Record<string, Score> = {};
  for (const kid of active) scores[kid.id] = { points: 0, correct: 0, wrong: 0, seq: 0 };
  const next: RoomState = {
    ...state,
    phase: 'playing',
    round: state.round + 1,
    questions,
    qIndex: 0,
    qStartAt: goAt,
    qEndsAt: null,
    qClosedAt: null,
    endedAt: null,
    scores,
    attempts: {},
    deck: dealt.deck,
  };
  const qEndsAt = goAt + drawMs(next, questions[0]) + GAME.holdAfterDrawnMs;
  // A room never expires in the middle of a round.
  const roundMs = questions.reduce((sum, q) => sum + drawMs(next, q) + GAME.holdAfterDrawnMs + GAME.answerShowMs, 0);
  return { state: bump({ ...next, qEndsAt, expiresAt: Math.max(state.expiresAt, goAt + roundMs + ttlMs()) }) };
}

/** Every kid in the round has the right card or is locked out: the question can close early. */
export function everyoneDone(state: RoomState): boolean {
  // AI seats never hold a word open or close it early: only kids count.
  const list = players(state).filter((k) => !k.agent);
  return list.length > 0 && list.every((k) => {
    const a = state.attempts[k.id];
    return Boolean(a && (a.correctAt != null || a.locked));
  });
}

/**
 * Moves the clock forward: closes the question when time is up (or everyone
 * is done), starts the next one after the answer has shown, and ends the
 * round after the last. Loops, so a late alarm catches up in one call.
 * Returns the same object when nothing changed.
 */
export function advanceIfDue(state: RoomState, now: number): RoomState {
  if (state.phase !== 'playing') return state;
  let s = state;
  for (let guard = 0; guard <= s.questions.length * 2 + 1; guard++) {
    if (s.qClosedAt == null) {
      if (s.qEndsAt != null && now >= s.qEndsAt) s = { ...s, qClosedAt: s.qEndsAt };
      else if (now >= (s.qStartAt ?? 0) && everyoneDone(s)) s = { ...s, qClosedAt: now };
      else break;
    }
    const nextAt = s.qClosedAt! + GAME.answerShowMs;
    if (now < nextAt) break;
    if (s.qIndex + 1 >= s.questions.length) {
      s = { ...s, phase: 'done', endedAt: nextAt, expiresAt: Math.max(s.expiresAt, now + ttlMs()) };
      break;
    }
    const qIndex = s.qIndex + 1;
    s = { ...s, qIndex, qStartAt: nextAt, qEndsAt: nextAt + drawMs(s, s.questions[qIndex]) + GAME.holdAfterDrawnMs, qClosedAt: null, attempts: {} };
  }
  return s === state ? state : bump(s);
}

/** Points for a right card at `now`: maxPoints when guessing opens, down to minPoints once the drawing is complete. */
export function pointsAt(state: RoomState, now: number): number {
  const from = openAt(state);
  const frac = Math.min(1, Math.max(0, (now - from) / Math.max(1, scoreEndAt(state) - from)));
  return Math.round(SCORING.minPoints + (SCORING.maxPoints - SCORING.minPoints) * (1 - frac));
}

export interface GuessInput {
  /** The round this guess belongs to (state.round). */
  race: number;
  /** The question index it answers (question.index). */
  question: number;
  /** This player's guess counter for the round, 1, 2, 3... A number already applied is a no-op. */
  seq: number;
  /** Index of the tapped card. */
  card: number;
}

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseGuessInput(body: Record<string, unknown>): GuessInput | null {
  const { race, question, seq, card } = body;
  if (!nonNegInt(race) || !nonNegInt(question) || !nonNegInt(seq) || seq < 1 || !nonNegInt(card)) return null;
  return { race, question, seq, card };
}

const freshAttempt = (): Attempt => ({ tried: [], locked: false, coolUntil: null, correctAt: null, points: 0, rightCard: null });

/**
 * One tap on a card. Every guess names its round and question and carries a
 * per-player sequence number, so a retried request or a replay from an earlier
 * round can never count twice.
 */
export function submitGuess(state: RoomState, playerId: string, input: GuessInput, now: number): Result & { duplicate?: boolean } {
  if (state.phase !== 'playing') return fail(state, 'the game is not on right now', 409);
  if (input.race !== state.round) return fail(state, 'that guess was for a different round', 409);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.role !== 'kid') return fail(state, 'only players can guess', 403);
  const score = state.scores[playerId];
  if (!score) return fail(state, 'this round started before you joined, you play the next one', 409);
  if (input.seq <= score.seq) return { state, duplicate: true };
  if (input.seq > score.seq + GAME.maxSeqJump) return fail(state, 'that guess number is too far ahead', 400);
  if (input.question !== state.qIndex || state.qClosedAt != null) return fail(state, 'time is up for that word', 409);
  if (state.qStartAt != null && now < state.qStartAt) return fail(state, 'wait for Momo to start drawing', 409);
  if (now < openAt(state)) return fail(state, 'watch the first stroke, then tap', 409);
  const q = state.questions[state.qIndex];
  if (input.card >= q.cards.length) return fail(state, 'there is no card with that number', 400);
  const card = toBase(q, playerId, input.card);
  const a = state.attempts[playerId] ?? freshAttempt();
  if (a.correctAt != null) return fail(state, 'you already got this one', 409);
  if (a.locked) return fail(state, 'you are out for this word, wait for the next one', 409);
  if (a.coolUntil != null && now < a.coolUntil) return fail(state, 'wait a moment, then try again', 429);
  if (a.tried.includes(card)) return fail(state, 'you already tried that card', 409);

  let attempt: Attempt;
  let nextScore: Score;
  if (card === q.answer) {
    const points = pointsAt(state, now);
    attempt = { ...a, correctAt: now, points, coolUntil: null, rightCard: card };
    nextScore = { ...score, points: score.points + points, correct: score.correct + 1, seq: input.seq };
  } else {
    const rules = LEVELS[state.options.level];
    attempt = {
      ...a,
      tried: [...a.tried, card],
      locked: rules.lockOnWrong,
      coolUntil: rules.lockOnWrong ? null : now + Math.max(rules.wrongCooldownMs, Math.round(rules.wrongCooldownShare * drawMs(state, q))),
    };
    nextScore = { ...score, wrong: score.wrong + 1, seq: input.seq };
  }
  const updated = bump({
    ...state,
    attempts: { ...state.attempts, [playerId]: attempt },
    scores: { ...state.scores, [playerId]: nextScore },
  });
  return { state: advanceIfDue(updated, now) };
}

function statusOf(state: RoomState, playerId: string): QuestionStatus {
  const a = state.attempts[playerId];
  if (a?.correctAt != null) return 'got';
  if (a?.locked) return 'out';
  return 'thinking';
}

/**
 * The board, best first: points (more first), then right answers (more first).
 * Equal on both = same place. Kids and AI players are ranked apart
 * (`agents: true` gives the AI line), so an AI never takes a kid's place.
 */
export function standings(state: RoomState, agents = false): Standing[] {
  const rows = players(state).filter((k) => k.agent === agents).map((k) => ({ k, s: state.scores[k.id]! }));
  const key = (s: Score) => [-s.points, -s.correct];
  const cmp = (a: number[], b: number[]) => (a[0] - b[0]) || (a[1] - b[1]);
  rows.sort((a, b) => cmp(key(a.s), key(b.s)) || a.k.joinedAt - b.k.joinedAt);
  let place = 0;
  return rows.map(({ k, s }, i) => {
    if (i === 0 || cmp(key(rows[i - 1].s), key(s)) !== 0) place = i + 1;
    return { playerId: k.id, name: k.name, agent: k.agent, points: s.points, correct: s.correct, place, status: statusOf(state, k.id) };
  });
}

export function touch(state: RoomState, playerId: string, now: number): RoomState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, lastSeenAt: now } : p)) };
}

function publicQuestion(state: RoomState, viewerId: string, teacher: boolean): PublicQuestion | null {
  if (state.phase === 'lobby' || state.questions.length === 0) return null;
  const q = state.questions[state.qIndex];
  const closed = state.qClosedAt != null;
  const show = teacher || closed;
  const order = teacher ? null : q.orders?.[viewerId] ?? null;
  const cards = order ? order.map((i) => q.cards[i]) : q.cards;
  return {
    index: state.qIndex,
    total: state.questions.length,
    cards,
    startAt: state.qStartAt ?? 0,
    openAt: openAt(state),
    endsAt: teacher ? state.qEndsAt : null,
    closedAt: state.qClosedAt,
    nextAt: closed ? state.qClosedAt! + GAME.answerShowMs : null,
    strokeMs: LEVELS[state.options.level].strokeMs,
    char: show ? q.char : null,
    strokes: show ? q.strokes : null,
    answer: show ? (order ? order.indexOf(q.answer) : q.answer) : null,
  };
}

function ownAttempt(state: RoomState, viewerId: string): Attempt | null {
  const a = state.attempts[viewerId];
  if (!a) return null;
  const q = state.questions[state.qIndex];
  return { ...a, tried: a.tried.map((i) => toLocal(q, viewerId, i)), rightCard: a.rightCard == null ? null : toLocal(q, viewerId, a.rightCard) };
}

/**
 * What one viewer may see. The drawn character and the right card of an open
 * question go to the teacher only (the big screen); a kid or an agent sees
 * them once the question closes. Other kids' taps are never shown, only
 * whether they got it.
 */
export function publicView(state: RoomState, viewerId: string, now: number): PublicState {
  const me = state.players.find((p) => p.id === viewerId);
  const role = me?.role ?? 'kid';
  const closedCount = state.phase === 'lobby' ? 0 : state.qIndex + (state.qClosedAt != null ? 1 : 0);
  return {
    code: state.code,
    version: state.version,
    phase: state.phase,
    options: state.options,
    list: role === 'teacher' ? state.list : null,
    round: state.round,
    endedAt: state.endedAt,
    expiresAt: role === 'teacher' ? state.expiresAt : null,
    players: state.players,
    you: viewerId,
    role,
    present: presentKids(state, now).map((k) => k.id),
    inRound: state.scores[viewerId] !== undefined,
    question: publicQuestion(state, viewerId, role === 'teacher'),
    mine: ownAttempt(state, viewerId),
    score: state.scores[viewerId] ?? null,
    history: state.questions.slice(0, closedCount).map((q) => ({ word: q.word, char: q.char })),
    standings: standings(state),
    robots: standings(state, true),
    serverNow: now,
  };
}

/** How many strokes of the current drawing are on the big screen at `now` (0 before it starts, all once closed). */
export function strokesShown(state: RoomState, now: number): number {
  if (state.phase === 'lobby' || state.questions.length === 0) return 0;
  const q = state.questions[state.qIndex];
  if (state.qClosedAt != null || state.phase === 'done') return q.strokes;
  if (state.qStartAt == null || now < state.qStartAt) return 0;
  const strokeMs = LEVELS[state.options.level].strokeMs;
  return Math.min(q.strokes, Math.floor((now - state.qStartAt) / strokeMs) + 1);
}

/** The single alarm: the next moment the timeline moves while playing, otherwise the room's expiry. */
export function nextAlarmAt(state: RoomState, now: number): number {
  const candidates = [state.expiresAt];
  if (state.phase === 'playing') {
    if (state.qClosedAt == null && state.qEndsAt != null) candidates.push(state.qEndsAt);
    if (state.qClosedAt != null) candidates.push(state.qClosedAt + GAME.answerShowMs);
  }
  return Math.max(now, Math.min(...candidates));
}
