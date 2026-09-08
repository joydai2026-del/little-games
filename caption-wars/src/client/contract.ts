// The shapes the CLIENT codes against.
//
// `src/shared/types.ts` is the authoritative contract, but it is being
// updated in parallel with the amended API (see the "Contract changes" block
// at the bottom of docs/plans/2026-09-07-mvp-plan.md). Everything the client
// reads is declared here so this module typechecks on its own; the fields are
// deliberately permissive (optional where the server may or may not send them
// yet) so a partially-migrated server never crashes a screen.
//
// Reconcile with src/shared/types.ts once the worker lands.

import type { Phase, RoomOptions } from '../shared/types';

export type { Phase, RoomOptions };

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  /** Amended contract. Display only, never eligibility. */
  lastSeenAt?: number;
  /** Pre-amendment field, still tolerated. */
  connected?: boolean;
}

/** Photo metadata. The bytes come from GET /api/rooms/:code/photo/:round. */
export interface PhotoMetaView {
  round?: number;
  source?: string;
  credit?: string;
  sha256?: string;
  bytes?: number;
  /** Pre-amendment field: a direct image URL. Used only if `round` is absent. */
  url?: string;
}

/**
 * One caption as the server hands it out. Which fields are present depends on
 * the phase: during `caption` the viewer sees only their own (with playerId);
 * during `vote` every caption arrives as a VoteCaption (`isOwn` / `canVote`,
 * never an author); from `reveal` on, every caption carries its author.
 */
export interface CaptionView {
  id: string;
  text: string;
  playerId?: string;
  isOwn?: boolean;
  canVote?: boolean;
}

export interface RoundResultView {
  round: number;
  photo?: PhotoMetaView;
  captions: CaptionView[];
  votes: Record<string, string>;
  winnerCaptionIds: string[];
}

/** What `publicView(state, viewerId, now)` returns, minus anything private. */
export interface RoomView {
  code: string;
  version: number;
  phase: Phase;
  round: number;
  options: RoomOptions;
  hostId: string;
  players: PlayerView[];
  /** Frozen roster for this round. Absent = everyone plays (pre-amendment). */
  roundPlayerIds?: string[];
  photo?: PhotoMetaView;
  captions: CaptionView[];
  votes: Record<string, string>;
  phaseEndsAt?: number;
  phaseStartedAt?: number;
  history: RoundResultView[];
  championIds?: string[];
  nextPollMs: number;
  /**
   * How many captions are in this round so far. The server strips other
   * players' captions during `caption`, so the count cannot be derived from
   * `captions`. Rendered only when the server sends it.
   */
  captionCount?: number;
  /** Some servers put the clock inside the state as well as the envelope. */
  serverTime?: number;
}

/** Every API reply is wrapped like this. */
export interface RoomEnvelope {
  state?: RoomView;
  unchanged?: boolean;
  nextPollMs?: number;
  serverTime?: number;
}

/** Who we are in one room. Kept in sessionStorage, never rendered. */
export interface Identity {
  playerId: string;
  playerSecret: string;
}

export interface CreateResponse extends RoomEnvelope {
  code: string;
  playerId: string;
  playerSecret: string;
}

export interface JoinResponse extends RoomEnvelope {
  playerId: string;
  playerSecret: string;
}
