// The speech route: model call with retries, sniffing, room-storage cache,
// FAIL-CLOSED guards on every paid attempt, budgets and their readback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioResponse, sniffAudioType, speakWord, synthesize, type AiRunner, type TtsConfig } from '../src/worker/tts';
import { ttsConfig } from '../src/worker/env';
import { buildWorker, fakeLimiter, strokeFetch } from './harness';

beforeEach(() => vi.stubGlobal('fetch', strokeFetch()));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A real 44-byte WAV header (RIFF....WAVE) plus padding; bytes only, never played.
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x2c, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...new Array(36).fill(0)]);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const CFG: TtsConfig = { ...ttsConfig({} as never), retryDelaysMs: [0] };
const noWait = async () => {};
const yes = async () => true;

describe('synthesize', () => {
  it('reads the {audio: base64} shape and sniffs WAV', async () => {
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: b64(WAV) })) };
    const r = await synthesize(ai, CFG, '朋友', noWait);
    expect(r.attempts).toBe(1);
    expect(sniffAudioType(r.bytes!)).toBe('audio/wav');
    expect(ai.run).toHaveBeenCalledWith('@cf/myshell-ai/melotts', { prompt: '朋友', lang: 'zh' });
  });
  it('retries a transient failure, asking the guard before EVERY attempt; not a malformed answer', async () => {
    let n = 0;
    let asked = 0;
    const flaky: AiRunner = { run: async () => (++n < 3 ? Promise.reject(new Error('502')) : { audio: b64(WAV) }) };
    expect((await synthesize(flaky, CFG, '大', noWait, async () => (asked++, true))).attempts).toBe(3);
    expect(asked).toBe(3);
    const stopped = await synthesize(flaky, CFG, '大', noWait, async () => false);
    expect(stopped).toMatchObject({ bytes: null, attempts: 0, refused: true });
    const junk: AiRunner = { run: vi.fn(async () => ({ nope: 1 })) };
    expect(await synthesize(junk, CFG, '大', noWait)).toEqual({ bytes: null, attempts: 1 });
  });
  it('refuses a clip over the size cap', async () => {
    const ai: AiRunner = { run: async () => new Uint8Array(CFG.maxBytes + 1) };
    expect((await synthesize(ai, CFG, '大', noWait)).bytes).toBeNull();
  });
  it('responses are never browser-cached; config comes from vars', async () => {
    expect(audioResponse(WAV, 60, 'HIT').headers.get('cache-control')).toBe('no-store');
    expect(ttsConfig({ TTS_MODEL: '@cf/other', TTS_MAX_ATTEMPTS: '99' } as never)).toMatchObject({ model: '@cf/other', maxAttempts: 5 });
    const dead: AiRunner = { run: async () => Promise.reject(new Error('down')) };
    expect((await speakWord('大', CFG, 'https://dash.test/', { ai: dead, cache: null, beforeAttempt: yes, wait: noWait })).status).toBe(502);
    expect((await speakWord('大', CFG, 'https://dash.test/', { ai: undefined, cache: null, beforeAttempt: yes })).status).toBe(503);
  });
});

async function roomWithKid(w: ReturnType<typeof buildWorker>, text = '朋友 大') {
  const made = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text }) })).json()) as any;
  const kid = (await (await w.fetch(`/api/rooms/${made.code}/join`, { method: 'POST', body: JSON.stringify({ name: 'Mia' }) })).json()) as any;
  const h = (d: any) => ({ 'x-player-id': d.playerId, 'x-player-secret': d.playerSecret });
  return { made, kid, h };
}
async function started(w: ReturnType<typeof buildWorker>, text?: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  const r = await roomWithKid(w, text);
  const st = (await (await w.fetch(`/api/rooms/${r.made.code}/start`, { method: 'POST', headers: r.h(r.made), body: '{}' })).json()) as any;
  vi.setSystemTime(st.state.goAt + 10);
  return { ...r, round: st.state.round };
}

describe('GET /api/rooms/:code/say through the Worker', () => {
  it('speaks the round word for a player; later listeners get the stored clip (one model call)', async () => {
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: b64(WAV) })) };
    const w = buildWorker({ AI: ai });
    const { made, kid, h } = await started(w);
    const clip = await w.fetch(`/api/rooms/${made.code}/say?r=1&w=0`, { headers: h(kid) });
    expect(clip.status).toBe(200);
    expect(clip.headers.get('content-type')).toBe('audio/wav');
    const again = await w.fetch(`/api/rooms/${made.code}/say?r=1&w=0`, { headers: h(kid) });
    expect(again.headers.get('x-tts-cache')).toBe('HIT');
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect((await w.fetch(`/api/rooms/${made.code}/say?r=2&w=0`, { headers: h(kid) })).status).toBe(409);
    expect((await w.fetch(`/api/rooms/${made.code}/say?w=0`, { headers: h(kid) })).status).toBe(400);
    expect((await w.fetch(`/api/rooms/${made.code}/say?r=1&w=0`)).status).toBe(403);
  });

  it('parallel first requests for a new word share one synthesis', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const ai: AiRunner = { run: vi.fn(async () => (await gate, { audio: b64(WAV) })) };
    const w = buildWorker({ AI: ai });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const made = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '学校' }) })).json()) as any;
    const h = (d: any) => ({ 'x-player-id': d.playerId, 'x-player-secret': d.playerSecret });
    const kids = [];
    for (const name of ['A', 'B', 'C']) kids.push((await (await w.fetch(`/api/rooms/${made.code}/join`, { method: 'POST', body: JSON.stringify({ name }) })).json()) as any);
    const st = (await (await w.fetch(`/api/rooms/${made.code}/start`, { method: 'POST', headers: h(made), body: '{}' })).json()) as any;
    vi.setSystemTime(st.state.goAt + 10);
    const asks = kids.map((k) => w.fetch(`/api/rooms/${made.code}/say?r=1&w=0`, { headers: h(k) }));
    await new Promise((r) => setTimeout(r, 10));
    release();
    expect((await Promise.all(asks)).map((a) => a.status)).toEqual([200, 200, 200]);
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it('fails CLOSED: no TTS limiter, a limiter that throws, a refusing limiter, no budget counter', async () => {
    const run = vi.fn(async () => ({ audio: b64(WAV) }));
    for (const extra of [
      { TTS_LIMITER: undefined },
      { TTS_LIMITER: { limit: async () => Promise.reject(new Error('down')) } as never },
      { TTS_LIMITER: fakeLimiter(false) },
      { BUDGET: undefined },
    ]) {
      const w = buildWorker({ AI: { run }, ...extra });
      const { made, kid, h } = await started(w);
      expect((await w.fetch(`/api/rooms/${made.code}/say?r=1&w=0`, { headers: h(kid) })).status).toBe(429);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('every model attempt counts against the room and global daily budgets; readback shows it', async () => {
    let n = 0;
    const ai: AiRunner = { run: async () => (++n % 3 !== 0 ? Promise.reject(new Error('502')) : { audio: b64(WAV) }) };
    const w = buildWorker({ AI: ai, TTS_ROOM_DAILY_CALLS: '4', TTS_GLOBAL_DAILY_CALLS: '100' });
    const { made, kid, h } = await started(w, '朋友 大');
    expect((await w.fetch(`/api/rooms/${made.code}/say?r=1&w=0`, { headers: h(kid) })).status).toBe(200); // 3 attempts
    const room = (await (await w.fetch(`/api/rooms/${made.code}/budget`, { headers: h(kid) })).json()) as any;
    expect(room).toMatchObject({ used: 3, limit: 4 });
    const global = (await (await w.fetch('/api/tts-budget')).json()) as any;
    expect(global).toMatchObject({ used: 3, globalDailyLimit: 100, roomDailyLimit: 4, model: '@cf/myshell-ai/melotts' });
    // Word 2 needs up to 3 attempts; the room has 1 left: it stops when the budget is spent.
    await w.fetch(`/api/rooms/${made.code}/skip`, { method: 'POST', headers: h(kid), body: JSON.stringify({ race: 1, seq: 1, wordIndex: 0 }) });
    expect((await w.fetch(`/api/rooms/${made.code}/say?r=1&w=1`, { headers: h(kid) })).status).toBe(502);
    expect(((await (await w.fetch(`/api/rooms/${made.code}/budget`, { headers: h(kid) })).json()) as any).used).toBe(4);
    expect(n).toBe(4);
  });

  it('the global budget stops speech for every room', async () => {
    const run = vi.fn(async () => ({ audio: b64(WAV) }));
    const w = buildWorker({ AI: { run }, TTS_GLOBAL_DAILY_CALLS: '1' });
    const a = await started(w, '朋友');
    expect((await w.fetch(`/api/rooms/${a.made.code}/say?r=1&w=0`, { headers: a.h(a.kid) })).status).toBe(200);
    const b = await started(w, '学校');
    expect((await w.fetch(`/api/rooms/${b.made.code}/say?r=1&w=0`, { headers: b.h(b.kid) })).status).toBe(429);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
