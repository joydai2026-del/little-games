// The Durable Object shell itself: auth, expiry, and the single alarm.
//
// Everything the reducer does is already covered by room.test.ts. This file is
// about the 500-odd lines AROUND it that no pure test could reach, driven
// through a hand-written fake of the two Cloudflare pieces RoomDO actually
// touches: `ctx.storage` and `ctx.blockConcurrencyWhile`. Nothing here talks to
// the network: every test seeds a room that is already past its photo fetch.
//
// It typechecks under tsconfig.worker.json (not the client one) because RoomDO
// refers to Cloudflare's ambient types.

import { describe, it, expect, vi } from 'vitest';

/**
 * The ONE piece of I/O in RoomDO, replaced for the whole file so nothing here
 * can reach the network. `photoControl` decides whether the fetch succeeds and
 * lets a test run something (a concurrent join) while the DO is awaiting it,
 * which is the only way to reproduce the two await-window races below.
 */
const photoControl = vi.hoisted(() => ({
  fail: false,
  calls: 0,
  delayMs: 0,
  during: null as null | (() => Promise<unknown>),
  /**
   * `Date.now()` read INSIDE the mock, after its delay and before it returns or
   * throws (review round 8, should-fix 2). Tests that care about "the DO read
   * the clock AFTER the download" compare against this, not against a
   * `Date.now()` taken before the call plus the nominal delay: `setTimeout(80)`
   * does not guarantee 80ms of `Date.now()`, because libuv arms the timer
   * against the event loop's cached time, so the timer can deliver at 79.
   * Measured on this machine (node 22, `setTimeout(N)` then `Date.now()`):
   *   idle,        setTimeout(80):  14/2000 short, min delta 79
   *   5ms of busy JS first,     80:  11/300  short, min delta 79
   *   10ms of busy JS first,    80:   2/300  short, min delta 79
   *   10ms of busy JS first,    60:   8/300  short, min delta 59
   * Always short by exactly 1ms, never more, which is the signature of the
   * cached-clock arming rather than of a slow machine. That 1ms is the whole
   * bug: it made `tests/room-do.test.ts:573` fail 1 run in 33 for the round-8
   * reviewer, on the run they fired concurrently with `tsc`.
   */
  resolvedAt: 0,
}));

vi.mock('../src/worker/photo', () => ({
  fetchPhoto: async (_settings: unknown, _code: string, round: number) => {
    photoControl.calls += 1;
    if (photoControl.during) {
      const run = photoControl.during;
      photoControl.during = null;
      await run();
    }
    if (photoControl.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, photoControl.delayMs));
    }
    // The last thing the "download" does, success or failure. Anything the DO
    // reads from the clock afterwards is at or after this instant, by
    // construction rather than by arithmetic on a nominal delay.
    photoControl.resolvedAt = Date.now();
    if (photoControl.fail) throw new Error('both photo hosts are down');
    return {
      meta: { round, source: 'picsum', sha256: 'e'.repeat(64), bytes: 4 },
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/jpeg',
    };
  },
}));

import { RoomDO } from '../src/worker/room-do';
import { createRoom, start, submitCaption } from '../src/shared/room';
import { BOT_VOTE_TEMPERATURE, normalizeOptions } from '../src/shared/config';
import type { Env } from '../src/worker/env';
import type { PhotoMeta, Player, RoomState } from '../src/shared/types';

// RoomDO reads its own clock (Date.now()), and a room whose expiresAt is in the
// past is destroyed on sight. So these rooms are seeded around the real clock,
// not a fixed 2023 timestamp.
const T0 = Date.now();
const PHOTO: PhotoMeta = { round: 1, source: 'picsum', sha256: 'd'.repeat(64), bytes: 42 };
const SECRET = 'secret-abc';

function bot(id: string): Player {
  return { id, name: id, isBot: true, score: 0, lastSeenAt: T0 };
}

/** A minimal DurableObjectStorage: the six calls RoomDO makes, and a record of the alarms. */
class FakeStorage {
  readonly map = new Map<string, unknown>();
  alarms: number[] = [];
  alarmDeletes = 0;
  deleteAllCalls = 0;

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.map.set(keyOrEntries, value);
      return;
    }
    for (const [k, v] of Object.entries(keyOrEntries)) this.map.set(k, v);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async deleteAll(): Promise<void> {
    this.deleteAllCalls += 1;
    this.map.clear();
  }

  async setAlarm(at: number): Promise<void> {
    this.alarms.push(at);
  }

  async deleteAlarm(): Promise<void> {
    this.alarmDeletes += 1;
  }
}

/**
 * The two `ctx` members RoomDO uses. The real blockConcurrencyWhile holds
 * incoming requests until its promise settles, so the fake hands that promise
 * back and `build()` awaits it: without that the constructor's state load is
 * still in flight when the first fetch arrives, and every request 404s.
 */
class FakeState {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly storage: FakeStorage) {}
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const promise = fn();
    this.pending = promise;
    return promise;
  }
  loaded(): Promise<unknown> {
    return this.pending;
  }
}

const ENV = {} as Env; // settings() falls back to the shared defaults for every var

/** A room mid-caption-phase, already past its photo fetch, seeded straight into storage. */
function seededRoom(over: Partial<RoomState> = {}): RoomState {
  // Three in the roster on purpose: two captions must not complete it, or the
  // phase would auto-advance out of `caption` in the middle of a test.
  const options = normalizeOptions({ rounds: 2, captionSeconds: 60, voteSeconds: 30, revealSeconds: 10, botCount: 2 });
  const lobby = createRoom('ABCD', { id: 'host', name: 'JJ' }, options, [bot('b1'), bot('b2')], T0);
  return { ...start(lobby, 'host', PHOTO, T0).state, ...over };
}

async function build(
  room: RoomState | null
): Promise<{ room: RoomDO; storage: FakeStorage }> {
  const storage = new FakeStorage();
  if (room) {
    storage.map.set('state', room);
    storage.map.set('secrets', { host: SECRET, b1: 'bot-secret', b2: 'bot-secret-2' });
    storage.map.set('personas', { b1: 'daisy-deadpan', b2: 'chaos-chip' });
    storage.map.set('photo:1', { bytes: new ArrayBuffer(4), contentType: 'image/jpeg' });
  }
  const ctx = new FakeState(storage);
  const doRoom = new RoomDO(ctx as unknown as DurableObjectState, ENV);
  await ctx.loaded();
  return { room: doRoom, storage };
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://room/${path}`, { method: 'GET', headers });
}

describe('RoomDO authentication', () => {
  it('refuses a request with no credentials at all', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(get('state'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not a player in this room' });
  });

  it('refuses a known player id with the wrong secret', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(
      get('state', { 'x-player-id': 'host', 'x-player-secret': 'not-it' })
    );
    expect(res.status).toBe(403);
  });

  it('refuses a player id nobody issued', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(
      get('state', { 'x-player-id': 'gatecrasher', 'x-player-secret': SECRET })
    );
    expect(res.status).toBe(403);
  });

  it('refuses half the credentials', async () => {
    const { room } = await build(seededRoom());
    expect((await room.fetch(get('state', { 'x-player-id': 'host' }))).status).toBe(403);
    expect((await room.fetch(get('state', { 'x-player-secret': SECRET }))).status).toBe(403);
  });

  it('lets a real player through, and never returns a secret', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(
      get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET })
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('bot-secret');
    expect((JSON.parse(body) as { state: { phase: string } }).state.phase).toBe('caption');
  });
});

describe('RoomDO expiry', () => {
  it('deletes everything, and the pending alarm, once the room is past expiresAt', async () => {
    const { room, storage } = await build(seededRoom({ expiresAt: Date.now() - 1 }));
    const res = await room.fetch(
      get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'that room is not around any more' });
    // deleteAll() does not cancel an alarm, so the alarm has to go first and by
    // hand: otherwise an empty Durable Object keeps waking up for two hours.
    expect(storage.alarmDeletes).toBe(1);
    expect(storage.deleteAllCalls).toBe(1);
    expect(storage.map.size).toBe(0);
  });

  it('answers an unknown room the same way, with no storage to delete', async () => {
    const { room, storage } = await build(null);
    const res = await room.fetch(get('state', { 'x-player-id': 'host' }));
    expect(res.status).toBe(404);
    expect(storage.deleteAllCalls).toBe(0);
  });
});

describe('RoomDO alarm re-arming', () => {
  it('re-arms after a plain GET advances the room', async () => {
    // The caption timer ran out while nobody was looking, and both players have
    // captioned nothing. The next poll is what notices.
    const seeded = seededRoom({ phaseEndsAt: Date.now() - 1_000 });
    const { room, storage } = await build(seeded);

    const res = await room.fetch(
      get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET })
    );
    expect(res.status).toBe(200);

    // The GET moved the room on...
    const after = storage.map.get('state') as RoomState;
    expect(after.phase).not.toBe('caption');
    expect(after.version).toBeGreaterThan(seeded.version);

    // ...and it re-armed the single alarm on the way out. This is the whole
    // point: the poll path used to be the one route that never called armAlarm,
    // which could strand the next phase deadline behind a consumed alarm.
    expect(storage.alarms.length).toBeGreaterThan(0);
    expect(storage.alarms[storage.alarms.length - 1]).toBeGreaterThanOrEqual(Date.now() - 50);
  });

  it('re-arms even when the request changed nothing', async () => {
    const { room, storage } = await build(seededRoom({ phaseEndsAt: Date.now() + 60_000 }));
    await room.fetch(get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET }));
    expect(storage.alarms.length).toBe(1);
  });

  it('does not re-arm a request it rejected before the room was touched', async () => {
    const { room, storage } = await build(seededRoom());
    await room.fetch(get('state'));
    expect(storage.alarms.length).toBe(0);
  });
});

describe('RoomDO photo route', () => {
  it('serves the round bytes to anyone with the code (an <img> cannot send headers)', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(get('photo/1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    // These bytes came from a third-party image host and are served from OUR
    // origin, where the room's playerSecret lives in sessionStorage. nosniff
    // stops a browser deciding for itself that they are something executable;
    // photo.ts refuses image/svg+xml on the way in as well.
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('gives a missing photo and a missing room the SAME 404 body', async () => {
    const { room: live } = await build(seededRoom());
    const missingPhoto = await live.fetch(get('photo/7'));

    const { room: gone } = await build(null);
    const missingRoom = await gone.fetch(get('photo/1'));

    expect(missingPhoto.status).toBe(404);
    expect(missingRoom.status).toBe(404);
    // Identical on purpose: this route is unauthenticated, so a different
    // message would make it a free oracle for "is this room code live?".
    expect(await missingPhoto.json()).toEqual(await missingRoom.json());
  });
});

describe('RoomDO next', () => {
  it('treats "move on" from a finished game as success, not an error', async () => {
    // The reveal timer can end the game while the host's tap is in flight. They
    // asked for the game to move on and it had; the champion screen should not
    // apologise for that.
    const seeded = seededRoom();
    const finished: RoomState = { ...seeded, phase: 'done', championIds: ['host'] };
    const { room } = await build(finished);

    const res = await room.fetch(
      new Request('https://room/next', {
        method: 'POST',
        headers: { 'x-player-id': 'host', 'x-player-secret': SECRET },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { phase: string } };
    expect(body.state.phase).toBe('done');
  });

  it('still refuses to move on from a phase that is not reveal', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(
      new Request('https://room/next', {
        method: 'POST',
        headers: { 'x-player-id': 'host', 'x-player-secret': SECRET },
      })
    );
    expect(res.status).toBe(409);
  });
});

describe('RoomDO create', () => {
  it('builds exactly as many bots as the clamped botCount says', async () => {
    const { room, storage } = await build(null);
    const res = await room.fetch(
      new Request('https://room/create', {
        method: 'POST',
        // A nonsense botCount used to advertise "2 AI players" and create none.
        body: JSON.stringify({ code: 'ABCD', name: 'JJ', options: { botCount: 'x' } }),
      })
    );
    expect(res.status).toBe(200);

    const state = storage.map.get('state') as RoomState;
    const bots = state.players.filter((p) => p.isBot);
    expect(bots.length).toBe(state.options.botCount);
    expect(Object.keys(storage.map.get('personas') as Record<string, string>).length).toBe(
      bots.length
    );
  });

  it('clamps a huge botCount and still agrees with itself', async () => {
    const { room, storage } = await build(null);
    await room.fetch(
      new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code: 'ABCD', name: 'JJ', options: { botCount: 99 } }),
      })
    );
    const state = storage.map.get('state') as RoomState;
    expect(state.players.filter((p) => p.isBot).length).toBe(state.options.botCount);
  });

  it('refuses a code that is already a live room', async () => {
    const { room } = await build(seededRoom());
    const res = await room.fetch(
      new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code: 'ABCD', name: 'Someone else' }),
      })
    );
    expect(res.status).toBe(409);
  });
});

describe('RoomDO bot jobs', () => {
  it('fails a job left running past its deadline instead of leaking it forever', async () => {
    // A Durable Object that died mid-model-call leaves this behind.
    const seeded = seededRoom({
      botJobs: [
        {
          jobId: 'stuck',
          botId: 'b1',
          round: 1,
          phase: 'caption',
          dueAt: Date.now() - 60_000,
          deadline: Date.now() - 30_000,
          startedAt: Date.now() - 60_000,
          status: 'running',
        },
      ],
      phaseEndsAt: Date.now() + 60_000,
    });
    const { room, storage } = await build(seeded);

    await room.fetch(get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET }));

    const after = storage.map.get('state') as RoomState;
    expect(after.botJobs[0].status).toBe('failed');
  });

  it('leaves a running job inside its deadline alone', async () => {
    const seeded = seededRoom({
      botJobs: [
        {
          jobId: 'working',
          botId: 'b1',
          round: 1,
          phase: 'caption',
          dueAt: Date.now(),
          deadline: Date.now() + 20_000,
          startedAt: Date.now(),
          status: 'running',
        },
      ],
      phaseEndsAt: Date.now() + 60_000,
    });
    const { room, storage } = await build(seeded);
    await room.fetch(get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET }));
    expect((storage.map.get('state') as RoomState).botJobs[0].status).toBe('running');
  });
});

describe('RoomDO captions', () => {
  it('records a caption and never ships another player caption during the phase', async () => {
    const seeded = submitCaption(seededRoom(), 'b1', 'bot got there first', 'c-bot', T0 + 1).state;
    const { room } = await build(seeded);

    const res = await room.fetch(
      new Request('https://room/caption', {
        method: 'POST',
        headers: { 'x-player-id': 'host', 'x-player-secret': SECRET },
        body: JSON.stringify({ text: 'mine' }),
      })
    );
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).not.toContain('bot got there first');
    const state = (JSON.parse(body) as { state: { captionCount: number; captions: Array<{ text: string }> } })
      .state;
    expect(state.captionCount).toBe(2);
    expect(state.captions).toHaveLength(1);
    expect(state.captions[0].text).toBe('mine');
  });
});

// --- the photo path around a round rollover ---------------------------------
//
// Everything below drives the mocked `fetchPhoto` above: no network, but the
// real await windows, which is where all four of these bugs lived.

/** A room sitting in `reveal` at the end of round 1 of 2, past the reveal floor. */
function revealingRoom(over: Partial<RoomState> = {}): RoomState {
  const now = Date.now();
  return seededRoom({
    phase: 'reveal',
    round: 1,
    phaseStartedAt: now - 30_000, // well past REVEAL_MIN_MS, so the host may skip
    phaseEndsAt: now + 60_000, // not yet due, so only the host's tap moves it
    ...over,
  });
}

function hostPost(path: string, body: unknown = {}): Request {
  return new Request(`https://room/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-player-id': 'host',
      'x-player-secret': SECRET,
    },
    body: JSON.stringify(body),
  });
}

function resetPhotoControl(over: Partial<typeof photoControl> = {}): void {
  photoControl.fail = false;
  photoControl.calls = 0;
  photoControl.delayMs = 0;
  photoControl.during = null;
  photoControl.resolvedAt = 0;
  Object.assign(photoControl, over);
}

describe('RoomDO photo retries on the host Next path', () => {
  it('does not fetch at all while a failed fetch is still backing off', async () => {
    resetPhotoControl();
    const { room } = await build(
      revealingRoom({ photoRetry: { attempts: 1, nextAttemptAt: Date.now() + 30_000 } })
    );

    const res = await room.fetch(hostPost('next'));

    // The host gets the room as it stands, and the dead host is left alone.
    // Ten frustrated taps used to be thirty outbound image requests.
    expect(res.status).toBe(200);
    expect(photoControl.calls).toBe(0);
    const body = (await res.json()) as { state: { phase: string } };
    expect(body.state.phase).toBe('reveal');
  });

  it('records the failure, so the host path consumes attempts like the timer does', async () => {
    resetPhotoControl({ fail: true });
    const { room, storage } = await build(revealingRoom());

    const res = await room.fetch(hostPost('next'));

    expect(res.status).toBe(502);
    const after = storage.map.get('state') as RoomState;
    expect(after.photoRetry?.attempts).toBe(1);
    expect(after.photoRetry?.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('ends the game with a reason once the attempts run out', async () => {
    resetPhotoControl({ fail: true });
    const { room } = await build(
      revealingRoom({ photoRetry: { attempts: 2, nextAttemptAt: Date.now() - 1 } })
    );

    const res = await room.fetch(hostPost('next'));

    // Third failure: the room stops honestly rather than letting the host tap
    // for ever, and the host sees the scoreboard everyone earned.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: { phase: string; endedReason?: string; championIds?: string[] };
    };
    expect(body.state.phase).toBe('done');
    expect(body.state.endedReason).toBe('photo-unavailable');
    expect(Array.isArray(body.state.championIds)).toBe(true);
  });

  it('measures the retry backoff from AFTER the download, not before it', async () => {
    // A failing fetch that takes longer than the first 5s backoff used to set
    // nextAttemptAt in the past, so the alarm re-fired instantly: a hot loop on
    // a dead host. The clock has to be read after the await.
    resetPhotoControl({ fail: true, delayMs: 80 });
    const { room, storage } = await build(revealingRoom());
    const before = Date.now();

    await room.fetch(hostPost('next'));

    const after = storage.map.get('state') as RoomState;
    // 5s is the first backoff step, and it is measured from the instant the
    // download finished, which the mock stamps. Comparing against
    // `before + delay` instead would be asserting that setTimeout(80) delivers
    // 80ms of Date.now(), which it does not (see photoControl.resolvedAt).
    expect(photoControl.resolvedAt).toBeGreaterThan(before);
    expect(after.photoRetry?.nextAttemptAt).toBeGreaterThanOrEqual(
      photoControl.resolvedAt + 5_000
    );
  });
});

describe('RoomDO round rollover under concurrency', () => {
  it('does not lose a player who joins while the photo is downloading (Next)', async () => {
    const { room } = await build(revealingRoom());
    resetPhotoControl({
      during: () =>
        room.fetch(
          new Request('https://room/join', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Late' }),
          })
        ),
    });

    const res = await room.fetch(hostPost('next'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: { phase: string; round: number; players: Array<{ name: string }> };
    };
    // Computing the transition from the pre-await copy would have erased Late
    // from `players` while their secret survived in `secrets`: they would
    // authenticate fine and then be told they are not in the room.
    expect(body.state.players.map((p) => p.name)).toContain('Late');
    expect(body.state.round).toBe(2);
    expect(body.state.phase).toBe('caption');
  });

  it('opens the new round on the clock AFTER the download, so the timer is full length', async () => {
    resetPhotoControl({ delayMs: 80 });
    const seeded = revealingRoom({ phaseEndsAt: Date.now() - 1 });
    const { room, storage } = await build(seeded);
    const before = Date.now();

    await room.alarm();

    const after = storage.map.get('state') as RoomState;
    expect(after.phase).toBe('caption');
    // Using the pre-fetch clock handed players a caption timer already short by
    // however long the photo took. The bar is the instant the download actually
    // finished, not `before + 80`: that arithmetic assumes setTimeout(80) gives
    // 80ms of Date.now(), and it is the assumption that made this line flaky
    // (see photoControl.resolvedAt).
    expect(photoControl.resolvedAt).toBeGreaterThan(before);
    expect(after.phaseStartedAt).toBeGreaterThanOrEqual(photoControl.resolvedAt);
    expect(after.phaseEndsAt).toBe(after.phaseStartedAt + after.options.captionSeconds * 1000);
  });
});

describe('RoomDO start under concurrency', () => {
  it('still starts when a friend joins during the photo fetch', async () => {
    const lobby = createRoom(
      'ABCD',
      { id: 'host', name: 'JJ' },
      normalizeOptions({ rounds: 2, botCount: 0 }),
      [],
      Date.now()
    );
    const { room } = await build(lobby);
    resetPhotoControl({
      during: () =>
        room.fetch(
          new Request('https://room/join', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Late' }),
          })
        ),
    });

    const res = await room.fetch(hostPost('start'));

    // The old version-exact check turned "a friend joined" into "this game
    // already started", on the host's very first tap, with no way out.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: { phase: string; players: Array<{ name: string }>; roundPlayerIds: string[] };
    };
    expect(body.state.phase).toBe('caption');
    expect(body.state.players.map((p) => p.name)).toContain('Late');
    expect(body.state.roundPlayerIds).toHaveLength(2);
  });

  it('still refuses a second start', async () => {
    resetPhotoControl();
    const { room } = await build(seededRoom()); // already in `caption`
    const res = await room.fetch(hostPost('start'));
    expect(res.status).toBe(409);
  });
});

describe('RoomDO photo retries on the host Start path', () => {
  /** A lobby with no bots, so `start` is the only thing that can move it. */
  function lobbyRoom(over: Partial<RoomState> = {}): RoomState {
    const lobby = createRoom(
      'ABCD',
      { id: 'host', name: 'JJ' },
      normalizeOptions({ rounds: 2, botCount: 0 }),
      [],
      Date.now()
    );
    return { ...lobby, ...over };
  }

  it('does not fetch at all while a failed fetch is still backing off', async () => {
    resetPhotoControl();
    const { room } = await build(
      lobbyRoom({ photoRetry: { attempts: 1, nextAttemptAt: Date.now() + 30_000 } })
    );

    const res = await room.fetch(hostPost('start'));

    // Same shape as the Next path: the host gets the room as it stands and the
    // dead image host is left alone. Ten frustrated taps used to be thirty
    // outbound requests that consumed no attempt at all.
    expect(res.status).toBe(200);
    expect(photoControl.calls).toBe(0);
    expect(((await res.json()) as { state: { phase: string } }).state.phase).toBe('lobby');
  });

  it('records the failure, so Start consumes attempts like every other rollover', async () => {
    resetPhotoControl({ fail: true });
    const { room, storage } = await build(lobbyRoom());

    const res = await room.fetch(hostPost('start'));

    expect(res.status).toBe(502);
    const after = storage.map.get('state') as RoomState;
    expect(after.photoRetry?.attempts).toBe(1);
    expect(after.photoRetry?.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('drops a SPENT backoff instead of counting it, and stays in the lobby', async () => {
    // Review round 5. Nothing in the lobby consumes a photoRetry: advanceIfDue
    // does nothing on a lobby state, so the row sat there for the room's whole
    // TTL and nextAlarmAt returned `now` for ever, re-firing the Durable Object's
    // alarm as fast as Cloudflare would deliver it. settle() now clears a spent
    // one, and the DOCUMENTED CONSEQUENCE is asserted here rather than left to be
    // discovered: the lobby's attempt tally restarts, so a room that has not
    // started is never sent to `done` by an image host having a bad minute. The
    // outbound rate is still bounded by the backoff, and the hard attempt cap
    // still applies on the automatic rollovers (the Next path above), which are
    // the ones that spin without anybody asking.
    resetPhotoControl({ fail: true });
    const { room, storage } = await build(
      lobbyRoom({ photoRetry: { attempts: 2, nextAttemptAt: Date.now() - 1 } })
    );

    const res = await room.fetch(hostPost('start'));

    expect(res.status).toBe(502);
    const after = storage.map.get('state') as RoomState;
    expect(after.phase).toBe('lobby');
    expect(after.endedReason).toBeUndefined();
    expect(after.photoRetry?.attempts).toBe(1);
  });

  it('tells a POLLING client about the backoff, by bumping version', async () => {
    // Round 5 must-fix: handleState answers `unchanged` while the version is
    // equal, so without the bump the countdown in the public view could only
    // ever reach a client that tapped a button.
    resetPhotoControl({ fail: true });
    const { room, storage } = await build(lobbyRoom());
    const before = (storage.map.get('state') as RoomState).version;

    await room.fetch(hostPost('start'));

    const after = storage.map.get('state') as RoomState;
    expect(after.version).toBe(before + 1);
    expect(after.photoRetry?.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('measures the retry backoff from AFTER the download, not before it', async () => {
    resetPhotoControl({ fail: true, delayMs: 80 });
    const { room, storage } = await build(lobbyRoom());
    const before = Date.now();

    await room.fetch(hostPost('start'));

    const after = storage.map.get('state') as RoomState;
    expect(photoControl.resolvedAt).toBeGreaterThan(before);
    expect(after.photoRetry?.nextAttemptAt).toBeGreaterThanOrEqual(
      photoControl.resolvedAt + 5_000
    );
  });
});

describe('RoomDO orphan photo bytes', () => {
  // Bytes are committed BEFORE the reducer runs (a join landing in that window
  // must not be erased), so a bail-out on the final re-check can in principle
  // leave `photo:<round>` for a round the room never opened. The cleanup is
  // deliberately conservative: it only removes bytes for a round AHEAD of the
  // live one that the live state does not name. That "only" is what this test
  // pins down, because the failure mode worth guarding is deleting a photo
  // players are still looking at, not leaving a stray key behind. The bail-out
  // branch itself is not reachable through this harness (every interleaving that
  // moves the room past the stamp also commits the same bytes and opens that
  // round), so it stays proven by reading, not by running.
  it('keeps the bytes when the rollover actually happened', async () => {
    resetPhotoControl();
    const { room, storage } = await build(revealingRoom());

    const res = await room.fetch(hostPost('next'));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { state: { round: number } }).state.round).toBe(2);
    expect(storage.map.has('photo:2')).toBe(true);
  });

  it('keeps the bytes of the round a joiner is still looking at', async () => {
    // The same rollover, with a player joining inside the download window: the
    // room ends up in round 2 naming photo:2, and round 1's bytes are still on
    // disk for anyone whose <img> has not loaded yet.
    const { room, storage } = await build(revealingRoom());
    resetPhotoControl({
      during: () =>
        room.fetch(
          new Request('https://room/join', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Late' }),
          })
        ),
    });

    await room.fetch(hostPost('next'));

    expect(storage.map.has('photo:1')).toBe(true);
    expect(storage.map.has('photo:2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE WALL, end to end through the Durable Object (review round 7, must-fix 1).
//
// The reducer tests in room.test.ts prove what noteAiOffline DOES. This proves
// the DO actually calls it: a real bot job, a real AI binding that answers the
// live 4006 string, and the state that lands in storage afterwards.
// ---------------------------------------------------------------------------

/** An AI binding that is out of allocation, exactly the way the live one is. */
function quotaAi(): Env {
  return {
    AI: {
      run: async () => {
        throw new Error(
          "4006: you have used up your daily free allocation of 10,000 neurons, please " +
            "upgrade to Cloudflare's Workers Paid plan if you would like to continue usage."
        );
      },
    },
  } as unknown as Env;
}

/** An AI binding that is merely having a bad minute. */
function flakyAi(): Env {
  return {
    AI: {
      run: async () => {
        throw new Error('The operation was aborted due to timeout');
      },
    },
  } as unknown as Env;
}

async function buildWith(room: RoomState, env: Env): Promise<{ room: RoomDO; storage: FakeStorage }> {
  const storage = new FakeStorage();
  storage.map.set('state', room);
  storage.map.set('secrets', { host: SECRET, b1: 'bot-secret', b2: 'bot-secret-2' });
  storage.map.set('personas', { b1: 'daisy-deadpan', b2: 'chaos-chip' });
  storage.map.set('photo:1', { bytes: new ArrayBuffer(4), contentType: 'image/jpeg' });
  const ctx = new FakeState(storage);
  const doRoom = new RoomDO(ctx as unknown as DurableObjectState, env);
  await ctx.loaded();
  return { room: doRoom, storage };
}

/** A room with two bot caption jobs due right now. */
function roomWithDueBotJobs(over: Partial<RoomState> = {}): RoomState {
  const now = Date.now();
  return seededRoom({
    phaseEndsAt: now + 60_000,
    botJobs: [
      { jobId: 'j1', botId: 'b1', round: 1, phase: 'caption', dueAt: now - 1, deadline: now + 20_000, status: 'pending' },
      { jobId: 'j2', botId: 'b2', round: 1, phase: 'caption', dueAt: now - 1, deadline: now + 20_000, status: 'pending' },
    ],
    ...over,
  });
}

describe('RoomDO when Workers AI is out of its daily allocation', () => {
  it('ends a solo host’s game once, instead of voiding every round in turn', async () => {
    // The exact live shape: one human, two bots, and no model on the other end.
    // Round 6's build played this out as N void rounds and then crowned the two
    // silent bots joint champions on 0 points.
    const { room, storage } = await buildWith(roomWithDueBotJobs(), quotaAi());
    await room.alarm();

    const after = storage.map.get('state') as RoomState;
    expect(after.aiOffline).toBe(true);
    expect(after.phase).toBe('done');
    expect(after.endedReason).toBe('ai-unavailable');
    expect(after.championIds).toEqual([]);
    // The bots keep their scoreboard rows, and their jobs say why they stopped.
    expect(after.players.map((p) => p.id)).toEqual(['host', 'b1', 'b2']);
    expect(after.botJobs.every((j) => j.status === 'failed')).toBe(true);
    expect(after.botJobs.every((j) => j.failReason === 'ai-offline')).toBe(true);
  });

  it('keeps a two-human game running, with the bots off the next roster', async () => {
    const withFriend = roomWithDueBotJobs();
    const seeded: RoomState = {
      ...withFriend,
      players: [...withFriend.players, { id: 'p2', name: 'Friend', isBot: false, score: 0, lastSeenAt: T0 }],
      roundPlayerIds: [...withFriend.roundPlayerIds, 'p2'],
    };
    const { room, storage } = await buildWith(seeded, quotaAi());
    await room.alarm();

    const after = storage.map.get('state') as RoomState;
    expect(after.aiOffline).toBe(true);
    expect(after.phase).toBe('caption'); // the two humans are still writing
    expect(after.endedReason).toBeUndefined();
  });

  it('does NOT flag the room on an ordinary timeout', async () => {
    // The whole point of the classifier: a bad minute must not cost the game its
    // AI players for the rest of the day.
    const { room, storage } = await buildWith(roomWithDueBotJobs(), flakyAi());
    await room.alarm();

    const after = storage.map.get('state') as RoomState;
    expect(after.aiOffline).toBeUndefined();
    expect(after.phase).toBe('caption');
    expect(after.botJobs.every((j) => j.status === 'failed')).toBe(true);
    expect(after.botJobs.every((j) => j.failReason === undefined)).toBe(true);
  });

  it('tells the player, in one plain sentence, through the state a screen reads', async () => {
    const { room } = await buildWith(roomWithDueBotJobs(), quotaAi());
    await room.alarm();
    const res = await room.fetch(get('state', { 'x-player-id': 'host', 'x-player-secret': SECRET }));
    const body = (await res.json()) as { state: { aiOffline?: boolean; endedReason?: string } };
    expect(body.state.aiOffline).toBe(true);
    expect(body.state.endedReason).toBe('ai-unavailable');
  });
});

// ---------------------------------------------------------------------------
// BOT_VOTE_TEMPERATURE, from the wrangler var all the way onto the wire.
//
// The var is the knob that stopped the AI players voting only for each other
// (2026-09-08). A knob that parses correctly but never reaches the model is the
// same bug as the literal it replaced, and nothing else in the suite crosses the
// four boundaries between them: wrangler var -> settings() -> botModels() ->
// generateBotVote's request body. Codex review round 1, must-fix 1.
// ---------------------------------------------------------------------------

/** A room in the vote phase with one bot vote job due right now. */
function roomWithDueVoteJob(): RoomState {
  const now = Date.now();
  let room = seededRoom({ phaseEndsAt: now + 60_000 });
  room = submitCaption(room, 'host', 'human caption', 'c-host', Date.now()).state;
  room = submitCaption(room, 'b1', 'daisy caption', 'c-b1', Date.now()).state;
  room = submitCaption(room, 'b2', 'chip caption', 'c-b2', Date.now()).state;
  return {
    ...room,
    phase: 'vote',
    phaseEndsAt: now + 60_000,
    botJobs: [
      { jobId: 'v1', botId: 'b1', round: 1, phase: 'vote', dueAt: now - 1, deadline: now + 20_000, status: 'pending' },
    ],
  };
}

describe('BOT_VOTE_TEMPERATURE reaches the model', () => {
  /** An AI binding that records what it was asked, and votes for the human. */
  function recordingAi(over: Record<string, string> = {}): { env: Env; seen: Record<string, unknown>[] } {
    const seen: Record<string, unknown>[] = [];
    const env = {
      AI: {
        run: async (_model: string, input: unknown) => {
          seen.push(input as Record<string, unknown>);
          return { response: { captionId: 'c-host' } };
        },
      },
      ...over,
    } as unknown as Env;
    return { env, seen };
  }

  it('sends the temperature the wrangler var asks for', async () => {
    // Deliberately not 0.9: a passing test must mean the VAR was read, not that
    // the code default happened to match.
    const { env, seen } = recordingAi({ BOT_VOTE_TEMPERATURE: '0.35' });
    const { room } = await buildWith(roomWithDueVoteJob(), env);
    await room.alarm();

    expect(seen).toHaveLength(1);
    expect(seen[0].temperature).toBe(0.35);
  });

  it('sends the measured default when the var is unset or nonsense', async () => {
    for (const over of [{}, { BOT_VOTE_TEMPERATURE: 'warm' }, { BOT_VOTE_TEMPERATURE: '9' }]) {
      const { env, seen } = recordingAi(over as Record<string, string>);
      const { room } = await buildWith(roomWithDueVoteJob(), env);
      await room.alarm();
      expect(seen).toHaveLength(1);
      expect(seen[0].temperature).toBe(BOT_VOTE_TEMPERATURE);
    }
  });
});
