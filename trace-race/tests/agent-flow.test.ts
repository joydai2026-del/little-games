// End to end through the real Worker router and RoomDO: a teacher makes a
// room with the agent client, an AI racer joins with agent/lib.mjs and races
// to the finish on a fake clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorker } from './harness';
import { createClient, playRace, seededRandom } from '../agent/lib.mjs';

afterEach(() => vi.useRealTimers());

describe('agent flow', () => {
  it('an agent joins over HTTP, waits for GO, and finishes the race', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const w = buildWorker();
    const fetchImpl = ((input: string, init?: RequestInit) => w.fetch(input, init)) as typeof fetch;
    const teacher = createClient({ baseUrl: 'https://trace.test', fetchImpl });
    const created = await teacher.create('Ms. Li', '1. 山 shān\n2. 水 shuǐ\n3. 火 huǒ', { charsPerRound: 2 });

    const robo = createClient({ baseUrl: 'https://trace.test', fetchImpl });
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
      paceMs: 400,
      mistakeRate: 0.2,
      random: seededRandom(3),
      sleep,
      log: (l) => lines.push(l),
    });
    expect(result.charsDone).toBe(2);
    expect(result.place).toBe(1);
    expect(result.phase).toBe('done');
    // 山 has 3 strokes and 水 has 4 in hanzi-writer-data 2.0.1.
    expect(result.strokes).toBe(7);
    expect(lines).toContain('finished 山');
    const board = (await teacher.state(created.code)).state;
    expect(board.standings[0]).toMatchObject({ name: 'Robo', agent: true, finished: true });
  });
});
