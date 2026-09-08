// Programmable policy for one room. Nothing here is a literal buried in game
// logic: the host can override any RoomOptions field at create time (clamped
// by normalizeOptions), and everything else is a wrangler var read by the
// worker. See docs/plans/2026-09-07-mvp-plan.md, "Programmable policy".

import type { Phase, RoomOptions } from './types';
// The two text limits live in JSON because agent/play.mjs (plain ESM, no build
// step) has to read the SAME numbers. It loads this file with fs at startup, so
// the caption cap can never drift between the server and the terminal player.
import limits from './limits.json';

/** Defaults applied when the host does not override a field at create time. */
export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  rounds: 5,
  captionSeconds: 60,
  voteSeconds: 30,
  revealSeconds: 10,
  botCount: 2,
};

/** Config that is not a per-room option (fixed policy, not host-tunable). */
export const MAX_HUMAN_PLAYERS = 8;
export const MAX_BOTS = 4;
export const CAPTION_MAX_CHARS = limits.captionMaxChars;
export const NAME_MAX_CHARS = limits.nameMaxChars;
export const ROOM_TTL_HOURS = 2;
export const ROOM_TTL_MS = ROOM_TTL_HOURS * 60 * 60 * 1000;

/**
 * How long `reveal` must be on screen before the host's "Next" button is
 * allowed to skip it (plan amendment: reveal floor). Stops a fast host from
 * yanking the scoreboard away before anyone has read it. Overridable per
 * deployment through the wrangler var REVEAL_MIN_MS.
 */
export const REVEAL_MIN_MS = 3000;

/** Hard stop on one bot's model call, overridable through the wrangler var BOT_TIMEOUT_MS. */
export const BOT_TIMEOUT_MS = 20000;

/**
 * Hard stop on ONE caption-judge call (rule 50), overridable through the
 * wrangler var CAPTION_JUDGE_TIMEOUT_MS. It is still clamped again by whatever
 * is left of the bot job's own deadline, so this only ever makes the judge
 * WAIT LESS than the job would allow.
 *
 * Measured: 6000 was too tight. The round-6 ai:try run drove four personas
 * concurrently (a vision call and a judge call each, plus a relevance judge per
 * photo) and `wrangler tail` showed the judge failing with "The operation was
 * aborted due to timeout" on about 1 call in 10, which fails OPEN and therefore
 * shipped two descriptions the judge would otherwise have caught. p95 for a
 * text call under that load measured 6382ms.
 */
export const CAPTION_JUDGE_TIMEOUT_MS = 10000;

/**
 * The cost ceiling on ONE POST /api/ai-try request, overridable through the
 * wrangler vars AI_TRY_MAX_SAMPLES and AI_TRY_MAX_MODEL_CALLS.
 *
 * The route is token-gated and off entirely when SMOKE_TOKEN is unset, but it is
 * the only route in the worker that spends model calls in a loop: photos x
 * personas captions, each up to three ladder rungs, plus one description per
 * photo and one relevance judge per caption. Both numbers are policy, not code,
 * so a tuning session can raise them for a run without a deploy of new logic.
 */
export const AI_TRY_MAX_SAMPLES = 24;
// 40, matching wrangler.jsonc: the code default is what fires if the var is ever
// absent, and 160 is over three times the free plan's 50-subrequest ceiling.
export const AI_TRY_MAX_MODEL_CALLS = 40;

/** Byte cap on a fetched photo, overridable through the wrangler var PHOTO_MAX_BYTES. */
export const PHOTO_MAX_BYTES = 2_000_000;

/**
 * Hard deadline on one outbound photo request, overridable through the wrangler
 * var PHOTO_TIMEOUT_MS.
 *
 * This one is load-bearing for the whole room, not just the picture: the photo
 * download happens inside `settle()`, which every authenticated request runs, so
 * a stalled image host at a round rollover parks every player's poll inside the
 * same never-resolving fetch. With a deadline the fetch throws, which is already
 * the path that records the failure, backs off, and ends the game honestly after
 * PHOTO_MAX_ATTEMPTS. 8s is generous: a good loremflickr answer measured 40-110
 * KB on 2026-09-07.
 */
export const PHOTO_TIMEOUT_MS = 8_000;

/**
 * Deadlines on the browser's own requests. A fetch that never settles leaves the
 * poll loop with no rejection to catch, so it never retries and never
 * reschedules: the countdown ticks to zero and the phone sits there for ever,
 * with no error and no way back but a reload. A tapped button in the same state
 * stays disabled for ever. The poll deadline is the tighter of the two because a
 * missed poll costs nothing (the next one is seconds away), while an action is
 * something the player typed and would have to redo.
 */
export const POLL_TIMEOUT_MS = 10_000;
export const ACTION_TIMEOUT_MS = 20_000;

/**
 * Separate, smaller cap on the bytes handed to the vision model, overridable
 * through the wrangler var VISION_MAX_BYTES. A photo bigger than this is still
 * stored and still served to every player: only the bot skips its caption for
 * that round, with the reason logged. The two caps are deliberately different
 * numbers because `Array.from(bytes)` at the storage cap would build a
 * multi-million-element JS array inside the Durable Object.
 */
export const VISION_MAX_BYTES = 1_000_000;

/**
 * A photo fetch can fail at a round rollover (both free image hosts down or
 * rate-limiting). The room then waits this long before trying again, and gives
 * up after PHOTO_MAX_ATTEMPTS failures rather than spinning the alarm. Index i
 * is the wait after failure i+1; the last entry is the ceiling if the attempt
 * cap is ever raised.
 */
export const PHOTO_RETRY_BACKOFF_MS = [5_000, 15_000, 60_000];

/** Failed photo fetches at one rollover before the game ends honestly. */
export const PHOTO_MAX_ATTEMPTS = 3;

/** How long to wait after the nth failed photo fetch (n is 1-based). */
export function photoRetryDelayMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 1), PHOTO_RETRY_BACKOFF_MS.length) - 1;
  return PHOTO_RETRY_BACKOFF_MS[idx];
}

/**
 * Polling cadence the server tells clients to use, per phase. 0 = stop polling.
 * Values per plan amendment 11 (polling budget); the client adds jitter and
 * backs off further when the tab is hidden.
 */
export function nextPollMsFor(phase: Phase): number {
  switch (phase) {
    case 'lobby':
      return 3000;
    case 'caption':
    case 'vote':
      return 2000;
    case 'reveal':
      return 2500;
    case 'done':
      return 0;
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Merges a partial host override onto the defaults, clamping every field to a
 * sane range so a bad client request can never produce an unplayable room
 * (e.g. a 0-second timer or 50 bots).
 */
export function normalizeOptions(partial?: Partial<RoomOptions>): RoomOptions {
  const merged = { ...DEFAULT_ROOM_OPTIONS, ...partial };
  return {
    rounds: clamp(merged.rounds, 1, 20, DEFAULT_ROOM_OPTIONS.rounds),
    captionSeconds: clamp(merged.captionSeconds, 15, 180, DEFAULT_ROOM_OPTIONS.captionSeconds),
    voteSeconds: clamp(merged.voteSeconds, 10, 120, DEFAULT_ROOM_OPTIONS.voteSeconds),
    revealSeconds: clamp(merged.revealSeconds, 3, 60, DEFAULT_ROOM_OPTIONS.revealSeconds),
    botCount: clamp(merged.botCount, 0, MAX_BOTS, DEFAULT_ROOM_OPTIONS.botCount),
  };
}
