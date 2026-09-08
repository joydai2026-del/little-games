import { describe, it, expect } from 'vitest';
import {
  advance,
  advanceIfDue,
  createRoom,
  endCaptionPhase,
  endVotePhase,
  join,
  publicView,
  start,
  submitCaption,
  submitVote,
  tally,
  touch,
} from '../src/shared/room';
import { trimToWordBoundary } from '../src/shared/text';
import { normalizeOptions, REVEAL_MIN_MS } from '../src/shared/config';
import { sanitizeCaption, sanitizeName, cleanModelCaption } from '../src/shared/text';
import type { BotJob, PhotoMeta, Player, RoomState } from '../src/shared/types';

const PHOTO: PhotoMeta = { round: 1, source: 'loremflickr', credit: 'loremflickr.com', sha256: 'a'.repeat(64), bytes: 1234 };
const PHOTO_2: PhotoMeta = { ...PHOTO, round: 2, sha256: 'b'.repeat(64) };
const T0 = 1_700_000_000_000;

function bot(id: string, name: string): Player {
  return { id, name, isBot: true, score: 0, lastSeenAt: T0 };
}

/** One bot job row, for the tests that need a bot to have already given up. */
function job(
  botId: string,
  round: number,
  phase: 'caption' | 'vote',
  status: BotJob['status']
): BotJob {
  return { jobId: `${botId}-${round}-${phase}`, botId, round, phase, dueAt: T0, deadline: T0 + 20_000, status };
}

function twoRoundRoom(): RoomState {
  const options = normalizeOptions({ rounds: 2, captionSeconds: 60, voteSeconds: 30, revealSeconds: 10, botCount: 2 });
  return createRoom('ABCD', { id: 'host', name: 'JJ' }, options, [bot('b1', 'Daisy'), bot('b2', 'Chip')], T0);
}

/** Everyone captions, everyone votes for the host, so the host wins the round. */
function playRoundHostWins(state: RoomState, at: number): RoomState {
  let s = state;
  s = submitCaption(s, 'host', 'host caption', `c-host-${s.round}`, at).state;
  s = submitCaption(s, 'b1', 'b1 caption', `c-b1-${s.round}`, at).state;
  s = submitCaption(s, 'b2', 'b2 caption', `c-b2-${s.round}`, at).state;
  // last caption auto-ends the phase
  s = submitVote(s, 'b1', `c-host-${s.round}`, at).state;
  s = submitVote(s, 'b2', `c-host-${s.round}`, at).state;
  s = submitVote(s, 'host', `c-b1-${s.round}`, at).state;
  return s;
}

describe('createRoom', () => {
  it('starts in lobby with the host first and an empty round roster', () => {
    const state = twoRoundRoom();
    expect(state.phase).toBe('lobby');
    expect(state.hostId).toBe('host');
    expect(state.players.map((p) => p.id)).toEqual(['host', 'b1', 'b2']);
    expect(state.roundPlayerIds).toEqual([]);
    expect(state.botJobs).toEqual([]);
    expect(state.version).toBe(1);
    expect(state.createdAt).toBe(T0);
    expect(state.expiresAt).toBe(T0 + 2 * 60 * 60 * 1000);
    expect(state.phaseStartedAt).toBe(T0);
  });
});

describe('full happy path: 1 human + 2 bots over 2 rounds', () => {
  it('plays start to finish and names a champion', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    expect(state.phase).toBe('caption');
    expect(state.round).toBe(1);
    expect(state.roundPlayerIds).toEqual(['host', 'b1', 'b2']);

    state = playRoundHostWins(state, T0 + 1000);
    expect(state.phase).toBe('reveal');
    expect(state.history).toHaveLength(1);
    expect(state.history[0].winnerCaptionIds).toEqual(['c-host-1']);
    expect(state.players.find((p) => p.id === 'host')?.score).toBe(2);

    // Round 2
    const afterFloor = T0 + 1000 + REVEAL_MIN_MS;
    state = advance(state, 'host', afterFloor, PHOTO_2).state;
    expect(state.phase).toBe('caption');
    expect(state.round).toBe(2);
    expect(state.photo).toEqual(PHOTO_2);

    state = playRoundHostWins(state, afterFloor + 1000);
    expect(state.phase).toBe('reveal');

    state = advance(state, 'host', afterFloor + 1000 + REVEAL_MIN_MS).state;
    expect(state.phase).toBe('done');
    expect(state.championIds).toEqual(['host']);
    expect(state.nextPollMs).toBe(0);
  });
});

describe('frozen round roster', () => {
  it('locks the roster when the round opens', () => {
    const state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    expect(state.roundPlayerIds).toEqual(['host', 'b1', 'b2']);
  });

  it('makes a mid-round joiner a spectator: cannot caption, does not block the phase', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = join(state, { id: 'late', name: 'Latecomer' }, T0 + 500).state;

    expect(state.players.map((p) => p.id)).toContain('late');
    expect(state.roundPlayerIds).not.toContain('late');

    const rejected = submitCaption(state, 'late', 'let me in', 'c-late', T0 + 600);
    expect(rejected.error).toBe('you are in from the next round');
    expect(rejected.state).toBe(state);

    // The three roster members finishing still ends the phase, despite `late` not having captioned.
    state = submitCaption(state, 'host', 'a', 'c-host-1', T0 + 700).state;
    state = submitCaption(state, 'b1', 'b', 'c-b1-1', T0 + 800).state;
    state = submitCaption(state, 'b2', 'c', 'c-b2-1', T0 + 900).state;
    expect(state.phase).toBe('vote');

    const noVote = submitVote(state, 'late', 'c-host-1', T0 + 950);
    expect(noVote.error).toBe('you are in from the next round');
  });

  it('adds the spectator to the roster when the next round opens', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = join(state, { id: 'late', name: 'Latecomer' }, T0 + 500).state;
    state = playRoundHostWins(state, T0 + 1000);
    state = advance(state, 'host', T0 + 1000 + REVEAL_MIN_MS, PHOTO_2).state;

    expect(state.round).toBe(2);
    expect(state.roundPlayerIds).toEqual(['host', 'b1', 'b2', 'late']);
    expect(submitCaption(state, 'late', 'finally', 'c-late-2', T0 + 9000).error).toBeUndefined();
  });
});

describe('reveal floor', () => {
  function revealState(): RoomState {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1000);
    expect(state.phase).toBe('reveal');
    return state;
  }

  it('refuses the host skipping reveal before REVEAL_MIN_MS', () => {
    const state = revealState();
    const early = advance(state, 'host', state.phaseStartedAt + REVEAL_MIN_MS - 1, PHOTO_2);
    expect(early.error).toBe('give everyone a second to see the scores');
    expect(early.state).toBe(state);
  });

  it('lets the host skip reveal once the floor has passed', () => {
    const state = revealState();
    const ok = advance(state, 'host', state.phaseStartedAt + REVEAL_MIN_MS, PHOTO_2);
    expect(ok.error).toBeUndefined();
    expect(ok.state.round).toBe(2);
  });

  it('honours a custom floor', () => {
    const state = revealState();
    expect(advance(state, 'host', state.phaseStartedAt + 500, PHOTO_2, 5000).error).toBeDefined();
    expect(advance(state, 'host', state.phaseStartedAt + 5000, PHOTO_2, 5000).error).toBeUndefined();
  });

  it('does not apply the floor to the timer, but the timer waits for phaseEndsAt', () => {
    const state = revealState();
    // revealSeconds is 10, so the timer must not fire at +4s even though the floor passed.
    expect(advance(state, 'timer', state.phaseStartedAt + 4000, PHOTO_2).state).toBe(state);
    const late = advance(state, 'timer', state.phaseEndsAt!, PHOTO_2);
    expect(late.state.round).toBe(2);
  });

  it('asks the caller for a photo when the next round needs one', () => {
    const state = revealState();
    const res = advance(state, 'timer', state.phaseEndsAt!);
    expect(res.needsPhoto).toBe(true);
    expect(res.state).toBe(state);
  });
});

describe('seeded vote order', () => {
  function voteState(code = 'ABCD'): RoomState {
    const options = normalizeOptions({ rounds: 2, botCount: 2 });
    let state = createRoom(code, { id: 'host', name: 'JJ' }, options, [bot('b1', 'Daisy'), bot('b2', 'Chip')], T0);
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'alpha', 'c1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'bravo', 'c2', T0 + 2).state;
    state = submitCaption(state, 'b2', 'charlie', 'c3', T0 + 3).state;
    expect(state.phase).toBe('vote');
    return state;
  }

  it('shows every viewer the same order', () => {
    const state = voteState();
    const a = publicView(state, 'host', T0).captions.map((c) => c.id);
    const b = publicView(state, 'b1', T0).captions.map((c) => c.id);
    const c = publicView(state, 'b2', T0 + 5000).captions.map((x) => x.id);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect([...a].sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('is a function of code and round, so a different room shuffles differently', () => {
    const orderFor = (code: string) => publicView(voteState(code), 'host', T0).captions.map((c) => c.id);
    const orders = new Set([orderFor('ABCD'), orderFor('WXYZ'), orderFor('K7QM')].map((o) => o.join(',')));
    // Three rooms, three seeds: at least two distinct orders (a collision of all three is the bug we would catch).
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('publicView redaction', () => {
  it('never leaks bot jobs', () => {
    const state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    const view = publicView(state, 'host', T0) as unknown as Record<string, unknown>;
    expect('botJobs' in view).toBe(false);
    expect(view.serverTime).toBe(T0);
  });

  it('shows a player only their own caption during the caption phase', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'mine', 'c-host', T0 + 1).state;
    state = submitCaption(state, 'b1', 'theirs', 'c-b1', T0 + 2).state;

    const hostView = publicView(state, 'host', T0 + 3);
    expect(hostView.captions).toEqual([{ id: 'c-host', text: 'mine', playerId: 'host' }]);

    const botView = publicView(state, 'b1', T0 + 3);
    expect(botView.captions).toEqual([{ id: 'c-b1', text: 'theirs', playerId: 'b1' }]);
  });

  it('never shows authorship during the vote phase, and marks the viewer own caption unvotable', () => {
    // Caption ids here deliberately do NOT contain a player id, so the
    // "no other player's id anywhere" check below cannot pass or fail by
    // accident on a substring of a caption id.
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'mine', 'cap-1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'theirs', 'cap-2', T0 + 2).state;
    state = submitCaption(state, 'b2', 'third', 'cap-3', T0 + 3).state;
    expect(state.phase).toBe('vote');

    const view = publicView(state, 'host', T0 + 4);
    expect(view.captions).toHaveLength(3);
    for (const c of view.captions) expect(c.playerId).toBeUndefined();

    const own = view.captions.find((c) => c.id === 'cap-1')!;
    expect(own).toEqual({ id: 'cap-1', text: 'mine', isOwn: true, canVote: false });
    const other = view.captions.find((c) => c.id === 'cap-2')!;
    expect(other).toEqual({ id: 'cap-2', text: 'theirs', isOwn: false, canVote: true });

    // And nothing in the payload links any OTHER player to anything.
    //
    // The old assertion here grepped for the literal string `"playerId"`, which
    // proved nothing: `votes` is keyed BY player id, so every id was sitting in
    // the same JSON while that assertion passed. This one checks the ids
    // themselves. The public roster fields are pulled out first, on purpose:
    // players / roundPlayerIds / hostId / championIds are ids every screen is
    // supposed to see (they are the lobby list), and `history` carries finished
    // rounds, which are public from their own reveal on. Everything else must be
    // free of any id but the viewer's.
    const { players, roundPlayerIds, hostId, championIds, history, ...secret } = view;
    expect(history).toEqual([]); // round 1, so nothing is hiding in past rounds
    expect(players.length).toBe(3);
    const json = JSON.stringify(secret);
    for (const id of ['b1', 'b2']) expect(json.includes(id)).toBe(false);
    expect(roundPlayerIds).toContain('host');
    expect(hostId).toBe('host');
    expect(championIds).toBeUndefined();
  });

  it('hides the live ballot during caption and vote, and hands back only your own vote', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'mine', 'c-host', T0 + 1).state;
    state = submitCaption(state, 'b1', 'theirs', 'c-b1', T0 + 2).state;
    state = submitCaption(state, 'b2', 'third', 'c-b2', T0 + 3).state;
    expect(state.phase).toBe('vote');

    state = submitVote(state, 'b1', 'c-host', T0 + 4).state;
    expect(state.phase).toBe('vote'); // b2 and the host still owe a vote

    // b1 sees its own vote and nothing else.
    const voter = publicView(state, 'b1', T0 + 5);
    expect(voter.votes).toEqual({});
    expect(voter.yourVote).toBe('c-host');

    // The host has not voted, and cannot see that b1 has.
    const waiting = publicView(state, 'host', T0 + 5);
    expect(waiting.votes).toEqual({});
    expect(waiting.yourVote).toBeNull();
    expect(JSON.stringify(waiting.votes).includes('b1')).toBe(false);

    // From reveal on the whole ballot is public.
    state = submitVote(state, 'b2', 'c-host', T0 + 6).state;
    state = submitVote(state, 'host', 'c-b1', T0 + 7).state;
    expect(state.phase).toBe('reveal');
    expect(publicView(state, 'host', T0 + 8).votes).toEqual({
      b1: 'c-host',
      b2: 'c-host',
      host: 'c-b1',
    });
  });

  it('keeps the caption phase ballot empty too', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'mine', 'c-host', T0 + 1).state;
    const view = publicView(state, 'host', T0 + 2);
    expect(view.phase).toBe('caption');
    expect(view.votes).toEqual({});
    expect(view.yourVote).toBeNull();
  });

  it('attaches authors from reveal on', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1000);
    const view = publicView(state, 'b1', T0 + 2000);
    expect(view.captions.every((c) => typeof c.playerId === 'string')).toBe(true);
  });
});

describe('voting rules', () => {
  function voteState(): RoomState {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0 + 2).state;
    state = submitCaption(state, 'b2', 'c', 'c3', T0 + 3).state;
    return state;
  }

  it('rejects a self vote', () => {
    const state = voteState();
    expect(submitVote(state, 'host', 'c1', T0 + 4).error).toBe('you cannot vote for your own caption');
  });

  it('rejects a second vote', () => {
    let state = voteState();
    state = submitVote(state, 'host', 'c2', T0 + 4).state;
    expect(submitVote(state, 'host', 'c3', T0 + 5).error).toBe('you already voted this round');
  });

  it('rejects an unknown caption id', () => {
    expect(submitVote(voteState(), 'host', 'nope', T0 + 4).error).toBe('that caption is not in this round');
  });

  it('gives every tied top caption the win and the points', () => {
    let state = voteState();
    state = submitVote(state, 'host', 'c2', T0 + 4).state;
    state = submitVote(state, 'b1', 'c3', T0 + 5).state;
    state = submitVote(state, 'b2', 'c1', T0 + 6).state;
    expect(state.phase).toBe('reveal');
    expect(state.history[0].winnerCaptionIds.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(state.players.map((p) => p.score)).toEqual([1, 1, 1]);
  });
});

describe('void round', () => {
  it('skips the ballot entirely and awards nothing when fewer than two captions exist', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'the only one', 'c1', T0 + 1).state;
    state = endCaptionPhase(state, state.phaseEndsAt!).state;

    // One caption cannot produce a winner however anyone votes, so the round is
    // over the moment the caption phase closes: nobody sits through a 30-second
    // vote timer on an unwinnable ballot.
    expect(state.phase).toBe('reveal');
    expect(state.history[0].winnerCaptionIds).toEqual([]);
    expect(state.players.every((p) => p.score === 0)).toBe(true);
  });

  it('voids a round with no captions at all, without a vote phase', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = endCaptionPhase(state, state.phaseEndsAt!).state;
    expect(state.phase).toBe('reveal');
    expect(state.history[0].captions).toEqual([]);
    expect(state.history[0].winnerCaptionIds).toEqual([]);
  });

  it('says WHY the round was void, so the reveal can tell a player who did nothing wrong', () => {
    // Nobody wrote anything at all.
    let quiet = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    quiet = endCaptionPhase(quiet, quiet.phaseEndsAt!).state;
    expect(quiet.history[0].voidReason).toBe('no-captions');

    // The other shape, and the one JJ hits playing alone: she captioned, and
    // both AI players' jobs ended `failed` because the model was down. "Not
    // enough captions" reads as an accusation; this is what actually happened.
    let dead = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    dead = {
      ...dead,
      botJobs: [
        job('b1', dead.round, 'caption', 'failed'),
        job('b2', dead.round, 'caption', 'failed'),
      ],
    };
    dead = submitCaption(dead, 'host', 'the only one', 'c1', T0 + 1).state;
    expect(dead.phase).toBe('reveal'); // a failed bot counts as having acted
    expect(dead.history[0].winnerCaptionIds).toEqual([]);
    expect(dead.history[0].voidReason).toBe('bots-failed');
  });

  it('does not blame the AI players when the human said nothing either', () => {
    // Review round 4, nit 5. A round where NOBODY captioned but a bot job also
    // failed used to report `bots-failed`, telling a player who timed out that
    // the AI let them down. `bots-failed` now needs a HUMAN caption to blame
    // anyone for.
    let silent = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    silent = {
      ...silent,
      botJobs: [
        job('b1', silent.round, 'caption', 'failed'),
        job('b2', silent.round, 'caption', 'failed'),
      ],
    };
    silent = endCaptionPhase(silent, silent.phaseEndsAt!).state;
    expect(silent.phase).toBe('reveal');
    expect(silent.history[0].captions).toEqual([]);
    expect(silent.history[0].voidReason).toBe('no-captions');
  });

  it('leaves voidReason off a round that actually produced a winner', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1);
    expect(state.history[0].winnerCaptionIds).toEqual(['c-host-1']);
    expect(state.history[0].voidReason).toBeUndefined();
  });
});

describe('publicView: the photo backoff moment', () => {
  it('tells the client WHEN the next photo attempt is, so a button can count down', () => {
    // Review round 4, should-fix 2. A host tapping Start or Next while the
    // server is backing off a dead image host gets a 200 with the unchanged
    // state, so their button went straight back to "Next round" and they tapped
    // a live-looking button for up to a minute. The moment is all a screen needs;
    // the attempt count stays server-side.
    const state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    expect(publicView(state, 'host', T0).photoRetryAt).toBeNull();

    const backingOff = { ...state, photoRetry: { attempts: 2, nextAttemptAt: T0 + 15_000 } };
    const view = publicView(backingOff, 'host', T0);
    expect(view.photoRetryAt).toBe(T0 + 15_000);
    // and the attempt count is not in the payload at all
    expect(JSON.stringify(view)).not.toContain('"attempts"');
  });
});

describe('tally', () => {
  it('counts votes and returns every tied top caption', () => {
    const captions = [
      { id: 'a', playerId: 'p1', text: 'a' },
      { id: 'b', playerId: 'p2', text: 'b' },
      { id: 'c', playerId: 'p3', text: 'c' },
    ];
    const { counts, winnerCaptionIds } = tally(captions, { p1: 'b', p2: 'c', p3: 'b', p4: 'c' });
    expect(counts).toEqual({ a: 0, b: 2, c: 2 });
    expect(winnerCaptionIds.sort()).toEqual(['b', 'c']);
  });

  it('has no winner when nobody voted', () => {
    expect(tally([{ id: 'a', playerId: 'p1', text: 'a' }], {}).winnerCaptionIds).toEqual([]);
  });
});

describe('host-only actions', () => {
  it('refuses a non-host start', () => {
    let state = twoRoundRoom();
    state = join(state, { id: 'p2', name: 'Friend' }, T0).state;
    expect(start(state, 'p2', PHOTO, T0).error).toBe('only the host can start');
  });

  it('refuses a non-host next', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1000);
    expect(advance(state, 'b1', state.phaseStartedAt + 60_000, PHOTO_2).error).toBe('only the host can move on');
  });

  it('refuses a second start', () => {
    const state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    expect(start(state, 'host', PHOTO, T0).error).toBe('this game already started');
  });
});

describe('joining', () => {
  it('rejects an empty name', () => {
    expect(join(twoRoundRoom(), { id: 'x', name: '   ' }, T0).error).toBe('name required');
  });

  it('rejects the ninth human', () => {
    let state = twoRoundRoom();
    for (let i = 2; i <= 8; i++) state = join(state, { id: `p${i}`, name: `P${i}` }, T0).state;
    expect(state.players.filter((p) => !p.isBot)).toHaveLength(8);
    expect(join(state, { id: 'p9', name: 'P9' }, T0).error).toBe('this room is full');
  });

  it('rejects joining a finished game', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1000);
    state = advance(state, 'host', state.phaseStartedAt + REVEAL_MIN_MS, PHOTO_2).state;
    state = playRoundHostWins(state, T0 + 90_000);
    state = advance(state, 'host', state.phaseStartedAt + REVEAL_MIN_MS).state;
    expect(state.phase).toBe('done');
    expect(join(state, { id: 'late', name: 'Late' }, T0 + 99_000).error).toBe('this game is over');
  });
});

describe('touch (lastSeenAt)', () => {
  it('updates the timestamp without bumping the version', () => {
    const state = twoRoundRoom();
    const next = touch(state, 'host', T0 + 5000);
    expect(next.players[0].lastSeenAt).toBe(T0 + 5000);
    expect(next.version).toBe(state.version);
  });

  it('ignores an unknown player', () => {
    const state = twoRoundRoom();
    expect(touch(state, 'nobody', T0 + 5000)).toBe(state);
  });
});

describe('advanceIfDue', () => {
  it('does nothing while the phase is still running', () => {
    const state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    expect(advanceIfDue(state, T0 + 1000).state).toBe(state);
  });

  it('ends an overdue caption phase and opens a fresh vote window', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'a', 'c1', T0 + 1).state;
    state = submitCaption(state, 'b1', 'b', 'c2', T0 + 2).state;
    // b2 never captions, so only the timer can move things on. One call can
    // only complete ONE timer-driven transition, because the phase it opens
    // gets its deadline from the same `now`: the vote window that just opened
    // is not also overdue.
    const first = advanceIfDue(state, T0 + 10 * 60 * 1000);
    expect(first.state.phase).toBe('vote');
    expect(first.state.history).toHaveLength(0);

    const second = advanceIfDue(first.state, first.state.phaseEndsAt!);
    expect(second.state.phase).toBe('reveal');
    expect(second.state.history).toHaveLength(1);
  });

  it('chains transitions in one pass when they are act-driven, not timer-driven', () => {
    // 1 human, 0 bots: the single caption completes the roster (-> vote), and
    // in the vote phase the only caption is the player's own, so there is
    // nothing they can vote for and the round is over immediately.
    let state = createRoom('SOLO', { id: 'host', name: 'JJ' }, normalizeOptions({ rounds: 1, botCount: 0 }), [], T0);
    state = start(state, 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'alone in here', 'c1', T0 + 1).state;
    expect(state.phase).toBe('reveal');
    expect(state.history[0].winnerCaptionIds).toEqual([]);
  });

  it('stops at reveal and asks for a photo', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1000);
    const result = advanceIfDue(state, T0 + 10 * 60 * 1000);
    expect(result.needsPhoto).toBe(true);
    expect(result.state.phase).toBe('reveal');
  });

  it('finishes the game after the last round with no photo needed', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = playRoundHostWins(state, T0 + 1000);
    state = advance(state, 'host', state.phaseStartedAt + REVEAL_MIN_MS, PHOTO_2).state;
    state = playRoundHostWins(state, T0 + 60_000);
    const result = advanceIfDue(state, T0 + 10 * 60 * 1000);
    expect(result.needsPhoto).toBeUndefined();
    expect(result.state.phase).toBe('done');
  });
});

describe('options', () => {
  it('clamps nonsense to a playable room', () => {
    expect(normalizeOptions({ rounds: 0, captionSeconds: 1, voteSeconds: 9999, revealSeconds: 0, botCount: 99 })).toEqual({
      rounds: 1,
      captionSeconds: 15,
      voteSeconds: 120,
      revealSeconds: 3,
      botCount: 4,
    });
  });
});

describe('text sanitizers', () => {
  it('trims a name, collapses whitespace, and caps it at 20 characters', () => {
    expect(sanitizeName('  JJ  ')).toBe('JJ');
    expect(sanitizeName('J   J')).toBe('J J');
    expect(sanitizeName('x'.repeat(50))).toHaveLength(20);
    expect(sanitizeName('   ')).toBe('');
  });

  it('folds a multi-line caption onto one line', () => {
    expect(sanitizeCaption('one\ntwo\r\nthree')).toBe('one two three');
    expect(sanitizeCaption('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeCaption('y'.repeat(200))).toHaveLength(120);
  });

  it('keeps an injection-shaped caption as literal text, character for character', () => {
    const payload = '<img src=x onerror=alert(1)>';
    expect(sanitizeCaption(payload)).toBe(payload);
    expect(sanitizeName(payload)).toBe(payload.slice(0, 20));
  });

  it('stores an injection-shaped caption verbatim through the reducer', () => {
    const payload = '<img src=x onerror=alert(1)>';
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', payload, 'c1', T0 + 1).state;
    expect(state.captions[0].text).toBe(payload);
  });

  it('strips a model preamble and wrapping quotes, but only on the bot path', () => {
    expect(cleanModelCaption('  "Just a goat being a goat."  ')).toBe('Just a goat being a goat.');
    expect(cleanModelCaption("Here's a caption: Goat sees all")).toBe('Goat sees all');
    // The human path leaves quotes alone.
    expect(sanitizeCaption('"quoted on purpose"')).toBe('"quoted on purpose"');
  });
});

describe('caption validation', () => {
  it('rejects an empty caption', () => {
    const state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    expect(submitCaption(state, 'host', '   ', 'c1', T0 + 1).error).toBe('caption cannot be empty');
  });

  it('rejects a second caption from the same player', () => {
    let state = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    state = submitCaption(state, 'host', 'first', 'c1', T0 + 1).state;
    expect(submitCaption(state, 'host', 'second', 'c2', T0 + 2).error).toBe('you already captioned this round');
  });

  it('rejects captioning outside the caption phase', () => {
    const state = twoRoundRoom();
    expect(submitCaption(state, 'host', 'too early', 'c1', T0).error).toBe('not in the caption phase');
  });
});

describe('dead bots do not hold up the round', () => {
  /** Marks a bot's job for the live round+phase as `failed`, the way reapBotJobs does. */
  function withFailedJob(state: RoomState, botId: string, phase: 'caption' | 'vote'): RoomState {
    return {
      ...state,
      botJobs: [
        ...state.botJobs,
        {
          jobId: `${botId}-${phase}-${state.round}`,
          botId,
          round: state.round,
          phase,
          dueAt: T0,
          deadline: T0 + 20_000,
          status: 'failed',
        },
      ],
    };
  }

  it('ends the caption phase as soon as the humans are done, when both bots gave up', () => {
    // The Workers AI outage case: both bot jobs end `failed` inside 20s, and JJ
    // then used to watch "1 of 3 captions in" for the remaining 55 seconds.
    let s = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    s = withFailedJob(s, 'b1', 'caption');
    s = withFailedJob(s, 'b2', 'caption');

    s = submitCaption(s, 'host', 'the only caption', 'c-host-1', T0 + 5_000).state;

    // One caption is a void round, so it runs straight through vote to reveal
    // rather than sitting on a ballot nobody can win.
    expect(s.phase).toBe('reveal');
    expect(s.history[0].winnerCaptionIds).toEqual([]);
  });

  it('still waits for a bot whose job is only pending or running', () => {
    let s = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    s = {
      ...s,
      botJobs: [
        { jobId: 'j1', botId: 'b1', round: 1, phase: 'caption', dueAt: T0, deadline: T0 + 20_000, status: 'running' },
        { jobId: 'j2', botId: 'b2', round: 1, phase: 'caption', dueAt: T0, deadline: T0 + 20_000, status: 'pending' },
      ],
    };

    s = submitCaption(s, 'host', 'the first caption', 'c-host-1', T0 + 5_000).state;

    expect(s.phase).toBe('caption');
  });

  it('ends the vote phase when the only outstanding voter is a bot that gave up', () => {
    let s = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    s = submitCaption(s, 'host', 'host caption', 'c-host-1', T0).state;
    s = submitCaption(s, 'b1', 'b1 caption', 'c-b1-1', T0).state;
    s = submitCaption(s, 'b2', 'b2 caption', 'c-b2-1', T0).state;
    expect(s.phase).toBe('vote');

    s = withFailedJob(s, 'b2', 'vote');
    s = submitVote(s, 'host', 'c-b1-1', T0 + 1_000).state;
    expect(s.phase).toBe('vote'); // b1 has not voted yet

    s = submitVote(s, 'b1', 'c-host-1', T0 + 2_000).state;
    expect(s.phase).toBe('reveal'); // b2 is never coming
  });

  it('a failed job in another round or phase does not count', () => {
    let s = start(twoRoundRoom(), 'host', PHOTO, T0).state;
    s = {
      ...s,
      botJobs: [
        { jobId: 'old', botId: 'b1', round: 0, phase: 'caption', dueAt: T0, deadline: T0, status: 'failed' },
        { jobId: 'other', botId: 'b2', round: 1, phase: 'vote', dueAt: T0, deadline: T0, status: 'failed' },
      ],
    };

    s = submitCaption(s, 'host', 'the first caption', 'c-host-1', T0 + 5_000).state;

    expect(s.phase).toBe('caption');
  });
});

describe('trimToWordBoundary', () => {
  it('cuts a long model answer at a word, not through one', () => {
    // The live shape from the p4 tuning run: a Chaos Chip answer that ran to
    // exactly the 120-character cap and ended "...ownership of a t".
    const rambling =
      'A crucial moment as a dog and a snake engage in a game of rock-paper-scissors, with the winner claiming ownership of a towel';
    const trimmed = trimToWordBoundary(rambling, 120);
    expect(trimmed.length).toBeLessThanOrEqual(120);
    expect(trimmed.endsWith('t')).toBe(false);
    expect(rambling.startsWith(trimmed)).toBe(true);
    expect(trimmed.split(' ').pop()).not.toBe('t');
  });

  it('prefers a sentence end when there is a usable one', () => {
    const two = 'He forgot the fishing licence. The heron did not, and has filed the paperwork already.';
    expect(trimToWordBoundary(two, 60)).toBe('He forgot the fishing licence.');
  });

  it('leaves anything already short enough exactly as it is', () => {
    expect(trimToWordBoundary('He forgot the fishing licence.', 120)).toBe(
      'He forgot the fishing licence.'
    );
  });
});
