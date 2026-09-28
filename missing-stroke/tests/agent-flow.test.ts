// End to end through the real Worker router and RoomDO: a teacher makes a
// room with the agent client, an AI player joins with agent/lib.mjs and plays
// every character to the end of the race on a fake clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorker } from './harness';
import { createClient, playRace, seededRandom } from '../agent/lib.mjs';

afterEach(() => vi.useRealTimers());

describe('agent flow', () => {
  it('an agent joins over HTTP, waits for each character, answers, and the race ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const w = buildWorker();
    const fetchImpl = ((input: string, init?: RequestInit) => w.fetch(input, init)) as typeof fetch;
    const teacher = createClient({ baseUrl: 'https://missing.test', fetchImpl });
    const created = await teacher.create('Ms. Li', '1. 山 shān\n2. 水 shuǐ\n3. 火 huǒ', { charsPerRound: 2, level: 'big' });

    const robo = createClient({ baseUrl: 'https://missing.test', fetchImpl });
    const sleep = async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    };
    // Start the race as soon as the agent is in, like a teacher would.
    const origJoin = robo.join.bind(robo);
    (robo as any).join = async (code: string, name: string) => {
      const joined = await origJoin(code, name);
      await teacher.start(code);
      return joined;
    };
    const lines: string[] = [];
    const result = await playRace({
      client: robo,
      code: created.code,
      name: 'Robo',
      paceMs: 1200,
      mistakeRate: 0.3,
      random: seededRandom(3),
      sleep,
      log: (l) => lines.push(l),
    });
    expect(result.phase).toBe('done');
    expect(result.rights).toBe(2);
    expect(result.wins).toBe(2);
    expect(result.place).toBe(1);
    expect(lines.some((l) => /^drew stroke \d of 山$/.test(l))).toBe(true);
    const board = (await teacher.state(created.code)).state;
    expect(board.standings[0]).toMatchObject({ name: 'Robo', agent: true, wins: 2, rights: 2 });
    expect(board.results.map((r: any) => r.char)).toEqual(['山', '水']);
  });
});
