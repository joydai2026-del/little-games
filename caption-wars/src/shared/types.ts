// Shared data model. This is the plan's contract verbatim
// (docs/plans/2026-09-07-mvp-plan.md, "Data model" section). Do not change
// these shapes without updating the plan.

export type Phase = 'lobby' | 'caption' | 'vote' | 'reveal' | 'done';

export interface RoomOptions {
  rounds: number;
  captionSeconds: number;
  voteSeconds: number;
  revealSeconds: number;
  botCount: number;
}

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  connected: boolean;
}

export interface Photo {
  url: string;
  source: 'loremflickr' | 'picsum';
  credit?: string;
}

export interface Caption {
  id: string;
  playerId: string;
  text: string;
}

export interface RoundResult {
  round: number;
  photo: Photo;
  captions: Caption[];
  votes: Record<string, string>;
  winnerCaptionIds: string[];
}

export interface RoomState {
  code: string;
  version: number;
  phase: Phase;
  round: number;
  options: RoomOptions;
  hostId: string;
  players: Player[];
  photo?: Photo;
  captions: Caption[];
  votes: Record<string, string>;
  phaseEndsAt?: number;
  history: RoundResult[];
  championIds?: string[];
  nextPollMs: number;
}

/** A reducer result: either a new state, or the old state plus an error for the caller to surface. */
export interface RoomResult {
  state: RoomState;
  error?: string;
}
