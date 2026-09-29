import { describe, expect, it } from 'vitest';
import { canRequest, canWrite, cancelled, ended, failed, freshAudio, replaysLeft, requested, started, wordMsLeft } from '../src/shared/word-audio';
import { GAME } from '../src/shared/config';

const MAX = 2;

describe('word audio: waiting / loading / playing / heard / failed', () => {
  it('waiting -> loading -> playing -> heard; the pad unlocks and the word clock starts at the first play', () => {
    let a = freshAudio(0);
    expect(a.status).toBe('waiting');
    expect(canWrite(a)).toBe(false);
    expect(wordMsLeft(a, 30, 5)).toBeNull();
    a = requested(a, MAX);
    expect(a.status).toBe('loading');
    a = started(a, 1000);
    expect(a).toMatchObject({ status: 'playing', plays: 1, heardAt: 1000 });
    expect(canWrite(a)).toBe(true);
    a = ended(a);
    expect(a.status).toBe('heard');
    expect(wordMsLeft(a, 30, 11_000)).toBe(20_000);
    expect(wordMsLeft(a, 30, 99_000)).toBe(0);
  });

  it('one request at a time: a second tap while loading or playing does nothing', () => {
    let a = requested(freshAudio(0), MAX);
    expect(canRequest(a, MAX)).toBe(false);
    expect(requested(a, MAX)).toBe(a);
    a = started(a, 1);
    expect(canRequest(a, MAX)).toBe(false);
  });

  it('a failed start shows Try again; a failure never uses up a replay and never starts the clock', () => {
    let a = failed(requested(freshAudio(3), MAX));
    expect(a).toMatchObject({ status: 'failed', plays: 0, heardAt: null, wordIndex: 3 });
    expect(canRequest(a, MAX)).toBe(true);
    a = started(requested(a, MAX), 50);
    expect(a.plays).toBe(1);
    expect(replaysLeft(a, MAX)).toBe(MAX);
  });

  it('replays limit: the first play is free, then exactly `max` replays', () => {
    let a = ended(started(requested(freshAudio(0), MAX), 0));
    for (let i = 0; i < MAX; i++) {
      expect(canRequest(a, MAX)).toBe(true);
      a = ended(started(requested(a, MAX), 10 + i));
    }
    expect(replaysLeft(a, MAX)).toBe(0);
    expect(canRequest(a, MAX)).toBe(false);
    expect(requested(a, MAX)).toBe(a);
    expect(a.heardAt).toBe(0); // replays never restart the word clock
  });

  it('a mute or a newer word cancels back to where it was', () => {
    expect(cancelled(requested(freshAudio(0), MAX)).status).toBe('waiting');
    const heard = ended(started(requested(freshAudio(0), MAX), 0));
    expect(cancelled(requested(heard, MAX)).status).toBe('heard');
    expect(cancelled(heard)).toBe(heard);
  });

  it('the game uses a real replay limit from config', () => {
    expect(GAME.replaysPerWord).toBeGreaterThan(0);
  });
});
