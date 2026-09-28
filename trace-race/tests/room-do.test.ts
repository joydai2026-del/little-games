import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildRoom, buildWorker } from './harness';
import { GAME } from '../src/shared/config';

afterEach(() => vi.useRealTimers());

function post(path: string, body: unknown, auth?: { playerId: string; playerSecret: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    headers['x-player-id'] = auth.playerId;
    headers['x-player-secret'] = auth.playerSecret;
  }
  return new Request(`https://room/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('RoomDO', () => {
  it('create splits the list into traceable and no-stroke-data characters', async () => {
    const { room, storage } = await buildRoom();
    const res = await room.fetch(post('create', { code: 'ABCD', name: 'Ms. Li', text: '1. 人 rén\n2. 𠮷 (no data)\n3. 口 kǒu' }));
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.state.list.chars).toEqual(['人', '口']);
    expect(data.state.list.missing).toEqual(['𠮷']);
    expect(data.state.list.strokeCounts).toEqual({ 人: 2, 口: 3 });
    expect(JSON.stringify(data.state)).not.toContain(data.playerSecret);
    expect(storage.alarms.at(-1)).toBe(data.state.expiresAt);
    // A second create on a live code is refused so the Worker draws another.
    expect((await room.fetch(post('create', { code: 'ABCD', text: '' }))).status).toBe(409);
  });

  it('rejects callers without the right secret', async () => {
    const { room } = await buildRoom();
    const host = (await (await room.fetch(post('create', { code: 'ABCD', text: '人' }))).json()) as any;
    const bad = await room.fetch(post('start', {}, { playerId: host.playerId, playerSecret: 'nope' }));
    expect(bad.status).toBe(403);
  });

  it('runs a race: start, strokes, alarm at race end, done', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { room, storage } = await buildRoom();
    const host = (await (await room.fetch(post('create', { code: 'ABCD', text: '人口', options: { secondsPerChar: 10 } }))).json()) as any;
    const kid = (await (await room.fetch(post('join', { name: 'Mia' }))).json()) as any;
    const hostAuth = { playerId: host.playerId, playerSecret: host.playerSecret };
    const kidAuth = { playerId: kid.playerId, playerSecret: kid.playerSecret };

    const started = (await (await room.fetch(post('start', {}, hostAuth))).json()) as any;
    expect(started.state.phase).toBe('racing');
    expect(storage.alarms.at(-1)).toBe(started.state.endsAt);

    const early = await room.fetch(post('stroke', { charIndex: 0, strokeIndex: 0, result: 'correct' }, kidAuth));
    expect(early.status).toBe(409);

    vi.setSystemTime(Date.now() + GAME.countdownSeconds * 1000);
    const ok = (await (await room.fetch(post('stroke', { charIndex: 0, strokeIndex: 0, result: 'correct' }, kidAuth))).json()) as any;
    expect(ok.state.progress[kid.playerId].strokeIndex).toBe(1);
    const bad = await room.fetch(post('stroke', { charIndex: 0, strokeIndex: 0, result: 'yes' }, kidAuth));
    expect(bad.status).toBe(400);

    // Unchanged poll is cheap.
    const v = ok.state.version;
    const poll = (await (await room.fetch(new Request(`https://room/state?v=${v}`, { headers: { 'x-player-id': kid.playerId, 'x-player-secret': kid.playerSecret } }))).json()) as any;
    expect(poll.unchanged).toBe(true);

    // The alarm ends the race when time is up, with nobody polling.
    vi.setSystemTime(started.state.endsAt + 1);
    await room.alarm();
    const saved = (await storage.get('state')) as any;
    expect(saved.phase).toBe('done');
    expect(storage.alarms.at(-1)).toBe(saved.expiresAt);
  });

  it('an expired room is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { room, storage } = await buildRoom();
    await room.fetch(post('create', { code: 'ABCD', text: '人' }));
    vi.setSystemTime(Date.now() + GAME.roomTtlMinutes * 60_000 + 1);
    await room.alarm();
    expect(storage.map.size).toBe(0);
    expect((await room.fetch(post('join', { name: 'Leo' }))).status).toBe(404);
  });
});

describe('Worker routes', () => {
  it('create, join, bad codes, unknown actions', async () => {
    const w = buildWorker();
    const created = await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'T', text: '大' }) });
    const data = (await created.json()) as any;
    expect(data.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    const joined = await w.fetch(`/api/rooms/${data.code.toLowerCase()}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) });
    expect(joined.status).toBe(200);
    expect((await w.fetch('/api/rooms/OOOO')).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/explode`, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await w.fetch('/api/rooms', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await w.fetch('/')).status).toBe(200);
  });
});
