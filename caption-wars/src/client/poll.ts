// Polling and countdown maths.
//
// The server decides the cadence (`nextPollMs`) and the client only adds
// noise so eight phones do not all knock on the same Durable Object in the
// same millisecond. A hidden tab (pocket, another app) backs right off, and
// `nextPollMs: 0` means the game is over: stop asking.
//
// Everything above `startPolling` is pure so it can be tested in node.

import type { RoomEnvelope } from './contract';

/** How wide the random spread around `nextPollMs` is: ±20%. */
export const JITTER_RATIO = 0.2;
/** Cadence while the tab is hidden. */
export const HIDDEN_POLL_MS = 10000;
/** Never hammer faster than this, whatever the server says. */
export const MIN_POLL_MS = 250;
/** Cadence after a failed request. */
export const ERROR_POLL_MS = 3000;
/** Consecutive failures after which the retry cadence drops to the hidden-tab one. */
export const ERROR_BACKOFF_AFTER = 5;
/** Fallback when the server sends no cadence at all. */
export const DEFAULT_POLL_MS = 2000;

/**
 * Spreads a delay by ±JITTER_RATIO. `rand` returns 0..1 (Math.random by
 * default) and is injected so the bounds are testable.
 */
export function jitter(ms: number, rand: () => number = Math.random): number {
  const spread = ms * JITTER_RATIO;
  return ms - spread + rand() * spread * 2;
}

/**
 * The delay before the next poll. 0 means stop for good.
 * A hidden tab uses HIDDEN_POLL_MS, but never polls FASTER than the server
 * asked for (a lobby at 12000 would not be sped up by hiding the tab).
 */
export function pollDelay(
  nextPollMs: number | undefined,
  hidden: boolean,
  rand: () => number = Math.random
): number {
  const base = typeof nextPollMs === 'number' && Number.isFinite(nextPollMs)
    ? nextPollMs
    : DEFAULT_POLL_MS;
  if (base <= 0) return 0;
  const target = hidden ? Math.max(HIDDEN_POLL_MS, base) : base;
  return Math.max(MIN_POLL_MS, Math.round(jitter(target, rand)));
}

/**
 * Milliseconds left on the current phase, from the SERVER's clock.
 * `offset` is `serverTime - Date.now()` from the latest reply. Never negative:
 * a passed deadline reads as 0 while we wait for the server to move the room.
 */
export function countdownMs(
  phaseEndsAt: number | undefined,
  offset: number,
  localNow: number = Date.now()
): number {
  if (typeof phaseEndsAt !== 'number' || !Number.isFinite(phaseEndsAt)) return 0;
  return Math.max(0, phaseEndsAt - (localNow + offset));
}

/** Whole seconds shown on a countdown: 1ms left still reads as "1". */
export function countdownSeconds(msLeft: number): number {
  return Math.max(0, Math.ceil(msLeft / 1000));
}

/**
 * How long to wait after a failed request.
 *
 * Two things the plain 3s retry got wrong: it ignored the hidden tab (a phone in
 * a pocket kept knocking every 3 seconds while every other path had backed off
 * to 10), and it never gave up ground, so a room that is genuinely unreachable
 * was hit 1,200 times an hour. After ERROR_BACKOFF_AFTER consecutive failures
 * the cadence drops to the hidden-tab one. `failures` is 1 on the first failure.
 */
export function errorPollDelay(
  failures: number,
  hidden: boolean,
  rand: () => number = Math.random
): number {
  const base = failures >= ERROR_BACKOFF_AFTER ? HIDDEN_POLL_MS : ERROR_POLL_MS;
  return pollDelay(base, hidden, rand);
}

export interface PollOptions {
  /** The version we already hold, so the server can answer `unchanged`. */
  getVersion: () => number | undefined;
  fetchOnce: (version: number | undefined) => Promise<RoomEnvelope>;
  onEnvelope: (envelope: RoomEnvelope) => void;
  onError: (error: Error) => void;
  isHidden?: () => boolean;
}

/** Starts polling a room. Returns a stop function; safe to call twice. */
export function startPolling(options: PollOptions): () => void {
  const hidden = options.isHidden ?? (() => document.hidden);
  let stopped = false;
  let timer = 0;
  let failures = 0;

  const schedule = (ms: number): void => {
    if (stopped || ms <= 0) return;
    timer = window.setTimeout(run, ms);
  };

  async function run(): Promise<void> {
    if (stopped) return;
    try {
      const envelope = await options.fetchOnce(options.getVersion());
      if (stopped) return;
      failures = 0;
      options.onEnvelope(envelope);
      const delay = pollDelay(envelope.nextPollMs ?? envelope.state?.nextPollMs, hidden());
      if (delay === 0) {
        stopped = true;
        return;
      }
      schedule(delay);
    } catch (error) {
      if (stopped) return;
      failures += 1;
      options.onError(error instanceof Error ? error : new Error('The room stopped answering.'));
      schedule(errorPollDelay(failures, hidden()));
    }
  }

  void run();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
