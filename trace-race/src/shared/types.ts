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
  /** When the last correct stroke landed, for tie-breaks. */
  lastProgressAt: number | null;
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
  role: Role;
  standings: Standing[];
  serverNow: number;
}
