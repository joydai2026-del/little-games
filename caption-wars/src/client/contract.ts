// The shapes the CLIENT codes against.
//
// `src/shared/types.ts` is the authoritative contract (the worker has landed
// and implements it). Everything the client reads is re-declared here so this
// module typechecks on its own and so the screens depend on a narrow read-only
// shape rather than on the server's internal state type. The fields are
// deliberately permissive (optional where an older deployment may not send them
// yet) so a client running against a not-quite-current worker degrades instead
// of crashing a screen.

import type { Phase, RoomOptions, RoundResult } from '../shared/types';

export type { Phase, RoomOptions };

/**
 * The exact union the server sends. Typed as `string` before, which let
 * `reveal.ts` compare against a literal that typechecks even when it is a typo.
 */
export type VoidReason = NonNullable<RoundResult['voidReason']>;

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
  // ROUND 8 (Claude nit 3): a `url?: string` used to live here, left over from a
  // pre-amendment design, and `common.ts` assigned it straight to `img.src`. The
  // SERVER-side PhotoMeta (src/shared/types.ts) has never carried it, so it was
  // dead in every round; dead or not, it was an unchecked scheme reaching an
  // `img.src` if anything ever populated it. Photo bytes come from
  // `GET /api/rooms/:code/photo/:round` and nowhere else, which is what
  // `photoUrl()` builds.
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
  /**
   * Present only on a void round: 'no-captions' (nobody wrote one) or
   * 'bots-failed' (the AI players' jobs failed, so there was nothing to vote
   * on). Optional, so an older worker that does not send it still renders.
   */
  voidReason?: VoidReason;
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
  /**
   * Empty during `caption` and `vote`: the server hides the live ballot, because
   * its keys are player ids. Full from `reveal` on. Read `yourVote` for the
   * viewer's own pick while it is hidden.
   */
  votes: Record<string, string>;
  /** The viewer's own vote this round, or null. Survives a reload during `vote`. */
  yourVote?: string | null;
  /** How long `reveal` must be on screen before the host may skip it. */
  revealMinMs?: number;
  /**
   * When the server will next try to fetch a photo, or null/absent when nothing
   * is backing off. The host's Start and Next buttons count down to it instead
   * of pretending they are tappable.
   */
  photoRetryAt?: number | null;
  /**
   * Why the game ended, when it did not end by playing out every round. The
   * UNION, not `string` (round 6, Claude nit 2): round 4 gave the sibling
   * `voidReason` its union so a typo in a comparison stops typechecking, and
   * done.ts compares this one to a string literal in exactly the same way.
   * `ai-unavailable` is round 7: the Workers AI daily free allowance ran out and
   * dropping the bots left fewer than two players.
   */
  endedReason?: 'photo-unavailable' | 'ai-unavailable';
  /**
   * The AI players have met the Workers AI daily free allowance and are out for
   * the rest of the UTC day (round 7). Every screen says so in one plain
   * sentence. Optional, so a client running against an older worker simply never
   * shows the banner.
   */
  aiOffline?: boolean;
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
