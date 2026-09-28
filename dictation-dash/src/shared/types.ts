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
  /** Wrong strokes this round. Never scored: a wrong stroke only wiggles. */
  mistakes: number;
  /** Misses on the stroke being written now (the hint shows after GAME.hintAfterMisses). */
  strokeMisses: number;
  /** Strokes accepted only after the hint on Hard (they score less). */
  helped: number;
  /** Wrong strokes on the word in progress (capped by GAME.maxMissesPerWord). */
  wordMisses: number;
  /** When this player's last stroke was graded (the per-stroke gap). */
  lastGradedAt: number | null;
  /** The kid's OWN accepted drawing for the word in progress: per character, per stroke, [x, y] points (thinned). */
  drawn: number[][][][];
  /** The room tried to serve this word's clip to this player and could not (a skip is then allowed without hearing). */
  serveFailed: boolean;
  /** Correct strokes this round, counted or not: the pace floor only. */
  strokesDone: number;
  /** Correct strokes that SCORE: strokes on written words plus the word in progress. A skipped word's strokes are taken back. */
  scoreStrokes: number;
  /** Correct strokes on the word in progress (taken back if it is skipped). */
  wordStrokes: number;
  /** When the room first served this player the current word's audio (starts the word clock), or null. */
  heardAt: number | null;
  /** The current word's deadline, set by the room when it first serves the audio. Later strokes are refused. */
  deadlineAt: number | null;
  /** When the last word was written or skipped, or null. */
  finishedAt: number | null;
  /** When this player's score last went up, for ties. */
  lastProgressAt: number | null;
  /** lastProgressAt when the current word began (restored if the word is skipped). */
  wordStartProgressAt: number | null;
  /** How each closed word ended, in order. */
  results: ('written' | 'skipped')[];
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
  /** Headings left out by shape (第三课, a "生字：" label), in order. Always shown to the teacher. */
  skipped: string[];
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
  /** Rounds run so far (also the send id: it only goes up). 0 in the first lobby. */
  round: number;
  /** Where in the list the next round starts. Reset by a new list. */
  cursor: number;
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
  /** Strokes accepted only after the hint on Hard. */
  helped: number;
  finished: boolean;
  place: number;
}

/** One character's verified stroke data (hanzi-writer-data 2.0.1): SVG paths and medians. Server-only. */
export interface CharGeom {
  strokes: string[];
  medians: number[][][];
}

/** The list as a player sees it: the teacher gets the words; a writer gets only how many. */
export type PublicList = Omit<WordList, 'strokeCounts'> & { count: number };

/**
 * What ONE writer may know about their own round. Never the word, never how
 * many strokes a character has: only the audio handle, the grid count, and the
 * strokes the room already accepted (as geometry to redraw). Easy adds the
 * current character's outline, after the word was heard.
 */
export interface MyRound {
  wordIndex: number;
  charIndex: number;
  /** How many 田字格 the current word needs. */
  charCount: number | null;
  /** Opaque audio handle for the current word (a URL with round and index, no text). */
  audio: string | null;
  heard: boolean;
  deadlineAt: number | null;
  /** How long this word's clock is, in ms (bucketed), or null before hearing. */
  clockMs: number | null;
  /** Accepted strokes as the kid's OWN drawn points (never the canonical shapes), per character written so far. */
  accepted: number[][][][];
  /** Easy only, after hearing: the current character's outline paths. */
  outline: string[] | null;
  /** After GAME.hintAfterMisses misses on one stroke: that stroke's path, as a hint. */
  hint: string | null;
  wordsDone: number;
  wordsSkipped: number;
  mistakes: number;
  seq: number;
  finishedAt: number | null;
  /** This player's closed words, with how each ended. The word text only once that word is closed for EVERYONE in the round. */
  closed: { word: string | null; result: 'written' | 'skipped' }[];
  /** Wrong strokes left on this word before the room stops grading it. */
  missesLeft: number;
}

export interface PublicState {
  code: string;
  mode: Mode;
  version: number;
  hostId: string;
  createdAt: number;
  expiresAt: number;
  phase: Phase;
  options: DashOptions;
  list: PublicList;
  round: number;
  /** Words in the current round. */
  roundSize: number;
  /** The round's words: the teacher always; writers only once the round is over. */
  roundWords: string[];
  goAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  players: Player[];
  you: string;
  /** Kids here right now: the teacher's "Kids here" list and the next Start roster. */
  present: string[];
  role: Role;
  standings: Standing[];
  /** This viewer's own round, or null (teacher, or joined after Start). */
  me: MyRound | null;
  serverNow: number;
}
