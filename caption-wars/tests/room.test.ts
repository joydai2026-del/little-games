import { describe, it, expect } from 'vitest';
import {
  createRoom,
  join,
  start,
  submitCaption,
  submitVote,
  endCaptionPhase,
  endVotePhase,
  advance,
  publicView,
  tally,
} from '../src/shared/room';
import { normalizeOptions } from '../src/shared/config';
import type { Photo, Player, RoomState } from '../src/shared/types';

const PHOTO: Photo = { url: 'https://loremflickr.com/800/600/dog', source: 'loremflickr' };
const PHOTO_2: Photo = { url: 'https://loremflickr.com/800/600/cat', source: 'loremflickr' };
const T0 = 1_700_000_000_000;

function bot(id: string, name: string): Player {
  return { id, name, isBot: true, score: 0, connected: true };
}

function twoRoundRoom(): RoomState {
  const options = normalizeOptions({ rounds: 2, captionSeconds: 60, voteSeconds: 30, revealSeconds: 10, botCount: 2 });
  return createRoom('ABCD', { id: 'host', name: 'JJ' }, options, [bot('b1', 'Daisy'), bot('b2', 'Chip')], T0);
}

describe('createRoom', () => {
  it('starts in lobby with the host as first player', () => {
    const state = twoRoundRoom();
    expect(state.phase).toBe('lobby');
    expect(state.hostId).toBe('host');
    expect(state.players.map((p) => p.id)).toEqual(['host', 'b1', 'b2']);
    expect(state.version).toBe(1);
  });
});

describe('full happy path: 1 human + 2 bots over 2 rounds', () => {
  it('plays start to finish and computes a champion', () => {
    let state = twoRoundRoom();

    // Round 1: start
    let res = start(state, 'host', PHOTO, T0);
    expect(res.error).toBeUndefined();
    state = res.state;
    expect(state.phase).toBe('caption');
    expect(state.round).toBe(1);
    expect(state.photo).toEqual(PHOTO);

    // All three caption; last one auto-ends the phase
    res = submitCaption(state, 'host', 'A very good dog', 'c-host-1', T0 + 1000);
    state = res.state;
    expect(state.phase).toBe('caption');

    res = submitCaption(state, 'b1', 'Deadpan dog fact', 'c-b1-1', T0 + 2000);
    state = res.state;
    expect(state.phase).toBe('caption');

    res = submitCaption(state, 'b2', 'CHAOS DOG', 'c-b2-1', T0 + 3000);
    state = res.state;
    expect(state.phase).toBe('vote');
    expect(state.captions.length).toBe(3);

    // Vote: everyone votes for someone else's caption
    const hostCaption = state.captions.find((c) => c.playerId === 'host')!;
    const b1Caption = state.captions.find((c) => c.playerId === 'b1')!;
    const b2Caption = state.captions.find((c) => c.playerId === 'b2')!;

    res = submitVote(state, 'host', b1Caption.id, T0 + 4000);
    state = res.state;
    res = submitVote(state, 'b1', b2Caption.id, T0 + 5000);
    state = res.state;
    res = submitVote(state, 'b2', b1Caption.id, T0 + 6000);
    state = res.state;
    expect(state.phase).toBe('reveal');
    expect(state.history.length).toBe(1);
    expect(state.history[0].winnerCaptionIds).toEqual([b1Caption.id]);
    // b1 got 2 votes -> +2 score
    expect(state.players.find((p) => p.id === 'b1')!.score).toBe(2);

    // Advance to round 2, needs a photo first
    const needs = advance(state, 'host', T0 + 20_000);
    expect(needs.needsPhoto).toBe(true);
    expect(needs.state).toEqual(state);

    res = advance(state, 'host', T0 + 20_000, PHOTO_2);
    state = res.state;
    expect(state.phase).toBe('caption');
    expect(state.round).toBe(2);
    expect(state.photo).toEqual(PHOTO_2);
    expect(state.captions).toEqual([]);

    // Round 2: everyone votes for host this time
    res = submitCaption(state, 'host', 'Second round dog', 'c-host-2', T0 + 21_000);
    state = res.state;
    res = submitCaption(state, 'b1', 'Second round bot', 'c-b1-2', T0 + 22_000);
    state = res.state;
    res = submitCaption(state, 'b2', 'Second round chaos', 'c-b2-2', T0 + 23_000);
    state = res.state;
    expect(state.phase).toBe('vote');

    const host2 = state.captions.find((c) => c.playerId === 'host')!;
    res = submitVote(state, 'host', state.captions.find((c) => c.playerId === 'b1')!.id, T0 + 24_000);
    state = res.state;
    res = submitVote(state, 'b1', host2.id, T0 + 25_000);
    state = res.state;
    res = submitVote(state, 'b2', host2.id, T0 + 26_000);
    state = res.state;
    expect(state.phase).toBe('reveal');
    // host now has 2 (round 2) -> total 2; final round was the last (rounds=2)

    res = advance(state, 'host', T0 + 40_000);
    state = res.state;
    expect(state.phase).toBe('done');
    expect(state.championIds).toBeDefined();
    expect(state.championIds!.length).toBeGreaterThan(0);
  });
});

describe('tie handling', () => {
  it('every tied top caption wins and every winning author scores', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'one', 'c1', T0).state;
    state = submitCaption(state, 'b1', 'two', 'c2', T0).state;
    state = submitCaption(state, 'b2', 'three', 'c3', T0).state;

    const cHost = state.captions.find((c) => c.playerId === 'host')!.id;
    const cB1 = state.captions.find((c) => c.playerId === 'b1')!.id;
    const cB2 = state.captions.find((c) => c.playerId === 'b2')!.id;

    // A three-way rock-paper-scissors of votes: every caption gets exactly 1 vote.
    state = submitVote(state, 'host', cB1, T0).state;
    state = submitVote(state, 'b1', cB2, T0).state;
    const res = submitVote(state, 'b2', cHost, T0);
    state = res.state;

    expect(state.phase).toBe('reveal');
    const result = state.history[0];
    expect(result.winnerCaptionIds.sort()).toEqual([cB1, cB2, cHost].sort());
    expect(state.players.find((p) => p.id === 'host')!.score).toBe(1);
    expect(state.players.find((p) => p.id === 'b1')!.score).toBe(1);
    expect(state.players.find((p) => p.id === 'b2')!.score).toBe(1);
  });

  it('tally returns every caption tied at the max vote count', () => {
    const captions = [
      { id: 'a', playerId: 'p1', text: 'x' },
      { id: 'b', playerId: 'p2', text: 'y' },
      { id: 'c', playerId: 'p3', text: 'z' },
    ];
    const votes = { v1: 'a', v2: 'b' };
    const result = tally(captions, votes);
    expect(result.winnerCaptionIds.sort()).toEqual(['a', 'b']);
  });

  it('tally with zero votes cast has no winner', () => {
    const captions = [
      { id: 'a', playerId: 'p1', text: 'x' },
      { id: 'b', playerId: 'p2', text: 'y' },
    ];
    const result = tally(captions, {});
    expect(result.winnerCaptionIds).toEqual([]);
  });
});

describe('void round', () => {
  it('voids the round when fewer than 2 captions exist', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    // Only host captions; force the phase to end on timeout with just 1 caption.
    state = submitCaption(state, 'host', 'lonely caption', 'c1', T0).state;
    expect(state.phase).toBe('caption');

    const ended = endCaptionPhase(state, T0 + 999_999);
    state = ended.state;
    expect(state.phase).toBe('vote');
    expect(state.captions.length).toBe(1);

    const votedOut = endVotePhase(state, T0 + 9_999_999);
    state = votedOut.state;
    expect(state.phase).toBe('reveal');
    expect(state.history[0].winnerCaptionIds).toEqual([]);
    // No score awarded for a void round.
    expect(state.players.find((p) => p.id === 'host')!.score).toBe(0);
  });
});

describe('self-vote rejected', () => {
  it('rejects voting for your own caption', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'mine', 'c1', T0).state;
    state = submitCaption(state, 'b1', 'b1 caption', 'c2', T0).state;
    state = submitCaption(state, 'b2', 'b2 caption', 'c3', T0).state;
    expect(state.phase).toBe('vote');
    const hostCaptionId = state.captions.find((c) => c.playerId === 'host')!.id;
    const res = submitVote(state, 'host', hostCaptionId, T0);
    expect(res.error).toBe('cannot vote for your own caption');
    expect(res.state).toEqual(state);
  });
});

describe('double caption rejected', () => {
  it('rejects a second caption from the same player, first write wins', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    const res1 = submitCaption(state, 'host', 'first', 'c1', T0);
    state = res1.state;
    const res2 = submitCaption(state, 'host', 'second', 'c2', T0);
    expect(res2.error).toBe('already captioned this round');
    expect(res2.state.captions).toEqual(state.captions);
    expect(res2.state.captions[0].text).toBe('first');
  });
});

describe('non-host start rejected', () => {
  it('rejects start from a non-host player', () => {
    const state = twoRoundRoom();
    const res = start(state, 'b1', PHOTO, T0);
    expect(res.error).toBe('only the host can start');
    expect(res.state.phase).toBe('lobby');
  });
});

describe('non-host advance rejected', () => {
  it('rejects advance from a non-host, non-timer actor', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0).state;
    state = submitCaption(state, 'b2', 'c', 'c3', T0).state;
    const c1 = state.captions[0].id;
    state = submitVote(state, 'b1', c1, T0).state;
    state = submitVote(state, 'b2', c1, T0).state;
    state = submitVote(state, 'host', state.captions[1].id, T0).state;
    expect(state.phase).toBe('reveal');

    const res = advance(state, 'b1', T0);
    expect(res.error).toBe('only the host can advance');
  });
});

describe('publicView', () => {
  it('hides other players captions during caption phase but shows your own', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'host caption', 'c1', T0).state;
    // b1 hasn't captioned yet so the phase is still 'caption'.
    const hostView = publicView(state, 'host');
    expect(hostView.captions.map((c) => c.text)).toEqual(['host caption']);

    const b1View = publicView(state, 'b1');
    expect(b1View.captions).toEqual([]);
  });

  it('hides authors during vote and shows them in reveal', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0).state;
    state = submitCaption(state, 'b2', 'c', 'c3', T0).state;
    expect(state.phase).toBe('vote');

    const voteView = publicView(state, 'host');
    expect(voteView.captions.every((c) => c.playerId === undefined)).toBe(true);
    expect(voteView.captions.length).toBe(3);

    const c1 = state.captions[0].id;
    state = submitVote(state, 'b1', c1, T0).state;
    state = submitVote(state, 'b2', c1, T0).state;
    state = submitVote(state, 'host', state.captions[1].id, T0).state;
    expect(state.phase).toBe('reveal');

    const revealView = publicView(state, 'host');
    expect(revealView.captions.every((c) => typeof c.playerId === 'string')).toBe(true);
  });
});

describe('mid-game joiner', () => {
  it('plays from the next round, not the one in progress', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;

    const joinRes = join(state, { id: 'late', name: 'Latecomer' }, T0 + 500);
    expect(joinRes.error).toBeUndefined();
    state = joinRes.state;
    expect(state.players.find((p) => p.id === 'late')!.connected).toBe(false);

    // The round completes without the late joiner captioning.
    state = submitCaption(state, 'host', 'a', 'c1', T0).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0).state;
    const res = submitCaption(state, 'b2', 'c', 'c3', T0);
    state = res.state;
    expect(state.phase).toBe('vote');

    const c1 = state.captions[0].id;
    state = submitVote(state, 'b1', c1, T0).state;
    state = submitVote(state, 'b2', c1, T0).state;
    state = submitVote(state, 'host', state.captions[1].id, T0).state;
    expect(state.phase).toBe('reveal');

    const advanced = advance(state, 'host', T0, PHOTO_2);
    state = advanced.state;
    expect(state.phase).toBe('caption');
    // Now active for round 2.
    expect(state.players.find((p) => p.id === 'late')!.connected).toBe(true);
  });
});

describe('champion computed at done', () => {
  it('names every tied top scorer as champion', () => {
    const options = normalizeOptions({ rounds: 1 });
    let state = createRoom('WXYZ', { id: 'a', name: 'A' }, options, [], T0);
    state = { ...state, players: [{ id: 'a', name: 'A', isBot: false, score: 5, connected: true }, { id: 'b', name: 'B', isBot: false, score: 5, connected: true }] };
    state = { ...state, phase: 'reveal', round: 1 };
    const res = advance(state, 'a', T0);
    expect(res.state.phase).toBe('done');
    expect(res.state.championIds!.sort()).toEqual(['a', 'b']);
  });
});

describe('normalizeOptions clamping', () => {
  it('clamps out-of-range values into the allowed bands', () => {
    const opts = normalizeOptions({ rounds: 999, captionSeconds: 1, voteSeconds: 1, revealSeconds: 999, botCount: 99 });
    expect(opts.rounds).toBe(20);
    expect(opts.captionSeconds).toBe(15);
    expect(opts.voteSeconds).toBe(10);
    expect(opts.revealSeconds).toBe(60);
    expect(opts.botCount).toBe(4);
  });

  it('applies defaults when nothing is given', () => {
    const opts = normalizeOptions();
    expect(opts.rounds).toBe(5);
    expect(opts.botCount).toBe(2);
  });
});

describe('room full', () => {
  it('rejects a join once max human players is reached', () => {
    const options = normalizeOptions();
    let state = createRoom('FULL', { id: 'h', name: 'Host' }, options, [], T0);
    for (let i = 0; i < 7; i++) {
      state = join(state, { id: `p${i}`, name: `P${i}` }, T0).state;
    }
    expect(state.players.length).toBe(8);
    const res = join(state, { id: 'overflow', name: 'One Too Many' }, T0);
    expect(res.error).toBe('room is full');
  });
});

describe('caption validation', () => {
  it('rejects empty and over-length captions', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    const empty = submitCaption(state, 'host', '   ', 'c1', T0);
    expect(empty.error).toMatch(/1-120/);
    const tooLong = submitCaption(state, 'host', 'x'.repeat(121), 'c2', T0);
    expect(tooLong.error).toMatch(/1-120/);
  });

  it('trims whitespace from a valid caption', () => {
    let state = twoRoundRoom();
    state = start(state, 'host', PHOTO, T0).state;
    const res = submitCaption(state, 'host', '  hello world  ', 'c1', T0);
    expect(res.state.captions[0].text).toBe('hello world');
  });
});
