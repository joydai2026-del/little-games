// End to end through the real Worker router and RoomDO: a teacher makes a room
// with the agent client, an AI player joins with agent/lib.mjs, watches the
// drawing through /drawing and plays the round to the end on a fake clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorker } from './harness';
import { createClient, playRound, seededRandom } from '../agent/lib.mjs';
import daRaw from './fixtures/大.json?raw';
import shanRaw from './fixtures/山.json?raw';
import renRaw from './fixtures/人.json?raw';
import xueRaw from './fixtures/学.json?raw';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('agent flow', () => {
  it('an agent joins over HTTP, watches the drawing, and guesses every word right', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const bodies: Record<string, string> = { 大: daRaw, 山: shanRaw, 人: renRaw, 学: xueRaw };
    vi.stubGlobal('fetch', async (url: string) => {
      const ch = decodeURIComponent(String(url).split('/').pop()!.replace('.json', ''));
      return bodies[ch] ? new Response(new TextEncoder().encode(bodies[ch])) : new Response('nope', { status: 404 });
    });
    const w = buildWorker();
    const fetchImpl = ((input: string, init?: RequestInit) => w.fetch(input, init)) as typeof fetch;
    const teacher = createClient({ baseUrl: 'https://reveal.test', fetchImpl });
    const created = await teacher.create('Ms. Li', '1. 大人 dàrén\n2. 山 shān\n3. 学校 xuéxiào\n4. 人 rén', { charsPerRound: 3, level: 'g35' });

    const robo = createClient({ baseUrl: 'https://reveal.test', fetchImpl });
    const origJoin = robo.join.bind(robo);
    (robo as any).join = async (code: string, name: string) => {
      const joined = await origJoin(code, name);
      await teacher.start(code);
      return joined;
    };
    const lines: string[] = [];
    const result = await playRound({
      client: robo,
      code: created.code,
      name: 'Robo',
      pollMs: 300,
      patience: 0.5,
      mistakeRate: 0,
      random: seededRandom(3),
      sleep: async (ms: number) => void vi.setSystemTime(Date.now() + ms),
      log: (l) => lines.push(l),
    });
    expect(result).toMatchObject({ right: 3, wrong: 0, place: 1, phase: 'done' });
    expect(result.points).toBeGreaterThan(3 * 100);
    expect(lines.some((l) => l.startsWith('got word 1'))).toBe(true);
    const board = (await teacher.state(created.code)).state;
    expect(board.standings[0]).toMatchObject({ name: 'Robo', agent: true, correct: 3 });
  });
});
