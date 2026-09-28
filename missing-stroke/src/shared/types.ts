// The room's shape, shared by the Worker, the phones, solo mode and the agent.

import type { RaceOptions } from './config';

export type Phase = 'lobby' | 'racing' | 'done';
export type Role = 'teacher' | 'kid';
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
  /** Characters this racer won (fastest right stroke, ties share). */
  wins: number;
  /** Characters this racer got right. */
  rights: number;
  /** Wrong strokes this race. */
  mistakes: number;
  /** Sum of the times (ms from the character opening) of this racer's right strokes. Tie-break. */
  totalMs: number;
  /** Highest sequence number applied this race. Repeats at or below it are no-ops. */
  seq: number;
  /** The character (turn index) the two fields below describe. */
  turn: number;
  /** When this racer got the current character right, or null. */
  rightAt: number | null;
  /** Wrong strokes on the current character (drives the hint on the phone). */
  turnMistakes: number;
}

/** What the room knows about the teacher's list after the stroke lookup. */
export interface CharList {
  /** Characters with stroke data, in order. */
  chars: string[];
  /** Characters the teacher typed that have no stroke data. */
  missing: string[];
  /** Characters with only one stroke (nothing would be left on screen), skipped. */
  skipped: string[];
  /** Stroke count for every playable character. */
  strokeCounts: Record<string, number>;
  repeats: number;
  overflow: string[];
}

/** The character on screen right now. */
export interface Turn {
  /** Index into roundChars. */
  index: number;
  char: string;
  /** Which stroke is missing (0-based). */
  hidden: number;
  opensAt: number;
  /** The clock's end for this character. */
  closesAt: number;
  /** When it closed (time, grace or everyone right), or null while open. */
  closedAt: number | null;
  /** First right stroke time, or null. */
  firstRightAt: number | null;
  /** Who was fastest (more than one only on an exact tie). */
  winners: string[];
}

/** A finished character, for the results screen. */
export interface TurnResult {
  char: string;
  hidden: number;
  winners: string[];
  /** Milliseconds from open to the right stroke, per racer who got it. */
  times: Record<string, number>;
}

export interface RoomState {
  code: string;
  version: number;
  hostId: string;
  createdAt: number;
  expiresAt: number;
  phase: Phase;
  options: RaceOptions;
  list: CharList;
  /** Races run so far. 0 in the first lobby. */
  round: number;
  /** Where the next game starts in list.chars (moves on by the characters each game used; 0 after a new list). */
  listPos: number;
  roundChars: string[];
  /** The missing stroke of each character in roundChars. */
  hidden: number[];
  /** First character opens at this moment (end of the countdown). */
  goAt: number | null;
  turn: Turn | null;
  results: TurnResult[];
  endedAt: number | null;
  players: Player[];
  /** One entry per racer in the current race. The roster is frozen at Start: late joiners wait for the next race. */
  progress: Record<string, Progress>;
}

export interface Standing {
  playerId: string;
  name: string;
  agent: boolean;
  wins: number;
  rights: number;
  mistakes: number;
  /** This racer on the current character: got it (with time), still trying, or nothing yet. */
  now: 'right' | 'trying' | 'none';
  nowMs: number | null;
  place: number;
}

/** One character's stroke data (hanzi-writer-data): SVG paths and median lines, same order. */
export interface CharGeom {
  strokes: string[];
  medians: number[][][];
}

/**
 * The open character as a player sees it. The missing stroke's NUMBER is never
 * sent: `visible` is the other strokes' shapes in order, with no labels, and
 * `answer` (the missing stroke's shape) appears only after the character
 * closes, for a player who got it right, or as the earned hint.
 */
export interface PublicTurn extends Omit<Turn, 'hidden'> {
  visible: string[];
  answer: string | null;
  /** True when `answer` is here only as this player's hint. */
  hint: boolean;
}

export interface PublicState extends Omit<RoomState, 'hidden' | 'turn'> {
  turn: PublicTurn | null;
  you: string;
  /** Kids who are here right now: the teacher's "Kids here" list and the next Start roster (presentKids). */
  present: string[];
  role: Role;
  standings: Standing[];
  serverNow: number;
  /** The timing rules this room plays by (from config and the level), so phones and agents never hardcode them. */
  rules: Rules;
}

export interface Rules {
  secondsPerChar: number;
  hintAfterMisses: number;
  revealMs: number;
  graceAfterFirstRightMs: number;
  minAnswerMs: number;
}
