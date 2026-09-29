import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundEnv, buildRoom, buildWorker, fakeLimiter, strokeFetch } from './harness';
import { GAME } from '../src/shared/config';
import type { Env } from '../src/worker/env';
import { asPairs, backwards, right } from './geom';

beforeEach(() => vi.stubGlobal('fetch', strokeFetch()));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const WAV = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
const ai = (said: string[] = []) => ({ run: async (_m: string, o: Record<string, unknown>) => (said.push(String(o.prompt)), { audio: btoa(String.fromCharCode(...WAV)) }) });

function post(path: string, body: unknown, auth?: { playerId: string; playerSecret: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) Object.assign(headers, { 'x-player-id': auth.playerId, 'x-player-secret': auth.playerSecret });
  return new Request(`https://room/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
function get(path: string, auth: { playerId: string; playerSecret: string }): Request {
  return new Request(`https://room/${path}`, { headers: { 'x-player-id': auth.playerId, 'x-player-secret': auth.playerSecret } });
}
const seat = (d: any) => ({ playerId: d.playerId, playerSecret: d.playerSecret });

describe('RoomDO', () => {
  it('create splits the paste into writable words and reported ones; the secret never leaks', async () => {
    const { room, storage } = await buildRoom(boundEnv() as Env);
    const res = await room.fetch(post('create', { code: 'ABCD', text: '第三课\n1. 朋友 péngyou\n2. 𠮷祥 (no data)\n3. 中华人民共和国\n4. 大', options: { level: 'hard' } }));
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.state.list).toMatchObject({ words: ['朋友', '大'], missing: ['𠮷祥'], tooLong: ['中华人民共和国'], skipped: ['第三课'], count: 2 });
    expect(data.state.list.strokeCounts).toBeUndefined();
    expect(JSON.stringify(data.state)).not.toContain(data.playerSecret);
    expect(storage.alarms.at(-1)).toBe(data.state.expiresAt);
  });

  it('a whole round through the room: audio first, graded points, the word clock, the alarm', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const said: string[] = [];
    const { room, storage } = await buildRoom(boundEnv({ AI: ai(said) }) as Env);
    const host = seat(await (await room.fetch(post('create', { code: 'ABCD', text: '人口 大 上下', options: { wordsPerRound: 2, secondsPerWord: 20, level: 'hard' } }))).json());
    const kidData = (await (await room.fetch(post('join', { name: 'Mia' }))).json()) as any;
    const kid = seat(kidData);
    // The kid's lobby payload has no words.
    expect(JSON.stringify(kidData.state)).not.toMatch(/人|口|大|上|下/);
    expect((await room.fetch(get('say?r=0&w=0', kid))).status).toBe(403); // no round yet
    const started = (await (await room.fetch(post('start', {}, host))).json()) as any;
    expect(started.state.roundWords).toEqual(['人口', '大']); // the teacher
    const late = seat(await (await room.fetch(post('join', { name: 'Late' }))).json());
    vi.setSystemTime(started.state.goAt + 100);
    const m = (points: { x: number; y: number }[], seq: number) => post('stroke', { race: 1, seq, wordIndex: 0, charIndex: 0, points: asPairs(points) }, kid);
    expect((await room.fetch(m(right('人', 0), 1))).status).toBe(409); // not heard yet
    expect((await room.fetch(get('say?w=0', kid))).status).toBe(400); // r is required
    expect((await room.fetch(get('say?r=1&w=1', kid))).status).toBe(409); // not reached
    expect((await room.fetch(get('say?r=1&w=0', host))).status).toBe(403); // the board never speaks
    expect((await room.fetch(get('say?r=1&w=0', late))).status).toBe(403); // next round
    const clip = await room.fetch(get('say?r=1&w=0', kid));
    expect(clip.status).toBe(200);
    expect(said).toEqual(['人口']);
    const view = (await (await room.fetch(get('state', kid))).json()) as any;
    expect(view.state.me).toMatchObject({ heard: true, charCount: 2, outline: null });
    const deadline = view.state.me.deadlineAt;
    expect(deadline).toBeGreaterThan(started.state.goAt + 100);
    expect(JSON.stringify(view.state)).not.toMatch(/人|口|大/);
    vi.setSystemTime(started.state.goAt + 1000);
    const wrong = (await (await room.fetch(m(backwards('人', 0), 1))).json()) as any;
    expect(wrong.verdict).toBe('mistake');
    vi.setSystemTime(started.state.goAt + 1000 + GAME.minStrokeGapMs);
    const ok = (await (await room.fetch(m(right('人', 0), 2))).json()) as any;
    expect(ok.verdict).toBe('correct');
    expect(ok.state.me.accepted[0]).toHaveLength(1);
    const again = (await (await room.fetch(m(backwards('人', 0), 2))).json()) as any; // another tab, same seq
    expect(again.duplicate).toBe(true);
    expect(again.state.version).toBe(ok.state.version);
    expect((await room.fetch(post('stroke', { race: 1, seq: 3, wordIndex: 0, charIndex: 0, strokeIndex: 1, result: 'correct' }, kid))).status).toBe(400);
    // Past the word's deadline the room closes it as skipped.
    vi.setSystemTime(deadline);
    const after = (await (await room.fetch(get('state', kid))).json()) as any;
    expect(after.state.me).toMatchObject({ wordIndex: 1, wordsSkipped: 1, closed: [{ word: '人口', result: 'skipped' }] }); // Mia is the only writer: closed for all
    vi.setSystemTime(started.state.endsAt + 1);
    await room.alarm();
    expect(((await storage.get('state')) as any).phase).toBe('done');
  });

  it('joins: a class of 30 behind ONE school IP all get in within a minute; the 41st join, from any mix, gets 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    expect(GAME.joinsPerIpPerMinute).toBeGreaterThanOrEqual(GAME.maxKids);
    const { room } = await buildRoom(boundEnv() as Env);
    await room.fetch(post('create', { code: 'ABCD', text: '大' }));
    const joinFrom = (ip: string, name: string) =>
      room.fetch(new Request('https://room/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-ip': ip }, body: JSON.stringify({ name }) }));
    for (let i = 0; i < 30; i++) expect((await joinFrom('203.0.113.7', `Kid ${i}`)).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await joinFrom(i % 2 ? '203.0.113.7' : `198.51.100.${i}`, `More ${i}`)).status).toBe(200);
    const flood = await joinFrom('192.0.2.1', 'Number 41');
    expect(flood.status).toBe(429);
    expect(((await flood.json()) as any).error).toMatch(/too many/);
    expect((await joinFrom('203.0.113.7', 'Number 41 again')).status).toBe(429);
    // A minute later the answer is the honest one: the room is full.
    vi.setSystemTime(Date.now() + 61_000);
    expect((await joinFrom('203.0.113.7', 'Later')).status).toBe(409);
  });

  it('the per-IP join count survives a restart (durable), and old addresses are pruned', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const env = boundEnv({ JOINS_PER_IP_PER_MINUTE: '2' }) as Env;
    const first = await buildRoom(env);
    await first.room.fetch(post('create', { code: 'ABCD', text: '大' }));
    const joinFrom = (room: typeof first.room, ip: string, name: string) =>
      room.fetch(new Request('https://room/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-ip': ip }, body: JSON.stringify({ name }) }));
    expect((await joinFrom(first.room, '203.0.113.7', 'A')).status).toBe(200);
    expect((await joinFrom(first.room, '203.0.113.7', 'B')).status).toBe(200);
    // The Durable Object restarts over the same storage.
    const second = await buildRoom(env, first.storage);
    expect((await joinFrom(second.room, '203.0.113.7', 'C')).status).toBe(429);
    expect((await joinFrom(second.room, '198.51.100.1', 'D')).status).toBe(200);
    // The address is stored only as a hash, and a minute later the old entries are gone.
    expect(JSON.stringify(first.storage.map.get('joinsByIp'))).not.toContain('203.0.113.7');
    vi.setSystemTime(Date.now() + 61_000);
    expect((await joinFrom(second.room, '192.0.2.9', 'E')).status).toBe(200);
    expect(Object.keys(first.storage.map.get('joinsByIp') as object)).toHaveLength(1);
  });

  it('an expired room is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { room, storage } = await buildRoom(boundEnv() as Env);
    await room.fetch(post('create', { code: 'ABCD', text: '人' }));
    vi.setSystemTime(Date.now() + GAME.roomTtlMinutes * 60_000 + 1);
    await room.alarm();
    expect(storage.map.size).toBe(0);
  });
});

describe('Worker routes', () => {
  it('create, join, solo, bad codes, unknown actions', async () => {
    const w = buildWorker();
    const data = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'T', text: '大' }) })).json()) as any;
    expect(data.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect((await w.fetch(`/api/rooms/${data.code.toLowerCase()}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) })).status).toBe(200);
    const solo = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '大', mode: 'solo' }) })).json()) as any;
    expect(solo.state).toMatchObject({ mode: 'solo', role: 'kid' });
    expect(solo.state.list.words).toEqual([]);
    expect((await w.fetch(`/api/rooms/${solo.code}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) })).status).toBe(409);
    expect((await w.fetch('/api/rooms/OOOO')).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/explode`, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/say?w=0`)).status).toBe(400); // r required
    expect((await w.fetch('/api/rooms', { method: 'POST', body: 'not json' })).status).toBe(400);
  });

  it('room creation fails CLOSED with no limiter, or a limiter that throws', async () => {
    const none = buildWorker({ ROOM_CREATE_LIMITER: undefined });
    expect((await none.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '大' }) })).status).toBe(503);
    const boom = buildWorker({ ROOM_CREATE_LIMITER: { limit: async () => Promise.reject(new Error('down')) } as never });
    expect((await boom.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '大' }) })).status).toBe(503);
    const full = buildWorker({ ROOM_CREATE_LIMITER: fakeLimiter(false) });
    expect((await full.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '大' }) })).status).toBe(429);
  });

  it('a malformed code is a 400; oversized bodies and pastes get a plain message', async () => {
    const w = buildWorker();
    expect((await w.fetch('/api/rooms/%E0')).status).toBe(400);
    const big = await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '人'.repeat(GAME.maxBodyBytes) }) });
    expect(big.status).toBe(413);
    const long = await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: 'a'.repeat(GAME.maxPasteLength + 1) }) });
    expect(long.status).toBe(400);
  });
});
