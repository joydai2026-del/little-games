// End to end through the real Worker router and RoomDO: a teacher makes a
// room with the agent client, an AI player joins with agent/lib.mjs, "hears"
// each word (downloads the clip) and writes the round to the end, on a fake clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorker } from './harness';
import { createClient, playRound, seededRandom } from '../agent/lib.mjs';
import type { AiRunner } from '../src/worker/tts';

afterEach(() => vi.useRealTimers());
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);

describe('agent flow', () => {
  it('an agent joins over HTTP, hears each word, and writes both words stroke by stroke', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: btoa(String.fromCharCode(...WAV)) })) };
    const w = buildWorker({ AI: ai });
    const fetchImpl = ((input: string, init?: RequestInit) => w.fetch(input, init)) as typeof fetch;
    const teacher = createClient({ baseUrl: 'https://dash.test', fetchImpl });
    const created = await teacher.create('Ms. Li', '1. 山水 shānshuǐ\n2. 火 huǒ\n3. 朋友', { wordsPerRound: 2, level: 'hard' });
    const robo = createClient({ baseUrl: 'https://dash.test', fetchImpl });
    const joined = await robo.join(created.code, 'Robo');
    await teacher.start(created.code);
    const lines: string[] = [];
    const result = await playRound({
      client: robo,
      code: created.code,
      name: 'Robo',
      joined: { state: (await robo.state(created.code)).state },
      paceMs: 400,
      mistakeRate: 0.2,
      listen: true,
      random: seededRandom(3),
      sleep: async (ms: number) => void vi.setSystemTime(Date.now() + ms),
      log: (l) => lines.push(l),
    });
    expect(joined.state.you).toBeTruthy();
    expect(result).toMatchObject({ wordsDone: 2, place: 1, phase: 'done' });
    // 山 3 + 水 4 + 火 4 correct strokes (hanzi-writer-data 2.0.1).
    expect(result.strokes).toBe(11);
    expect(result.heard.map((h: any) => [h.wordIndex, h.bytes, h.type])).toEqual([
      [0, WAV.byteLength, 'audio/wav'],
      [1, WAV.byteLength, 'audio/wav'],
    ]);
    expect(lines).toContain('wrote 山水');
    const board = (await teacher.state(created.code)).state;
    expect(board.standings[0]).toMatchObject({ name: 'Robo', agent: true, finished: true, wordsDone: 2 });
    expect(board.options.level).toBe('hard');
  });

  it('when a word will not play, the agent skips it, like a kid would', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const w = buildWorker({ AI: { run: async () => Promise.reject(new Error('down')) } });
    const fetchImpl = ((input: string, init?: RequestInit) => w.fetch(input, init)) as typeof fetch;
    const teacher = createClient({ baseUrl: 'https://dash.test', fetchImpl });
    const created = await teacher.create('T', '大', {});
    const robo = createClient({ baseUrl: 'https://dash.test', fetchImpl });
    await robo.join(created.code, 'Robo');
    await teacher.start(created.code);
    const result = await playRound({
      client: robo,
      code: created.code,
      name: 'Robo',
      joined: { state: (await robo.state(created.code)).state },
      listen: true,
      sleep: async (ms: number) => void vi.setSystemTime(Date.now() + ms),
    });
    expect(result).toMatchObject({ wordsDone: 0, phase: 'done' });
    expect(result.heard[0].error).toMatch(/speech is unavailable/);
  });
});
