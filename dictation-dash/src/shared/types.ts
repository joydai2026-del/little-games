// The room's shape, shared by the Worker, the phones and the agent.

import type { DashOptions } from './config';

export type Phase = 'lobby' | 'racing' | 'done';
export type Role = 'teacher' | 'kid';
export type Mode = 'class' | 'solo';
export type StrokeResult = 'correct' | 'mistake';

export interface Player {
  id: string;
  name: string;
  role: Role;
  /** Joined through the API as an AI player. Shown as "AI" on the board. */
  agent: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface Progress {
  /** Index into roundWords of the word being written now. */
  wordIndex: number;
  /** Character of that word being written now (0-based). */
  charIndex: number;
  /** Next stroke expected on that character (0-based). */
  strokeIndex: number;
  /** Words written all the way through this round. */
  wordsDone: number;
  /** Words skipped (the word did not play, or its time ran out). */
  wordsSkipped: number;
  /** Wrong strokes this round. Shown, never scored: a wrong stroke only wiggles. */
  mistakes: number;
  /** Correct strokes this round: the pace floor and the tie-break. */
  strokesDone: number;
  /** When the last word was written or skipped, or null. */
  finishedAt: number | null;
  /** When this player last wrote a correct stroke, for ties. */
  lastProgressAt: number | null;
  /** Highest send sequence number applied this round. Repeats at or below it are no-ops. */
  seq: number;
}

/** What the room knows about the teacher's word list after the stroke lookup. */
export interface WordList {
  /** Writable words, in order. */
  words: string[];
  /** Words with a character we have no stroke data for. */
  missing: string[];
  /** Words longer than GAME.maxWordChars. */
  tooLong: string[];
  /** Stroke count for every character of every writable word. */
  strokeCounts: Record<string, number>;
  repeats: number;
  overflow: string[];
}

export interface RoomState {
  code: string;
  mode: Mode;
  version: number;
  hostId: string;
  createdAt: number;
  expiresAt: number;
  phase: Phase;
  options: DashOptions;
  list: WordList;
  /** Rounds run so far. 0 in the first lobby. */
  round: number;
  roundWords: string[];
  /** Strokes count from this moment (end of the countdown). */
  goAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  players: Player[];
  /** One entry per player in the current round. Frozen at Start: late joiners wait for the next round. */
  progress: Record<string, Progress>;
}

export interface Standing {
  playerId: string;
  name: string;
  agent: boolean;
  wordsDone: number;
  wordsSkipped: number;
  finished: boolean;
  place: number;
}

export interface PublicState extends RoomState {
  you: string;
  /** Kids here right now: the teacher's "Kids here" list and the next Start roster. */
  present: string[];
  role: Role;
  standings: Standing[];
  serverNow: number;
}
