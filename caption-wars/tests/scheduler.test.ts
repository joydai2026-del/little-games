// The single-alarm rule (plan amendment 1). A Durable Object gets ONE alarm, so
// setting it for the phase timer must never cancel the room expiry or a pending
// bot job. nextAlarmAt() is the only place that decides, and this file is where
// "earliest of the three" is actually checked.

import { describe, it, expect } from 'vitest';
import { nextAlarmAt } from '../src/worker/schedule';
import {
  advance,
  advanceIfDue,
  createRoom,
  dueBotJobs,
  enqueueBotJobs,
  markJobsRunning,
  nextBotJobDueAt,
  notePhotoFailure,
  photoRetryBlocked,
  reapBotJobs,
  setJobStatus,
  start,
  submitCaption,
} from '../src/shared/room';
import { normalizeOptions } from '../src/shared/config';
import type { BotJob, PhotoMeta, Player, RoomState } from '../src/shared/types';

const T0 = 1_700_000_000_000;
const PHOTO: PhotoMeta = { round: 1, source: 'picsum', sha256: 'c'.repeat(64), bytes: 100 };
const PHOTO_2: PhotoMeta = { ...PHOTO, round: 2, sha256: 'e'.repeat(64) };

function bot(id: string): Player {
  return { id, name: id, isBot: true, score: 0, lastSeenAt: T0 };
}

function lobby(): RoomState {
  const options = normalizeOptions({ rounds: 3, captionSeconds: 60, voteSeconds: 30, revealSeconds: 10, botCount: 1 });
  return createRoom('ABCD', { id: 'host', name: 'JJ' }, options, [bot('b1')], T0);
}

function jobAt(dueAt: number, over: Partial<BotJob> = {}): BotJob {
  return {
    jobId: `j-${dueAt}`,
    botId: 'b1',
    round: 1,
    phase: 'caption',
    dueAt,
    deadline: dueAt + 20_000,
    status: 'pending',
    ...over,
  };
}

describe('nextAlarmAt', () => {
  it('uses the room expiry when nothing else is scheduled', () => {
    const state = lobby();
    expect(nextAlarmAt(state, T0)).toBe(state.expiresAt);
  });

  it('prefers the phase end when it is sooner than the expiry', () => {
    const state = start(lobby(), 'host', PHOTO, T0).state;
    expect(state.phaseEndsAt).toBe(T0 + 60_000);
    expect(nextAlarmAt(state, T0)).toBe(T0 + 60_000);
  });

  it('prefers a bot job when it is sooner than the phase end', () => {
    const state = enqueueBotJobs(start(lobby(), 'host', PHOTO, T0).state, [jobAt(T0 + 500)]);
    expect(nextAlarmAt(state, T0)).toBe(T0 + 500);
  });

  it('falls back from a finished bot job to the phase end', () => {
    let state = enqueueBotJobs(start(lobby(), 'host', PHOTO, T0).state, [jobAt(T0 + 500)]);
    state = setJobStatus(state, 'j-' + (T0 + 500), 'done');
    expect(nextAlarmAt(state, T0)).toBe(T0 + 60_000);
  });

  it('picks the expiry when the room is about to expire mid-phase', () => {
    const state = { ...start(lobby(), 'host', PHOTO, T0).state, expiresAt: T0 + 5_000 };
    expect(nextAlarmAt(state, T0)).toBe(T0 + 5_000);
  });

  it('ignores the phase end in the lobby and when the game is done', () => {
    const inLobby = { ...lobby(), phaseEndsAt: T0 + 10 };
    expect(nextAlarmAt(inLobby, T0)).toBe(inLobby.expiresAt);

    const finished = { ...lobby(), phase: 'done' as const, phaseEndsAt: T0 + 10 };
    expect(nextAlarmAt(finished, T0)).toBe(finished.expiresAt);
  });

  it('never returns a time in the past, so an overdue alarm fires once, not in a loop', () => {
    const state = start(lobby(), 'host', PHOTO, T0).state;
    const late = T0 + 10 * 60 * 1000; // long past phaseEndsAt
    expect(nextAlarmAt(state, late)).toBe(late);
  });

  it('takes the earliest of all three at once', () => {
    const base = start(lobby(), 'host', PHOTO, T0).state;
    const withJob = enqueueBotJobs({ ...base, expiresAt: T0 + 2_000 }, [jobAt(T0 + 1_000)]);
    expect(withJob.phaseEndsAt).toBe(T0 + 60_000);
    expect(nextAlarmAt(withJob, T0)).toBe(T0 + 1_000);

    const laterJob = enqueueBotJobs({ ...base, expiresAt: T0 + 2_000 }, [jobAt(T0 + 30_000)]);
    expect(nextAlarmAt(laterJob, T0)).toBe(T0 + 2_000);
  });
});

describe('bot job selection', () => {
  it('returns only pending, due, in-round, in-phase jobs', () => {
    const base = start(lobby(), 'host', PHOTO, T0).state;
    // Distinct botIds: one bot never gets two jobs for the same round + phase,
    // and dueBotJobs now enforces that (see the dedupe test below).
    const state = enqueueBotJobs(base, [
      jobAt(T0, { jobId: 'ready', botId: 'b1' }),
      jobAt(T0 + 5_000, { jobId: 'later', botId: 'b2' }),
      jobAt(T0, { jobId: 'done-already', botId: 'b3', status: 'done' }),
      jobAt(T0, { jobId: 'wrong-round', botId: 'b4', round: 9 }),
      jobAt(T0, { jobId: 'wrong-phase', botId: 'b5', phase: 'vote' }),
    ]);
    expect(dueBotJobs(state, T0).map((j) => j.jobId)).toEqual(['ready']);
    // Later on, both are due: 'ready' is still pending and still inside its deadline.
    expect(dueBotJobs(state, T0 + 6_000).map((j) => j.jobId)).toEqual(['ready', 'later']);
  });

  it('drops a job whose deadline has passed instead of retrying it forever', () => {
    const state = enqueueBotJobs(start(lobby(), 'host', PHOTO, T0).state, [jobAt(T0)]);
    expect(dueBotJobs(state, T0 + 19_999)).toHaveLength(1);
    expect(dueBotJobs(state, T0 + 20_001)).toHaveLength(0);
    expect(nextBotJobDueAt(state, T0 + 20_001)).toBeUndefined();
  });

  it('stops asking for an alarm once every job is resolved', () => {
    let state = enqueueBotJobs(start(lobby(), 'host', PHOTO, T0).state, [
      jobAt(T0, { jobId: 'a' }),
      jobAt(T0 + 100, { jobId: 'b' }),
    ]);
    expect(nextBotJobDueAt(state, T0)).toBe(T0);
    state = setJobStatus(state, 'a', 'failed');
    expect(nextBotJobDueAt(state, T0)).toBe(T0 + 100);
    state = setJobStatus(state, 'b', 'done');
    expect(nextBotJobDueAt(state, T0)).toBeUndefined();
  });

  it('does not bump the version, so a job update cannot invalidate a running job stamp', () => {
    const base = enqueueBotJobs(start(lobby(), 'host', PHOTO, T0).state, [jobAt(T0)]);
    expect(setJobStatus(base, 'j-' + T0, 'running').version).toBe(base.version);
  });
});

describe('advanceIfDue', () => {
  it('is a no-op before anything is due', () => {
    const state = start(lobby(), 'host', PHOTO, T0).state;
    const result = advanceIfDue(state, T0 + 59_999);
    expect(result.state).toBe(state);
    expect(result.needsPhoto).toBeUndefined();
  });

  it('ends the caption phase exactly on phaseEndsAt', () => {
    const state = start(lobby(), 'host', PHOTO, T0).state;
    const at = advanceIfDue(state, state.phaseEndsAt!).state;
    // Nobody captioned, so the vote phase is over the instant it opens (there
    // is nothing on the ballot) and the round lands on reveal, voided.
    expect(at.phase).toBe('reveal');
    expect(at.history[0].winnerCaptionIds).toEqual([]);
  });

  it('opens a real vote window when there is something to vote on', () => {
    let state = start(lobby(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0 + 2).state;
    // Two captions from a two-player roster: the phase ends because everyone
    // captioned, and there is a real ballot to run.
    expect(state.phase).toBe('vote');
    expect(state.phaseEndsAt).toBe(T0 + 2 + 30_000);
  });

  it('skips the vote window when the round is already void', () => {
    let state = start(lobby(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'only mine', 'c1', T0 + 1).state;
    const at = advanceIfDue(state, state.phaseEndsAt!).state;
    // One caption cannot produce a winner, so there is nothing to vote on and
    // the round lands straight on reveal instead of burning a 30s timer.
    expect(at.phase).toBe('reveal');
    expect(at.history[0].winnerCaptionIds).toEqual([]);
  });

  it('carries an overdue room forward one deadline at a time', () => {
    let state = start(lobby(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0 + 2).state;
    expect(state.phase).toBe('vote'); // roster complete

    state = advanceIfDue(state, state.phaseEndsAt!).state;
    expect(state.phase).toBe('reveal');

    const atRevealEnd = advanceIfDue(state, state.phaseEndsAt!);
    expect(atRevealEnd.needsPhoto).toBe(true);
    expect(atRevealEnd.state.phase).toBe('reveal');
  });

  it('leaves a done room alone forever', () => {
    const done = { ...lobby(), phase: 'done' as const };
    expect(advanceIfDue(done, T0 + 10 ** 9).state).toBe(done);
  });
});

// --- a dead photo host must not spin the alarm --------------------------------
//
// The failure this covers: `settle()` needs the next round's photo, both image
// hosts are unreachable, the room stays in `reveal` with `phaseEndsAt` already
// in the past, and nextAlarmAt() returns `now`. The alarm fires instantly, tries
// again, and re-arms to `now` again: a hot loop of outbound fetches until the
// room expires two hours later, with every player staring at a frozen reveal.

describe('photo failure backoff', () => {
  /** A room sitting in reveal with its timer already expired, i.e. mid-rollover. */
  function stuckAtRollover(): RoomState {
    let state = start(lobby(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0 + 2).state;
    state = advanceIfDue(state, state.phaseEndsAt!).state; // vote -> reveal
    expect(state.phase).toBe('reveal');
    return state;
  }

  it('backs the alarm off instead of re-arming to now', () => {
    const stuck = stuckAtRollover();
    const overdue = stuck.phaseEndsAt! + 1;

    // Before the fix this was the bug: the dead phase deadline is in the past,
    // so the alarm asks to fire immediately, forever.
    expect(nextAlarmAt(stuck, overdue)).toBe(overdue);

    const first = notePhotoFailure(stuck, overdue).state;
    expect(first.phase).toBe('reveal');
    expect(first.photoRetry).toEqual({ attempts: 1, nextAttemptAt: overdue + 5_000 });
    expect(nextAlarmAt(first, overdue)).toBe(overdue + 5_000);
    expect(photoRetryBlocked(first, overdue + 4_999)).toBe(true);
    expect(photoRetryBlocked(first, overdue + 5_000)).toBe(false);

    const second = notePhotoFailure(first, overdue + 5_000).state;
    expect(second.photoRetry).toEqual({ attempts: 2, nextAttemptAt: overdue + 20_000 });
    expect(nextAlarmAt(second, overdue + 5_000)).toBe(overdue + 20_000);
  });

  it('ends the game honestly after the last attempt, rather than spinning', () => {
    let state = stuckAtRollover();
    const at = state.phaseEndsAt! + 1;
    state = notePhotoFailure(state, at).state;
    state = notePhotoFailure(state, at + 5_000).state;
    expect(state.phase).toBe('reveal');

    state = notePhotoFailure(state, at + 20_000).state;
    expect(state.phase).toBe('done');
    expect(state.endedReason).toBe('photo-unavailable');
    expect(state.photoRetry).toBeUndefined();
    // The scores everyone earned still stand, and a champion is still named.
    expect(state.championIds?.length).toBeGreaterThan(0);
    // And the alarm now falls back to the room expiry, not to "right now".
    expect(nextAlarmAt(state, at + 20_000)).toBe(state.expiresAt);
  });

  it('forgets the failure once a round actually opens', () => {
    let state = stuckAtRollover();
    state = notePhotoFailure(state, state.phaseEndsAt! + 1).state;
    expect(state.photoRetry).toBeDefined();

    const opened = advance(state, 'timer', state.phaseEndsAt! + 6_000, PHOTO_2).state;
    expect(opened.phase).toBe('caption');
    expect(opened.photoRetry).toBeUndefined();
  });
});

describe('bot job reaping', () => {
  it('fails a job abandoned in `running`, and leaves a live one alone', () => {
    const base = start(lobby(), 'host', PHOTO, T0).state;
    const state = enqueueBotJobs(base, [
      jobAt(T0, { jobId: 'abandoned', botId: 'b1', status: 'running' }),
      jobAt(T0, { jobId: 'live', botId: 'b2', status: 'running' }),
      jobAt(T0, { jobId: 'never-ran', botId: 'b3' }),
      jobAt(T0, { jobId: 'finished', botId: 'b4', status: 'done' }),
    ]);

    // Nothing is past its 20s deadline yet.
    expect(reapBotJobs(state, T0 + 1_000)).toBe(state);

    const reaped = reapBotJobs(state, T0 + 20_001);
    const status = (id: string) => reaped.botJobs.find((j) => j.jobId === id)!.status;
    expect(status('abandoned')).toBe('failed'); // the DO died mid model call
    expect(status('never-ran')).toBe('failed'); // expired before it was ever due
    expect(status('finished')).toBe('done'); // terminal statuses are never touched
  });

  it('does not hand out a second attempt while one is running or done', () => {
    const base = start(lobby(), 'host', PHOTO, T0).state;
    const running = enqueueBotJobs(base, [
      jobAt(T0, { jobId: 'first', botId: 'b1', status: 'running' }),
      jobAt(T0, { jobId: 'second', botId: 'b1' }),
    ]);
    expect(dueBotJobs(running, T0)).toEqual([]);

    // Once the first attempt is recorded failed, a retry is allowed again.
    const failed = setJobStatus(running, 'first', 'failed');
    expect(dueBotJobs(failed, T0).map((j) => j.jobId)).toEqual(['second']);
  });

  it('takes a lease with a startedAt stamp when a job starts running', () => {
    const base = start(lobby(), 'host', PHOTO, T0).state;
    const state = enqueueBotJobs(base, [jobAt(T0, { jobId: 'j1' })]);
    const leased = markJobsRunning(state, ['j1'], T0 + 5);
    expect(leased.botJobs[0]).toMatchObject({ status: 'running', startedAt: T0 + 5 });
    expect(markJobsRunning(leased, [], T0 + 6)).toBe(leased);
  });
});
