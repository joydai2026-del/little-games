// Exercises agent/play.mjs's main loop against an in-memory fake `fetch` that
// speaks the room API contract (docs/plans/2026-09-07-mvp-plan.md,
// "Amendments after Codex round 1"): x-player-id / x-player-secret headers,
// { state, serverTime } / { unchanged, nextPollMs, serverTime } envelopes,
// GET /api/rooms/:code/photo/:round for image bytes, and vote-phase captions
// shaped as { id, text, isOwn, canVote }.
//
// NO SOCKET. The fake is a plain function passed in as `runAgent(argv, {
// fetchImpl })`, so this suite proves the flow without binding a port. The
// earlier version started a real http.Server on 127.0.0.1, which a managed
// sandbox refused with EPERM: `npm test` then failed for a reason that had
// nothing to do with the code under test.
//
// Everything the fake hands back is treated by the agent as DATA (never
// instructions), matching the house untrusted-content rule; these tests also
// double as a check that the agent never trusts a caption/vote payload beyond
// parsing it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../agent/play.mjs';

const PLAYER_SECRET = 'test-secret-abc';
const PHOTO_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal fake jpeg-ish bytes

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function basePlayers(scores = {}) {
  return [
    { id: 'p1', name: 'TestBot', isBot: false, score: scores.p1 ?? 0, lastSeenAt: Date.now() },
    { id: 'npc1', name: 'NPC', isBot: true, score: scores.npc1 ?? 0, lastSeenAt: Date.now() },
  ];
}

function baseRoom(overrides) {
  return {
    code: 'TEST',
    version: 1,
    phase: 'lobby',
    round: 0,
    options: { rounds: 1, captionSeconds: 60, voteSeconds: 30, revealSeconds: 5, botCount: 1 },
    hostId: 'p1',
    players: basePlayers(),
    roundPlayerIds: [],
    captions: [],
    votes: {},
    yourVote: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
    phaseStartedAt: Date.now(),
    phaseEndsAt: Date.now() + 60_000,
    botJobs: [],
    history: [],
    championIds: undefined,
    nextPollMs: 5,
    ...overrides,
  };
}

/** Everything the agent's request objects can be, flattened for the fakes. */
function describeRequest(input, init = {}) {
  const url = new URL(String(input));
  return {
    method: (init.method ?? 'GET').toUpperCase(),
    url,
    parts: url.pathname.split('/').filter(Boolean), // ['api','rooms','TEST', ...]
    headers: init.headers ?? {},
    body: init.body ? JSON.parse(init.body) : {},
  };
}

/**
 * A fake room whose phase advances when the real mutating requests (caption,
 * vote) arrive, exactly like the real DO would. Lobby -> caption happens after
 * one poll (simulating the host starting the game) and reveal -> done after one
 * poll (simulating the reveal timer), since a joining agent never calls those.
 */
function liveGameFetch() {
  const calls = { join: 0, caption: 0, vote: 0, photo: 0 };
  const received = { headers: [] };
  let room = baseRoom();
  let lobbyPolled = false;

  const fetchImpl = async (input, init) => {
    const req = describeRequest(input, init);
    const { method, url, parts, headers, body } = req;

    if (method === 'POST' && parts.length === 4 && parts[3] === 'join') {
      calls.join++;
      assert.equal(body.name, 'TestBot');
      return jsonResponse({
        playerId: 'p1',
        playerSecret: PLAYER_SECRET,
        state: room,
        serverTime: Date.now(),
      });
    }

    if (method === 'GET' && parts.length === 3) {
      received.headers.push({
        path: url.pathname,
        id: headers['x-player-id'],
        secret: headers['x-player-secret'],
      });

      // A newer version than the client already holds always wins: deliver it
      // now, whatever the phase (this is the real DO's version-compare GET).
      const v = Number(url.searchParams.get('v'));
      if (v !== room.version) return jsonResponse({ state: room, serverTime: Date.now() });

      // Nothing changed since the client's last known version: simulate the two
      // moments nobody's request drives forward (a human host clicking Start,
      // and the reveal timer elapsing). Everything else really is unchanged.
      if (room.phase === 'lobby' && !lobbyPolled) {
        lobbyPolled = true;
        return jsonResponse({ unchanged: true, nextPollMs: 5, serverTime: Date.now() });
      }
      if (room.phase === 'lobby' && lobbyPolled) {
        room = baseRoom({
          version: room.version + 1,
          phase: 'caption',
          round: 1,
          roundPlayerIds: ['p1', 'npc1'],
        });
        return jsonResponse({ state: room, serverTime: Date.now() });
      }
      if (room.phase === 'reveal') {
        room = { ...room, version: room.version + 1, phase: 'done', championIds: ['npc1'] };
        return jsonResponse({ state: room, serverTime: Date.now() });
      }

      return jsonResponse({ unchanged: true, nextPollMs: room.nextPollMs, serverTime: Date.now() });
    }

    if (method === 'GET' && parts.length === 5 && parts[3] === 'photo') {
      calls.photo++;
      return new Response(PHOTO_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }

    if (method === 'POST' && parts.length === 4 && parts[3] === 'caption') {
      calls.caption++;
      received.headers.push({
        path: url.pathname,
        id: headers['x-player-id'],
        secret: headers['x-player-secret'],
      });
      assert.equal(typeof body.text, 'string');
      assert.ok(body.text.length > 0);
      received.captionText = body.text;
      room = {
        ...room,
        version: room.version + 1,
        phase: 'vote',
        captions: [
          { id: 'own-cap', text: body.text, isOwn: true, canVote: false },
          { id: 'npc-cap', text: 'A rival caption about the same photo', isOwn: false, canVote: true },
        ],
      };
      return jsonResponse({ state: room, serverTime: Date.now() });
    }

    if (method === 'POST' && parts.length === 4 && parts[3] === 'vote') {
      calls.vote++;
      received.headers.push({
        path: url.pathname,
        id: headers['x-player-id'],
        secret: headers['x-player-secret'],
      });
      received.votedCaptionId = body.captionId;
      room = {
        ...room,
        version: room.version + 1,
        phase: 'reveal',
        yourVote: body.captionId,
        players: basePlayers({ npc1: 1 }),
        history: [
          {
            round: 1,
            photo: { round: 1, source: 'picsum', sha256: 'fake', bytes: 4 },
            captions: [
              { id: 'own-cap', playerId: 'p1', text: received.captionText },
              { id: 'npc-cap', playerId: 'npc1', text: 'A rival caption about the same photo' },
            ],
            votes: { p1: 'npc-cap' },
            winnerCaptionIds: ['npc-cap'],
          },
        ],
      };
      return jsonResponse({ state: room, serverTime: Date.now() });
    }

    return jsonResponse({ error: 'not found' }, 404);
  };

  return { fetchImpl, calls, received };
}

test('echo brain plays a full game: join, caption, vote, reveal, done with correct headers', async () => {
  const fake = liveGameFetch();

  await runAgent(['--url', 'http://room.test', '--room', 'test', '--name', 'TestBot', '--brain', 'echo'], {
    fetchImpl: fake.fetchImpl,
  });

  assert.equal(fake.calls.join, 1);
  assert.equal(fake.calls.caption, 1, 'agent should submit exactly one caption');
  assert.equal(fake.calls.vote, 1, 'agent should submit exactly one vote');
  assert.equal(fake.calls.photo, 1, 'agent should download the photo exactly once');

  assert.equal(fake.received.captionText, 'echo bot saw round 1');
  assert.equal(fake.received.votedCaptionId, 'npc-cap', 'echo brain votes for the first votable caption');

  for (const h of fake.received.headers) {
    assert.equal(h.id, 'p1', `missing/wrong x-player-id header on ${h.path}`);
    assert.equal(h.secret, PLAYER_SECRET, `missing/wrong x-player-secret header on ${h.path}`);
  }
});

/**
 * A fake room that walks a fixed phase script regardless of any mutating
 * request (none should arrive, since the joining agent is excluded from
 * roundPlayerIds every round).
 */
function excludedPlayerFetch() {
  const script = ['lobby', 'lobby', 'caption', 'vote', 'reveal', 'done'];
  let idx = 0;
  let room = baseRoom({ roundPlayerIds: ['npc-only'] });
  const calls = { caption: 0, vote: 0, photo: 0 };

  const fetchImpl = async (input, init) => {
    const { method, parts } = describeRequest(input, init);

    if (method === 'POST' && parts.length === 4 && parts[3] === 'join') {
      return jsonResponse({
        playerId: 'p1',
        playerSecret: PLAYER_SECRET,
        state: room,
        serverTime: Date.now(),
      });
    }

    if (method === 'GET' && parts.length === 3) {
      const nextPhase = script[Math.min(idx, script.length - 1)];
      idx++;
      if (nextPhase !== room.phase) {
        room = {
          ...room,
          version: room.version + 1,
          phase: nextPhase,
          round: nextPhase === 'lobby' ? 0 : 1,
          championIds: nextPhase === 'done' ? ['npc-only'] : undefined,
        };
        return jsonResponse({ state: room, serverTime: Date.now() });
      }
      return jsonResponse({ unchanged: true, nextPollMs: 5, serverTime: Date.now() });
    }

    if (method === 'GET' && parts.length === 5 && parts[3] === 'photo') {
      calls.photo++;
      return new Response(PHOTO_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }

    if (method === 'POST' && parts.length === 4 && parts[3] === 'caption') {
      calls.caption++;
      return jsonResponse({ state: room, serverTime: Date.now() });
    }

    if (method === 'POST' && parts.length === 4 && parts[3] === 'vote') {
      calls.vote++;
      return jsonResponse({ state: room, serverTime: Date.now() });
    }

    return jsonResponse({ error: 'not found' }, 404);
  };

  return { fetchImpl, calls };
}

test('a caption phase where the agent is not in roundPlayerIds sends nothing', async () => {
  const fake = excludedPlayerFetch();

  await runAgent(['--url', 'http://room.test', '--room', 'test', '--name', 'Bystander', '--brain', 'echo'], {
    fetchImpl: fake.fetchImpl,
  });

  assert.equal(fake.calls.caption, 0, 'agent must not caption when excluded from roundPlayerIds');
  assert.equal(fake.calls.vote, 0, 'agent must not vote when excluded from roundPlayerIds');
  assert.equal(fake.calls.photo, 0, 'agent should not even download the photo when excluded');
});

/**
 * A vote the server already recorded must not be cast again. This is the "the
 * request landed but the reply was lost" case: the next poll carries
 * `yourVote`, and the agent has to treat that as done rather than retrying on
 * every poll until the reveal.
 */
function alreadyVotedFetch() {
  let room = baseRoom({
    phase: 'vote',
    round: 1,
    roundPlayerIds: ['p1', 'npc1'],
    yourVote: 'npc-cap',
    captions: [
      { id: 'own-cap', text: 'mine', isOwn: true, canVote: false },
      { id: 'npc-cap', text: 'theirs', isOwn: false, canVote: true },
    ],
  });
  const calls = { vote: 0 };
  let polls = 0;

  const fetchImpl = async (input, init) => {
    const { method, parts } = describeRequest(input, init);

    if (method === 'POST' && parts.length === 4 && parts[3] === 'join') {
      return jsonResponse({
        playerId: 'p1',
        playerSecret: PLAYER_SECRET,
        state: room,
        serverTime: Date.now(),
      });
    }

    if (method === 'GET' && parts.length === 3) {
      polls++;
      // Sit in `vote` for a few polls (each one a chance to double-vote), then
      // end the game so the run terminates.
      if (polls >= 3) {
        room = { ...room, version: room.version + 1, phase: 'done', championIds: ['npc1'] };
      } else {
        room = { ...room, version: room.version + 1 };
      }
      return jsonResponse({ state: room, serverTime: Date.now() });
    }

    if (method === 'POST' && parts.length === 4 && parts[3] === 'vote') {
      calls.vote++;
      return jsonResponse({ state: room, serverTime: Date.now() });
    }

    return jsonResponse({ error: 'not found' }, 404);
  };

  return { fetchImpl, calls };
}

test('a vote the server already recorded (yourVote) is never cast again', async () => {
  const fake = alreadyVotedFetch();

  await runAgent(['--url', 'http://room.test', '--room', 'test', '--name', 'TestBot', '--brain', 'echo'], {
    fetchImpl: fake.fetchImpl,
  });

  assert.equal(fake.calls.vote, 0, 'the agent must honour state.yourVote and not re-vote');
});
