import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildRoom, buildWorker } from './harness';
import { GAME, LEVELS } from '../src/shared/config';
import daRaw from './fixtures/大.json?raw';
import shanRaw from './fixtures/山.json?raw';
import renRaw from './fixtures/人.json?raw';
import xueRaw from './fixtures/学.json?raw';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function post(path: string, body: unknown, auth?: { playerId: string; playerSecret: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    headers['x-player-id'] = auth.playerId;
    headers['x-player-secret'] = auth.playerSecret;
  }
  return new Request(`https://room/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const seat = (d: any) => ({ playerId: d.playerId, playerSecret: d.playerSecret });
const hdr = (s: { playerId: string; playerSecret: string }) => ({ 'x-player-id': s.playerId, 'x-player-secret': s.playerSecret });

describe('RoomDO', () => {
  it('create splits the list into playable words and words Momo cannot draw', async () => {
    const { room, storage } = await buildRoom();
    const res = await room.fetch(post('create', { code: 'ABCD', name: 'Ms. Li', text: '1. 人 rén\n2. 𠮷野 (no data)\n3. 口 kǒu' }));
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.state.list.words).toEqual(['人', '口']);
    expect(data.state.list.missing).toEqual(['𠮷野']);
    expect(data.state.list.strokeCounts).toEqual({ 人: 2, 口: 3 });
    expect(JSON.stringify(data.state)).not.toContain(data.playerSecret);
    expect(storage.alarms.at(-1)).toBe(data.state.expiresAt);
    expect((await room.fetch(post('create', { code: 'ABCD', text: '' }))).status).toBe(409);
  });

  it('rejects callers without the right secret', async () => {
    const { room } = await buildRoom();
    const host = (await (await room.fetch(post('create', { code: 'ABCD', text: '人' }))).json()) as any;
    expect((await room.fetch(post('start', {}, { playerId: host.playerId, playerSecret: 'nope' }))).status).toBe(403);
  });

  it('runs a round: start, guesses, alarm closes the question on the clock, answer hidden from kids until then', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { room, storage } = await buildRoom();
    const host = seat(await (await room.fetch(post('create', { code: 'ABCD', text: '人 口 山 大', options: { charsPerRound: 1, level: 'g35' } }))).json());
    const kid = seat(await (await room.fetch(post('join', { name: 'Mia' }))).json());
    const started = (await (await room.fetch(post('start', {}, host))).json()) as any;
    expect(started.state.phase).toBe('playing');
    expect(storage.alarms.at(-1)).toBe(started.state.question.endsAt);
    const kidView = (await (await room.fetch(new Request('https://room/state', { headers: hdr(kid) }))).json()) as any;
    expect(kidView.state.question.answer).toBeNull();
    expect(kidView.state.question.char).toBeNull();
    expect(kidView.state.list).toBeNull();
    // Each phone has its own card order: find the right word on the kid's own cards.
    const word = started.state.question.cards[started.state.question.answer];
    const answer = kidView.state.question.cards.indexOf(word);

    const early = await room.fetch(post('guess', { race: 1, question: 0, seq: 1, card: answer }, kid));
    expect(early.status).toBe(409);
    vi.setSystemTime(started.state.question.startAt + 200);
    expect((await room.fetch(post('guess', { race: 1, question: 0, seq: 1, card: answer }, kid))).status).toBe(409); // stroke 1 not readable yet
    const drawing = (await (await room.fetch(new Request('https://room/drawing', { headers: hdr(kid) }))).json()) as any;
    expect(drawing).toMatchObject({ round: 1, question: 0, shown: 1, complete: false, char: started.state.question.char });
    vi.setSystemTime(started.state.question.openAt);
    const ok = (await (await room.fetch(post('guess', { race: 1, question: 0, seq: 1, card: answer }, kid))).json()) as any;
    expect(ok.state.score.points).toBe(1000);
    // Only one kid, and they got it: the question closes at once and the answer shows.
    expect(ok.state.question.closedAt).not.toBeNull();
    expect(ok.state.question.answer).toBe(answer);
    const retry = (await (await room.fetch(post('guess', { race: 1, question: 0, seq: 1, card: answer }, kid))).json()) as any;
    expect(retry.state.version).toBe(ok.state.version);
    expect((await room.fetch(post('guess', { race: 1, question: 0, seq: 2, card: 'x' }, kid))).status).toBe(400);

    const v = ok.state.version;
    const poll = (await (await room.fetch(new Request(`https://room/state?v=${v}`, { headers: hdr(kid) }))).json()) as any;
    expect(poll.unchanged).toBe(true);

    // The alarm ends the round after the answer shows, with nobody polling.
    vi.setSystemTime(ok.state.question.nextAt + 1);
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
    expect((await w.fetch(`/api/rooms/${data.code.toLowerCase()}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) })).status).toBe(200);
    expect((await w.fetch('/api/rooms/OOOO')).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/explode`, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await w.fetch(`/api/rooms/${data.code}/drawing`, { method: 'POST', body: '{}' })).status).toBe(405);
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
  });

  it('/drawing returns only the strokes on the big screen, hash-checked, and never names the character', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const bodies: Record<string, string> = { 大: daRaw, 山: shanRaw, 人: renRaw, 学: xueRaw };
    const upstream = vi.fn(async (url: string) => {
      const ch = decodeURIComponent(url.split('/').pop()!.replace('.json', ''));
      return new Response(new TextEncoder().encode(bodies[ch]));
    });
    vi.stubGlobal('fetch', upstream);
    const w = buildWorker();
    const made = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '大 山 人 学', options: { charsPerRound: 1, level: 'k2' } }) })).json()) as any;
    const kid = seat(await (await w.fetch(`/api/rooms/${made.code}/join`, { method: 'POST', body: JSON.stringify({ name: 'Ava' }) })).json());
    const start = (await (await w.fetch(`/api/rooms/${made.code}/start`, { method: 'POST', headers: hdr(seat(made)), body: '{}' })).json()) as any;
    const before = (await (await w.fetch(`/api/rooms/${made.code}/drawing`, { headers: hdr(kid) })).json()) as any;
    expect(before).toMatchObject({ shown: 0, strokes: [] });
    vi.setSystemTime(start.state.question.startAt + LEVELS.k2.strokeMs + 10);
    const res = await w.fetch(`/api/rooms/${made.code}/drawing`, { headers: hdr(kid) });
    const text = await res.text();
    const d = JSON.parse(text);
    expect(d).toMatchObject({ round: 1, question: 0, shown: 2, complete: false });
    expect(d.strokes).toHaveLength(2);
    expect(d.medians).toHaveLength(2);
    expect(text).not.toContain('"char"');
    const char = start.state.question.char;
    expect(JSON.parse(bodies[char]).strokes.slice(0, 2)).toEqual(d.strokes);
    expect(upstream).toHaveBeenCalledWith(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`, expect.anything());
    expect((await w.fetch(`/api/rooms/${made.code}/drawing`)).status).toBe(403);
  });
});
