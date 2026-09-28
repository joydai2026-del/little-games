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

  it('runs a race: start, answers, alarm closes the character, reveal, next, done', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { room, storage } = await buildRoom();
    const host = (await (await room.fetch(post('create', { code: 'ABCD', text: '人口', options: { level: 'big', charsPerRound: 2 } }))).json()) as any;
    const kid = (await (await room.fetch(post('join', { name: 'Mia' }))).json()) as any;
    const hostAuth = { playerId: host.playerId, playerSecret: host.playerSecret };
    const kidAuth = { playerId: kid.playerId, playerSecret: kid.playerSecret };

    const started = (await (await room.fetch(post('start', {}, hostAuth))).json()) as any;
    const s0 = started.state;
    expect(s0.phase).toBe('racing');
    expect(s0.turn).toMatchObject({ index: 0, char: '人', closedAt: null });
    expect(s0.turn.hidden).toBeGreaterThanOrEqual(0);
    expect(s0.turn.hidden).toBeLessThan(2);
    expect(s0.rules).toMatchObject({ secondsPerChar: 12, revealMs: GAME.revealMs });
    expect(storage.alarms.at(-1)).toBe(s0.turn.closesAt);

    const early = await room.fetch(post('stroke', { race: 1, seq: 1, turn: 0, result: 'correct' }, kidAuth));
    expect(early.status).toBe(409);

    vi.setSystemTime(s0.goAt + 1000);
    const miss = (await (await room.fetch(post('stroke', { race: 1, seq: 1, turn: 0, result: 'mistake' }, kidAuth))).json()) as any;
    expect(miss.state.progress[kid.playerId]).toMatchObject({ mistakes: 1, turnMistakes: 1 });
    // The same request again (a retry) is accepted and changes nothing.
    const retry = (await (await room.fetch(post('stroke', { race: 1, seq: 1, turn: 0, result: 'mistake' }, kidAuth))).json()) as any;
    expect(retry.state.version).toBe(miss.state.version);
    const bad = await room.fetch(post('stroke', { race: 1, seq: 2, charIndex: 0, result: 'correct' }, kidAuth));
    expect(bad.status).toBe(400);

    // Unchanged poll is cheap.
    const v = miss.state.version;
    const poll = (await (await room.fetch(new Request(`https://room/state?v=${v}`, { headers: { 'x-player-id': kid.playerId, 'x-player-secret': kid.playerSecret } }))).json()) as any;
    expect(poll.unchanged).toBe(true);
    // Polls do not rewrite an alarm whose time has not changed (a storage write per poll otherwise).
    const alarmsBefore = storage.alarms.length;
    await room.fetch(new Request('https://room/state', { headers: { 'x-player-id': kid.playerId, 'x-player-secret': kid.playerSecret } }));
    await room.fetch(new Request('https://room/state', { headers: { 'x-player-id': host.playerId, 'x-player-secret': host.playerSecret } }));
    expect(storage.alarms.length).toBe(alarmsBefore);

    // The alarm closes the character on the clock with nobody polling, then runs the reveal, then the next one.
    vi.setSystemTime(s0.turn.closesAt + 1);
    await room.alarm();
    let saved = (await storage.get('state')) as any;
    expect(saved.turn).toMatchObject({ index: 0, closedAt: s0.turn.closesAt, winners: [] });
    expect(storage.alarms.at(-1)).toBe(s0.turn.closesAt + GAME.revealMs);
    vi.setSystemTime(s0.turn.closesAt + GAME.revealMs);
    await room.alarm();
    saved = (await storage.get('state')) as any;
    expect(saved.turn).toMatchObject({ index: 1, char: '口', closedAt: null });

    // A right answer on the last character (everyone right) closes it; the reveal ends the race.
    vi.setSystemTime(saved.turn.opensAt + 2000);
    const right = (await (await room.fetch(post('stroke', { race: 1, seq: 2, turn: 1, result: 'correct' }, kidAuth))).json()) as any;
    expect(right.state.turn).toMatchObject({ closedAt: saved.turn.opensAt + 2000, winners: [kid.playerId] });
    vi.setSystemTime(saved.turn.opensAt + 2000 + GAME.revealMs);
    await room.alarm();
    saved = (await storage.get('state')) as any;
    expect(saved.phase).toBe('done');
    expect(saved.results.map((r: any) => r.winners.length)).toEqual([0, 1]);
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

  it('a malformed code is a 400, not a crash; oversized bodies and pastes get a plain message', async () => {
    const w = buildWorker();
    expect((await w.fetch('/api/rooms/%E0')).status).toBe(400);
    expect((await w.fetch('/api/rooms/%E0/join', { method: 'POST', body: '{}' })).status).toBe(400);
    const huge = JSON.stringify({ text: '人'.repeat(GAME.maxBodyBytes) });
    const big = await w.fetch('/api/rooms', { method: 'POST', body: huge });
    expect(big.status).toBe(413);
    expect(((await big.json()) as any).error).toMatch(/shorter list/);
    const longPaste = JSON.stringify({ text: 'a'.repeat(GAME.maxPasteLength + 1) });
    const long = await w.fetch('/api/rooms', { method: 'POST', body: longPaste });
    expect(long.status).toBe(400);
    expect(((await long.json()) as any).error).toMatch(/too long/);
  });
});
