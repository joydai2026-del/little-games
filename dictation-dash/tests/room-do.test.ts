import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRoom, buildWorker } from './harness';
import { GAME } from '../src/shared/config';

afterEach(() => vi.useRealTimers());

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
    const { room, storage } = await buildRoom();
    const res = await room.fetch(post('create', { code: 'ABCD', text: '1. 朋友 péngyou\n2. 𠮷祥 (no data)\n3. 中华人民共和国\n4. 大', options: { level: 'hard' } }));
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.state.list.words).toEqual(['朋友', '大']);
    expect(data.state.list.missing).toEqual(['𠮷祥']);
    expect(data.state.list.tooLong).toEqual(['中华人民共和国']);
    expect(data.state.list.strokeCounts).toEqual({ 朋: 8, 友: 4, 大: 3 });
    expect(data.state.options.level).toBe('hard');
    expect(data.state.mode).toBe('class');
    expect(JSON.stringify(data.state)).not.toContain(data.playerSecret);
    expect(storage.alarms.at(-1)).toBe(data.state.expiresAt);
    expect((await room.fetch(post('create', { code: 'ABCD', text: '' }))).status).toBe(409);
  });

  it('say: only players of the running round, only words they have reached', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const said: string[] = [];
    const WAV = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
    const env = { AI: { run: async (_m: string, o: Record<string, unknown>) => (said.push(String(o.prompt)), { audio: btoa(String.fromCharCode(...WAV)) }) } } as never;
    const { room } = await buildRoom(env);
    const host = seat(await (await room.fetch(post('create', { code: 'ABCD', text: '人口 大 上下', options: { wordsPerRound: 2 } }))).json());
    const kid = seat(await (await room.fetch(post('join', { name: 'Mia' }))).json());
    expect((await room.fetch(get('say?w=0', kid))).status).toBe(403); // lobby: no round yet
    const started = (await (await room.fetch(post('start', {}, host))).json()) as any;
    const late = seat(await (await room.fetch(post('join', { name: 'Late' }))).json());
    const ok = await room.fetch(get('say?w=0', kid));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('audio/wav');
    expect(said).toEqual(['人口']);
    expect((await room.fetch(get('say?w=1', kid))).status).toBe(409); // not reached yet
    expect((await room.fetch(get('say?w=0', host))).status).toBe(403); // the teacher does not play
    expect((await room.fetch(get('say?w=0', late))).status).toBe(403); // late joiner: next round
    expect((await room.fetch(get('say?w=9', kid))).status).toBe(404);
    vi.setSystemTime(started.state.goAt + 1000);
    await room.fetch(post('skip', { race: 1, seq: 1, wordIndex: 0 }, kid));
    expect((await room.fetch(get('say?w=1', kid))).status).toBe(200);
    expect(said).toEqual(['人口', '大']);
    expect((await room.fetch(get('say?w=0', { ...kid, playerSecret: 'nope' }))).status).toBe(403);
  });

  it('runs a round: start, strokes, a skip, alarm at the round end, done', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { room, storage } = await buildRoom();
    const host = seat(await (await room.fetch(post('create', { code: 'ABCD', text: '人 口', options: { secondsPerWord: 15 } }))).json());
    const kid = (await (await room.fetch(post('join', { name: 'Mia' }))).json()) as any;
    const started = (await (await room.fetch(post('start', {}, host))).json()) as any;
    expect(started.state.phase).toBe('racing');
    expect(storage.alarms.at(-1)).toBe(started.state.endsAt);
    const m = { race: 1, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' };
    expect((await room.fetch(post('stroke', m, seat(kid)))).status).toBe(409); // before GO
    vi.setSystemTime(started.state.goAt + 1000);
    const ok = (await (await room.fetch(post('stroke', m, seat(kid)))).json()) as any;
    expect(ok.state.progress[kid.playerId].strokeIndex).toBe(1);
    const retry = (await (await room.fetch(post('stroke', m, seat(kid)))).json()) as any;
    expect(retry.state.version).toBe(ok.state.version);
    expect((await room.fetch(post('stroke', { ...m, seq: 2, result: 'yes' }, seat(kid)))).status).toBe(400);
    expect((await room.fetch(post('skip', { race: 1 }, seat(kid)))).status).toBe(400);
    const v = ok.state.version;
    const poll = (await (await room.fetch(get(`state?v=${v}`, seat(kid)))).json()) as any;
    expect(poll.unchanged).toBe(true);
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
  it('create, join, solo, bad codes, unknown actions', async () => {
    const w = buildWorker();
    const created = await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'T', text: '大' }) });
    const data = (await created.json()) as any;
    expect(data.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect((await w.fetch(`/api/rooms/${data.code.toLowerCase()}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) })).status).toBe(200);
    const solo = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '大', mode: 'solo' }) })).json()) as any;
    expect(solo.state.mode).toBe('solo');
    expect(solo.state.role).toBe('kid');
    expect((await w.fetch(`/api/rooms/${solo.code}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) })).status).toBe(409);
    expect((await w.fetch('/api/rooms/OOOO')).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/explode`, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/say?w=abc`)).status).toBe(400);
    expect((await w.fetch(`/api/rooms/${data.code}/say?w=0`, { method: 'POST', body: '{}' })).status).toBe(405);
    expect((await w.fetch('/api/rooms', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await w.fetch('/')).status).toBe(200);
  });

  it('a malformed code is a 400; oversized bodies and pastes get a plain message', async () => {
    const w = buildWorker();
    expect((await w.fetch('/api/rooms/%E0')).status).toBe(400);
    const big = await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '人'.repeat(GAME.maxBodyBytes) }) });
    expect(big.status).toBe(413);
    expect(((await big.json()) as any).error).toMatch(/shorter list/);
    const long = await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: 'a'.repeat(GAME.maxPasteLength + 1) }) });
    expect(long.status).toBe(400);
    expect(((await long.json()) as any).error).toMatch(/too long/);
  });
});
