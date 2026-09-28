// The speech route: model call with retries, sniffing, cache, rate limit, and
// the rule that only a word of a running round is ever spoken.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioResponse, sniffAudioType, speakWord, synthesize, type AiRunner, type TtsConfig } from '../src/worker/tts';
import { ttsConfig } from '../src/worker/env';
import { buildWorker } from './harness';

afterEach(() => vi.useRealTimers());

// A real 44-byte WAV header (RIFF....WAVE) plus two samples; bytes only, never played.
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x2c, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...new Array(36).fill(0)]);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const CFG: TtsConfig = { ...ttsConfig({} as never), retryDelaysMs: [0] };
const noWait = async () => {};

class MemCache {
  map = new Map<string, Response>();
  async match(k: Request) {
    const r = this.map.get(k.url);
    return r ? r.clone() : undefined;
  }
  async put(k: Request, r: Response) {
    this.map.set(k.url, r.clone());
  }
}

describe('synthesize', () => {
  it('reads the {audio: base64} shape and sniffs WAV', async () => {
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: b64(WAV) })) };
    const r = await synthesize(ai, CFG, '朋友', noWait);
    expect(r.attempts).toBe(1);
    expect(sniffAudioType(r.bytes!)).toBe('audio/wav');
    expect(ai.run).toHaveBeenCalledWith('@cf/myshell-ai/melotts', { prompt: '朋友', lang: 'zh' });
  });
  it('retries a transient failure, but not a malformed answer', async () => {
    let n = 0;
    const flaky: AiRunner = { run: async () => (++n < 3 ? Promise.reject(new Error('502')) : { audio: b64(WAV) }) };
    expect((await synthesize(flaky, CFG, '大', noWait)).attempts).toBe(3);
    const junk: AiRunner = { run: vi.fn(async () => ({ nope: 1 })) };
    const r = await synthesize(junk, CFG, '大', noWait);
    expect(r).toEqual({ bytes: null, attempts: 1 });
  });
  it('refuses a clip over the size cap', async () => {
    const ai: AiRunner = { run: async () => new Uint8Array(CFG.maxBytes + 1) };
    expect((await synthesize(ai, CFG, '大', noWait)).bytes).toBeNull();
  });
});

describe('speakWord', () => {
  it('a miss calls the model once and caches; a hit costs nothing', async () => {
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: b64(WAV) })) };
    const cache = new MemCache();
    const deps = { ai, cache: cache as unknown as Cache, allowMiss: async () => true, wait: noWait };
    const first = await speakWord('朋友', CFG, 'https://dash.test/api/rooms/ABCD/say?w=0', deps);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-tts-cache')).toBe('MISS');
    expect(first.headers.get('content-type')).toBe('audio/wav');
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    const again = await speakWord('朋友', CFG, 'https://dash.test/api/rooms/WXYZ/say?w=3', deps);
    expect(again.headers.get('x-tts-cache')).toBe('HIT');
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(WAV);
    expect(ai.run).toHaveBeenCalledTimes(1);
  });
  it('rate-limited misses get a plain 429; no model is a 503; a dead model is a 502', async () => {
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: b64(WAV) })) };
    expect((await speakWord('大', CFG, 'https://dash.test/', { ai, cache: null, allowMiss: async () => false })).status).toBe(429);
    expect(ai.run).not.toHaveBeenCalled();
    expect((await speakWord('大', CFG, 'https://dash.test/', { ai: undefined, cache: null, allowMiss: async () => true })).status).toBe(503);
    const dead: AiRunner = { run: async () => Promise.reject(new Error('down')) };
    expect((await speakWord('大', CFG, 'https://dash.test/', { ai: dead, cache: null, allowMiss: async () => true, wait: noWait })).status).toBe(502);
  });
  it('config comes from vars with safe defaults', () => {
    expect(ttsConfig({ TTS_MODEL: '@cf/other', TTS_MAX_ATTEMPTS: '99' } as never)).toMatchObject({ model: '@cf/other', maxAttempts: 5 });
    expect(audioResponse(WAV, 60, 'HIT').headers.get('cache-control')).toBe('private, max-age=60');
  });
});

describe('GET /api/rooms/:code/say through the Worker', () => {
  it('speaks the round word for a player, and nothing for anyone else', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: b64(WAV) })) };
    const w = buildWorker({ AI: ai });
    const made = (await (await w.fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ text: '朋友 大' }) })).json()) as any;
    const kid = (await (await w.fetch(`/api/rooms/${made.code}/join`, { method: 'POST', body: JSON.stringify({ name: 'Mia' }) })).json()) as any;
    const h = (d: any) => ({ 'x-player-id': d.playerId, 'x-player-secret': d.playerSecret });
    expect((await w.fetch(`/api/rooms/${made.code}/say?w=0`, { headers: h(kid) })).status).toBe(403);
    await w.fetch(`/api/rooms/${made.code}/start`, { method: 'POST', headers: h(made), body: '{}' });
    const clip = await w.fetch(`/api/rooms/${made.code}/say?w=0`, { headers: h(kid) });
    expect(clip.status).toBe(200);
    expect(clip.headers.get('content-type')).toBe('audio/wav');
    expect(ai.run).toHaveBeenCalledWith('@cf/myshell-ai/melotts', { prompt: '朋友', lang: 'zh' });
    expect((await w.fetch(`/api/rooms/${made.code}/say?w=0`)).status).toBe(403);
    expect((await w.fetch(`/api/rooms/${made.code}/say?w=1`, { headers: h(kid) })).status).toBe(409);
  });
});
