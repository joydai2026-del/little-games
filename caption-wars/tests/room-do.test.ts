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

import { describe, it, expect } from 'vitest';
import { RoomDO } from '../src/worker/room-do';
import { createRoom, start, submitCaption } from '../src/shared/room';
import { normalizeOptions } from '../src/shared/config';
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
