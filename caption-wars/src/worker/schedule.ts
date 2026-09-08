// When the Durable Object's single alarm should next fire.
//
// A Durable Object has exactly ONE alarm (plan amendment 1), and three things
// want it: the end of the current phase, the room's 2h expiry, and the earliest
// pending bot job. Setting it for one purpose must never cancel another, so
// every caller goes through nextAlarmAt(), which returns the earliest of the
// three. Pure and Cloudflare-free so it can be unit-tested directly.

import type { RoomState } from '../shared/types';
import { nextBotJobDueAt } from '../shared/room';

/**
 * The earliest of: this phase's end (only while a phase is actually running, and
 * only while no photo retry is backing off), the room's expiry, and the next
 * pending bot job. Never earlier than `now`,
 * because an alarm in the past just fires immediately and re-entering the
 * handler in a tight loop is worse than firing one millisecond late.
 * Returns undefined when nothing is scheduled (which cannot normally happen:
 * `expiresAt` is always set).
 */
export function nextAlarmAt(state: RoomState, now: number): number | undefined {
  const candidates: number[] = [state.expiresAt];

  // A failed photo fetch leaves the room in `reveal` with `phaseEndsAt` already
  // in the past. Honouring that would set the alarm to `now`, which fires
  // instantly and fetches again: a hot loop. While a retry is pending the
  // backoff time REPLACES the dead phase deadline.
  const retryAt = state.photoRetry?.nextAttemptAt;
  const phaseRunning =
    state.phase === 'caption' || state.phase === 'vote' || state.phase === 'reveal';
  if (retryAt !== undefined) candidates.push(retryAt);
  else if (phaseRunning && state.phaseEndsAt !== undefined) candidates.push(state.phaseEndsAt);

  const jobAt = nextBotJobDueAt(state, now);
  if (jobAt !== undefined) candidates.push(jobAt);

  if (candidates.length === 0) return undefined;
  return Math.max(now, Math.min(...candidates));
}
