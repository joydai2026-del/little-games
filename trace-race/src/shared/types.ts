// The room's shape, shared by the Worker, the phones and the agent.

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
  /** Index into roundChars of the character being traced now. */
  charIndex: number;
  /** Next stroke expected on that character (0-based). */
  strokeIndex: number;
  /** Characters finished this race. */
  charsDone: number;
  /** Wrong strokes this race. */
  mistakes: number;
  /** When the last character was finished, or null. */
  finishedAt: number | null;
  /** When this racer reached where they are now (last correct stroke), for tie-breaks. */
  lastProgressAt: number | null;
  /** Correct strokes this race, for the server-side pace floor. */
  strokesDone: number;
  /** Highest stroke sequence number applied this race. Repeats at or below it are no-ops. */
  seq: number;
}

/** What the room knows about the teacher's list after the stroke lookup. */
export interface CharList {
  /** Traceable characters, in order. */
  chars: string[];
  /** Characters the teacher typed that have no stroke data. */
  missing: string[];
  /** Stroke count for every traceable character. */
  strokeCounts: Record<string, number>;
  repeats: number;
  overflow: string[];
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
  roundChars: string[];
  /** Strokes count from this moment (end of the countdown). */
  goAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  players: Player[];
  /** One entry per racer in the current race. The roster is frozen at Start: late joiners wait for the next race. */
  progress: Record<string, Progress>;
}

export interface Standing {
  playerId: string;
  name: string;
  agent: boolean;
  charsDone: number;
  mistakes: number;
  finished: boolean;
  /** The character this kid is on, or null when finished. */
  currentChar: string | null;
  strokeIndex: number;
  place: number;
}

export interface PublicState extends RoomState {
  you: string;
  /** Kids who are here right now: the teacher's "Kids here" list and the next Start roster (presentKids). */
  present: string[];
  role: Role;
  standings: Standing[];
  serverNow: number;
}
