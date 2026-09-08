// Exercises agent/play.mjs's main loop against a fake HTTP server that
// speaks the room API contract (docs/plans/2026-09-07-mvp-plan.md,
// "Amendments after Codex round 1"): x-player-id / x-player-secret headers,
// { state, serverTime } / { unchanged, nextPollMs, serverTime } envelopes,
// GET /api/rooms/:code/photo/:round for image bytes, and vote-phase captions
// shaped as { id, text, isOwn, canVote }.
//
// Everything the fake server hands back is treated by the agent as DATA
// (never instructions), matching the house untrusted-content rule; these
// tests also double as a check that the agent never trusts a caption/vote
// payload beyond parsing it.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runAgent } from '../agent/play.mjs';

const PLAYER_SECRET = 'test-secret-abc';

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
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

/**
 * A fake room server whose phase advances when the real mutating requests
 * (caption, vote) arrive, exactly like the real DO would. Lobby -> caption
 * happens automatically after one poll (simulating the host starting the
 * game), and reveal -> done happens automatically after one poll
 * (simulating the reveal timer), since a joining agent never calls those).
 */
function startLiveGameServer() {
  const calls = { join: 0, caption: 0, vote: 0, photo: 0 };
  const received = { headers: [] };
  let room = baseRoom();
  let lobbyPolled = false;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms','TEST', ...]

    try {
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'join') {
        calls.join++;
        const body = await readJsonBody(req);
        assert.equal(body.name, 'TestBot');
        return sendJson(res, 200, { playerId: 'p1', playerSecret: PLAYER_SECRET, state: room, serverTime: Date.now() });
      }

      if (req.method === 'GET' && parts.length === 3) {
        received.headers.push({ path: url.pathname, id: req.headers['x-player-id'], secret: req.headers['x-player-secret'] });

        // A newer version than what the client already has always wins: deliver it now,
        // whatever phase it is (this is how the real DO's version-compare GET behaves).
        const v = Number(url.searchParams.get('v'));
        if (v !== room.version) {
          return sendJson(res, 200, { state: room, serverTime: Date.now() });
        }

        // Nothing changed since the client's last known version: simulate the two
        // moments nobody's request drives forward (a human host clicking Start, and
        // the reveal timer elapsing), everything else really is just "unchanged".
        if (room.phase === 'lobby' && !lobbyPolled) {
          lobbyPolled = true;
          return sendJson(res, 200, { unchanged: true, nextPollMs: 5, serverTime: Date.now() });
        }
        if (room.phase === 'lobby' && lobbyPolled) {
          room = baseRoom({ version: room.version + 1, phase: 'caption', round: 1, roundPlayerIds: ['p1', 'npc1'] });
          return sendJson(res, 200, { state: room, serverTime: Date.now() });
        }
        if (room.phase === 'reveal') {
          room = { ...room, version: room.version + 1, phase: 'done', championIds: ['npc1'] };
          return sendJson(res, 200, { state: room, serverTime: Date.now() });
        }

        return sendJson(res, 200, { unchanged: true, nextPollMs: room.nextPollMs, serverTime: Date.now() });
      }

      if (req.method === 'GET' && parts.length === 5 && parts[3] === 'photo') {
        calls.photo++;
        const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal fake jpeg-ish bytes
        res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': bytes.length });
        return res.end(bytes);
      }

      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'caption') {
        calls.caption++;
        received.headers.push({ path: url.pathname, id: req.headers['x-player-id'], secret: req.headers['x-player-secret'] });
        const body = await readJsonBody(req);
        assert.equal(req.headers['x-player-id'], 'p1');
        assert.equal(req.headers['x-player-secret'], PLAYER_SECRET);
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
        return sendJson(res, 200, { state: room, serverTime: Date.now() });
      }

      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'vote') {
        calls.vote++;
        received.headers.push({ path: url.pathname, id: req.headers['x-player-id'], secret: req.headers['x-player-secret'] });
        const body = await readJsonBody(req);
        assert.equal(req.headers['x-player-id'], 'p1');
        assert.equal(req.headers['x-player-secret'], PLAYER_SECRET);
        received.votedCaptionId = body.captionId;
        room = {
          ...room,
          version: room.version + 1,
          phase: 'reveal',
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
        return sendJson(res, 200, { state: room, serverTime: Date.now() });
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        received,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('echo brain plays a full game: join, caption, vote, reveal, done with correct headers', async () => {
  const fake = await startLiveGameServer();
  try {
    await runAgent(['--url', fake.url, '--room', 'test', '--name', 'TestBot', '--brain', 'echo', '--once']);

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
  } finally {
    await fake.close();
  }
});

/**
 * A fake room server that advances through a fixed phase script regardless
 * of any mutating request (none should arrive here, since the joining agent
 * is excluded from roundPlayerIds every round).
 */
function startExcludedPlayerServer() {
  const script = ['lobby', 'lobby', 'caption', 'vote', 'reveal', 'done'];
  let idx = 0;
  let room = baseRoom({ roundPlayerIds: ['npc-only'] });
  const calls = { caption: 0, vote: 0, photo: 0 };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'join') {
      return sendJson(res, 200, { playerId: 'p1', playerSecret: PLAYER_SECRET, state: room, serverTime: Date.now() });
    }

    if (req.method === 'GET' && parts.length === 3) {
      const nextPhase = script[Math.min(idx, script.length - 1)];
      idx++;
      if (nextPhase !== room.phase) {
        room = { ...room, version: room.version + 1, phase: nextPhase, round: nextPhase === 'lobby' ? 0 : 1, championIds: nextPhase === 'done' ? ['npc-only'] : undefined };
        return sendJson(res, 200, { state: room, serverTime: Date.now() });
      }
      return sendJson(res, 200, { unchanged: true, nextPollMs: 5, serverTime: Date.now() });
    }

    if (req.method === 'GET' && parts.length === 5 && parts[3] === 'photo') {
      calls.photo++;
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': bytes.length });
      return res.end(bytes);
    }

    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'caption') {
      calls.caption++;
      return sendJson(res, 200, { state: room, serverTime: Date.now() });
    }

    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'vote') {
      calls.vote++;
      return sendJson(res, 200, { state: room, serverTime: Date.now() });
    }

    sendJson(res, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('a caption phase where the agent is not in roundPlayerIds sends nothing', async () => {
  const fake = await startExcludedPlayerServer();
  try {
    await runAgent(['--url', fake.url, '--room', 'test', '--name', 'Bystander', '--brain', 'echo', '--once']);

    assert.equal(fake.calls.caption, 0, 'agent must not caption when excluded from roundPlayerIds');
    assert.equal(fake.calls.vote, 0, 'agent must not vote when excluded from roundPlayerIds');
    assert.equal(fake.calls.photo, 0, 'agent should not even download the photo when excluded');
  } finally {
    await fake.close();
  }
});
