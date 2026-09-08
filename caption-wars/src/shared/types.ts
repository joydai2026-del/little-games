// Shared data model. This is the contract from
// docs/plans/2026-09-07-mvp-plan.md, "Contract changes" (the amendments block
// at the bottom of the plan, which supersedes the data model above it).
// Do not change these shapes without updating the plan.

export type Phase = 'lobby' | 'caption' | 'vote' | 'reveal' | 'done';

export interface RoomOptions {
  rounds: number;
  captionSeconds: number;
  voteSeconds: number;
  revealSeconds: number;
  botCount: number;
}

/**
 * `lastSeenAt` is display only (the lobby can grey out someone who wandered
 * off). It NEVER affects who may caption or vote: that is `roundPlayerIds`.
 */
export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  lastSeenAt: number;
}

/**
 * Metadata about the round's photo. The bytes themselves live in Durable
 * Object storage under `photo:<round>` and are served by
 * `GET /api/rooms/:code/photo/:round`, so every player and the vision model
 * see byte-identical pixels. `credit` is the source site, not a photographer
 * name: loremflickr stamps the photographer onto the image itself and gives us
 * no machine-readable attribution, so inventing one would be fabrication.
 */
export interface PhotoMeta {
  round: number;
  source: 'loremflickr' | 'picsum';
  credit?: string;
  sha256: string;
  bytes: number;
}

export interface Caption {
  id: string;
  playerId: string;
  text: string;
}

/**
 * One unit of bot work, stored in room state so it survives the Durable Object
 * being evicted mid-flight. The DO's single alarm runs jobs whose `dueAt` has
 * passed; a job past `deadline` is abandoned, never retried.
 *
 * `startedAt` is the lease stamp written when the job flips to `running`. If the
 * Durable Object dies during the model call the job would otherwise sit
 * `running` forever, so `reapBotJobs` marks any `pending` or `running` job past
 * its `deadline` as `failed` on the next alarm or settle.
 */
export interface BotJob {
  jobId: string;
  botId: string;
  round: number;
  phase: 'caption' | 'vote';
  dueAt: number;
  deadline: number;
  /** Set when the job flips to `running`; absent while it is still `pending`. */
  startedAt?: number;
  status: 'pending' | 'running' | 'done' | 'failed';
}

/** What a caption looks like during `vote`: no author, ever. */
export interface VoteCaption {
  id: string;
  text: string;
  isOwn: boolean;
  canVote: boolean;
}

export interface RoundResult {
  round: number;
  photo: PhotoMeta;
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
  /** Frozen when the round opens: only these ids may caption or vote this round. */
  roundPlayerIds: string[];
  photo?: PhotoMeta;
  captions: Caption[];
  votes: Record<string, string>;
  createdAt: number;
  expiresAt: number;
  phaseStartedAt: number;
  phaseEndsAt?: number;
  botJobs: BotJob[];
  history: RoundResult[];
  championIds?: string[];
  /**
   * Set only while the next round's photo could not be fetched: how many
   * attempts have failed and when the next one is allowed. Cleared the moment a
   * round opens. It is what stops a dead image host from spinning the alarm.
   */
  photoRetry?: { attempts: number; nextAttemptAt: number };
  /** Why the game ended, when it did not end by playing out all the rounds. */
  endedReason?: 'photo-unavailable';
  nextPollMs: number;
}

/**
 * A caption as a client sees it. Which fields are filled depends on the phase
 * (see publicView in room.ts):
 *   caption phase -> only the viewer's own caption, with `playerId`
 *   vote phase    -> every caption, with `isOwn` / `canVote`, never `playerId`
 *   reveal / done -> every caption, with `playerId`
 * The vote-phase objects are exactly `VoteCaption`.
 */
export interface PublicCaption {
  id: string;
  text: string;
  playerId?: string;
  isOwn?: boolean;
  canVote?: boolean;
}

/**
 * The room as sent to one player: bot jobs stripped, captions redacted for the
 * phase, and the server's clock included so the client can render an honest
 * countdown without trusting the device clock.
 */
export interface PublicRoomState extends Omit<RoomState, 'captions' | 'botJobs'> {
  captions: PublicCaption[];
  /** Captions submitted so far this round (visible during `caption` so players see "N of M in"). */
  captionCount: number;
  /**
   * Empty during `caption` and `vote`: a live ballot is secret, and the keys of
   * this map are player ids, so shipping it would show everyone who voted for
   * what before the reveal. Full from `reveal` on.
   */
  votes: Record<string, string>;
  /** The viewer's own vote this round, so a reload can restore it while votes are hidden. */
  yourVote: string | null;
  /** How long `reveal` must be on screen before the host may skip it. */
  revealMinMs: number;
  serverTime: number;
}

/** A reducer result: either a new state, or the old state plus an error for the caller to surface. */
export interface RoomResult {
  state: RoomState;
  error?: string;
}
