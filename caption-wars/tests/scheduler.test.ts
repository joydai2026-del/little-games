// The single-alarm rule (plan amendment 1). A Durable Object gets ONE alarm, so
// setting it for the phase timer must never cancel the room expiry or a pending
// bot job. nextAlarmAt() is the only place that decides, and this file is where
// "earliest of the three" is actually checked.

import { describe, it, expect } from 'vitest';
import { nextAlarmAt } from '../src/worker/schedule';
import {
  advanceIfDue,
  createRoom,
  dueBotJobs,
  enqueueBotJobs,
  nextBotJobDueAt,
  setJobStatus,
  start,
  submitCaption,
} from '../src/shared/room';
import { normalizeOptions } from '../src/shared/config';
import type { BotJob, PhotoMeta, Player, RoomState } from '../src/shared/types';

const T0 = 1_700_000_000_000;
const PHOTO: PhotoMeta = { round: 1, source: 'picsum', sha256: 'c'.repeat(64), bytes: 100 };

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
    const state = enqueueBotJobs(base, [
      jobAt(T0, { jobId: 'ready' }),
      jobAt(T0 + 5_000, { jobId: 'later' }),
      jobAt(T0, { jobId: 'done-already', status: 'done' }),
      jobAt(T0, { jobId: 'wrong-round', round: 9 }),
      jobAt(T0, { jobId: 'wrong-phase', phase: 'vote' }),
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
    state = submitCaption(state, 'host', 'only mine', 'c1', T0 + 1).state;
    const at = advanceIfDue(state, state.phaseEndsAt!).state;
    // One caption from the host: b1 can still vote for it, so the ballot stands.
    expect(at.phase).toBe('vote');
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
