// The room's shape, shared by the Worker, the phones and the agent.
//
// RoomState is what the Durable Object keeps. It holds the answers, so it is
// NEVER sent as is: publicView() turns it into a PublicState for one viewer,
// and a kid (or an agent) never sees the drawn character or the right card
// of a question that is still open.

import type { RevealOptions } from './config';

export type Phase = 'lobby' | 'playing' | 'done';
export type Role = 'teacher' | 'kid';

export interface Player {
  id: string;
  name: string;
  role: Role;
  /** Joined through the API as an AI player. Shown as "AI" on the board. */
  agent: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

/** One character Momo draws, with the cards the kids pick from. */
export interface Question {
  /** The word on the right card. */
  word: string;
  /** The character Momo draws: the first character of `word`. */
  char: string;
  /** Strokes in `char` (bundled counts, no CDN call). */
  strokes: number;
  /** Word cards in the order every phone shows them. */
  cards: string[];
  /** Index of the right card in `cards`. */
  answer: number;
}

/** One kid's try at the current question. */
export interface Attempt {
  /** Wrong cards this kid tapped (indexes into cards). */
  tried: number[];
  /** Locked out of this question (a wrong guess at a level that locks). */
  locked: boolean;
  /** Cards stay grey until this moment after a wrong guess (levels that do not lock). */
  coolUntil: number | null;
  /** When this kid tapped the right card, or null. */
  correctAt: number | null;
  /** Points won on this question. */
  points: number;
}

/** One kid's round so far. The roster is frozen at Start: late joiners wait for the next round. */
export interface Score {
  points: number;
  correct: number;
  wrong: number;
  /** Highest guess sequence number applied this round. Repeats at or below it are no-ops. */
  seq: number;
}

/** What the room knows about the teacher's list after the stroke lookup. */
export interface WordList {
  /** Playable word cards, in order. */
  words: string[];
  /** Words whose first character has no stroke data (Momo cannot draw them). */
  missing: string[];
  /** Stroke count of every playable word's first character. */
  strokeCounts: Record<string, number>;
  repeats: number;
  overflow: string[];
  /** Headings the parser skipped (by shape, never by keyword). */
  skipped: string[];
}

export interface RoomState {
  code: string;
  version: number;
  hostId: string;
  createdAt: number;
  expiresAt: number;
  phase: Phase;
  options: RevealOptions;
  list: WordList;
  /** Rounds started so far. 0 in the first lobby. */
  round: number;
  questions: Question[];
  /** Index of the question on screen now. */
  qIndex: number;
  /** Drawing of the current question starts at this moment (the end of the countdown for the first). */
  qStartAt: number | null;
  /** Guessing closes at this moment if not everyone is done sooner. */
  qEndsAt: number | null;
  /** When the current question closed (the answer is showing), or null while open. */
  qClosedAt: number | null;
  endedAt: number | null;
  players: Player[];
  /** One entry per player in the current round. */
  scores: Record<string, Score>;
  /** One entry per player who has tapped a card on the current question. */
  attempts: Record<string, Attempt>;
}

export type QuestionStatus = 'thinking' | 'got' | 'out';

export interface Standing {
  playerId: string;
  name: string;
  agent: boolean;
  points: number;
  correct: number;
  place: number;
  /** How this kid is doing on the current question (never which card they tapped). */
  status: QuestionStatus;
}

/** The current question as one viewer may see it. */
export interface PublicQuestion {
  index: number;
  total: number;
  cards: string[];
  startAt: number;
  endsAt: number;
  closedAt: number | null;
  /** When the next question (or the end) comes, once this one is closed. */
  nextAt: number | null;
  /** Milliseconds between strokes at this level. */
  strokeMs: number;
  /** The drawn character, stroke count and right card: teacher always, kids only once closed. */
  char: string | null;
  strokes: number | null;
  answer: number | null;
}

export interface PublicState {
  code: string;
  version: number;
  phase: Phase;
  options: RevealOptions;
  list: WordList;
  round: number;
  endedAt: number | null;
  /** The room is gone after this moment. */
  expiresAt: number;
  players: Player[];
  you: string;
  role: Role;
  /** Kids who are here right now: the teacher's "Kids here" list and the next Start roster. */
  present: string[];
  /** Whether you are playing this round (false = joined late, you play the next one). */
  inRound: boolean;
  question: PublicQuestion | null;
  /** Your own try at the current question, or null. */
  mine: Attempt | null;
  /** Your round score, or null. */
  score: Score | null;
  /** Questions already closed this round: the word and its drawn character. */
  history: { word: string; char: string }[];
  standings: Standing[];
  serverNow: number;
}
