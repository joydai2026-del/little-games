// End to end through the real Worker router and RoomDO: a teacher makes a
// room with the agent client, an AI player joins with agent/lib.mjs, hears
// each word (downloads the clip), and writes it by sending the stroke medians
// from the site's proxy as points; the room grades them. On a fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorker, strokeFetch } from './harness';
import { createClient, playRound, seededRandom } from '../agent/lib.mjs';
import type { AiRunner } from '../src/worker/tts';

beforeEach(() => vi.stubGlobal('fetch', strokeFetch()));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4]);

async function setup(ai: AiRunner, text: string, options: Record<string, unknown>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  const w = buildWorker({ AI: ai });
  const fetchImpl = ((input: string, init?: RequestInit) => w.fetch(input, init)) as typeof fetch;
  const teacher = createClient({ baseUrl: 'https://dash.test', fetchImpl });
  const created = await teacher.create('Ms. Li', text, options);
  const robo = createClient({ baseUrl: 'https://dash.test', fetchImpl });
  await robo.join(created.code, 'Robo');
  await teacher.start(created.code);
  return { teacher, robo, created, joined: { state: (await robo.state(created.code)).state } };
}
const sleep = async (ms: number) => void vi.setSystemTime(Date.now() + ms);

describe('agent flow', () => {
  it('an agent that studied the list hears each word and writes it with real points (Hard)', async () => {
    const ai: AiRunner = { run: vi.fn(async () => ({ audio: btoa(String.fromCharCode(...WAV)) })) };
    const { teacher, robo, created, joined } = await setup(ai, '1. 山水 shānshuǐ\n2. 火 huǒ\n3. 朋友', { wordsPerRound: 2, level: 'hard' });
    // The agent's own payload never names the words.
    expect(JSON.stringify(joined.state)).not.toMatch(/山|水|火|朋|友/);
    const lines: string[] = [];
    const result = await playRound({
      client: robo, code: created.code, name: 'Robo', joined, words: ['朋友', '火', '山水'],
      paceMs: 400, mistakeRate: 0.2, random: seededRandom(3), sleep, log: (l) => lines.push(l),
    });
    expect(result).toMatchObject({ wordsDone: 2, place: 1, phase: 'done' });
    // 山 3 + 水 4 + 火 4 correct strokes (hanzi-writer-data 2.0.1).
    expect(result.strokes).toBe(11);
    expect(result.heard.map((h: any) => [h.wordIndex, h.type])).toEqual([[0, 'audio/wav'], [1, 'audio/wav']]);
    expect(lines).toContain('wrote 山水');
    const board = (await teacher.state(created.code)).state;
    expect(board.standings[0]).toMatchObject({ name: 'Robo', agent: true, finished: true, wordsDone: 2 });
  });

  it('an agent with no list cannot know the word and skips; a word that will not play is skipped', async () => {
    const ok: AiRunner = { run: async () => ({ audio: btoa(String.fromCharCode(...WAV)) }) };
    const a = await setup(ok, '大', {});
    expect(await playRound({ client: a.robo, code: a.created.code, name: 'Robo', joined: a.joined, sleep })).toMatchObject({ wordsDone: 0, strokes: 0, phase: 'done' });
    const dead: AiRunner = { run: async () => Promise.reject(new Error('down')) };
    const b = await setup(dead, '大', {});
    const r = await playRound({ client: b.robo, code: b.created.code, name: 'Robo', joined: b.joined, words: ['大'], sleep });
    expect(r).toMatchObject({ wordsDone: 0, phase: 'done' });
    expect(r.heard[0].error).toMatch(/speech is unavailable/);
  });
});
