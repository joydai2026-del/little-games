// Hand-written fakes of the Cloudflare pieces the Worker and RoomDO touch:
// storage, blockConcurrencyWhile, and a Durable Object namespace. Nothing here
// talks to the network.
import { readFileSync } from 'node:fs';
import { RoomDO } from '../src/worker/room-do';
import { BudgetDO } from '../src/worker/budget-do';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/env';

export class FakeStorage {
  readonly map = new Map<string, unknown>();
  alarms: number[] = [];
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.map.get(key)) as T | undefined;
  }
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') this.map.set(keyOrEntries, structuredClone(value));
    else for (const [k, v] of Object.entries(keyOrEntries)) this.map.set(k, structuredClone(v));
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
  async setAlarm(at: number): Promise<void> {
    this.alarms.push(at);
  }
  async deleteAlarm(): Promise<void> {}
}

class FakeState {
  pending: Promise<unknown> = Promise.resolve();
  constructor(readonly storage: FakeStorage) {}
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const p = fn();
    this.pending = p;
    return p;
  }
}

export interface Built {
  room: RoomDO;
  storage: FakeStorage;
}

export async function buildRoom(env: Env = {} as Env, storage = new FakeStorage()): Promise<Built> {
  const ctx = new FakeState(storage);
  const room = new RoomDO(ctx as unknown as DurableObjectState, env);
  await ctx.pending;
  return { room, storage };
}

/** A whole Worker with an in-memory Durable Object namespace. */
export function buildWorker(extra: Partial<Env> = {}): { env: Env; fetch: (input: string, init?: RequestInit) => Promise<Response>; rooms: Map<string, Built> } {
  const rooms = new Map<string, Built>();
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (req: Request) => {
        let built = rooms.get(id);
        if (!built) {
          built = await buildRoom(env);
          rooms.set(id, built);
        }
        return built.room.fetch(req);
      },
    }),
  };
  const env = {
    ROOMS: namespace as unknown as DurableObjectNamespace,
    ASSETS: { fetch: async () => new Response('static') } as unknown as Fetcher,
    ...boundEnv(),
    ...extra,
  } as Env;
  const fetchFn = (input: string, init?: RequestInit) =>
    worker.fetch(new Request(new URL(input, 'https://dash.test').toString(), init) as never, env);
  return { env, fetch: fetchFn, rooms };
}

/**
 * Serves the pinned stroke-data URLs from byte-exact fixtures
 * (tests/fixtures/strokes/<codepoint>.json, the real hanzi-writer-data 2.0.1
 * files), so the room's hash check passes offline. Any other URL is a 404.
 */
export function strokeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const m = url.match(/hanzi-writer-data@2\.0\.1\/(.+)\.json$/);
    if (!m) return new Response('not found', { status: 404 });
    const ch = decodeURIComponent(m[1]);
    try {
      return new Response(readFileSync(new URL(`./fixtures/strokes/${ch.codePointAt(0)!.toString(16)}.json`, import.meta.url)));
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
}

/** A rate limiter that always says yes (or no), and counts calls. */
export function fakeLimiter(allow = true): RateLimit & { calls: number } {
  const l = {
    calls: 0,
    async limit() {
      l.calls += 1;
      return { success: allow };
    },
  };
  return l as unknown as RateLimit & { calls: number };
}

/** An in-memory BudgetDO namespace (one real BudgetDO over FakeStorage). */
export function fakeBudgets(storage = new FakeStorage()): DurableObjectNamespace {
  const ctx = new FakeState(storage);
  const obj = new BudgetDO(ctx as unknown as DurableObjectState);
  return { idFromName: (n: string) => n, get: () => ({ fetch: (req: Request) => obj.fetch(req) }) } as unknown as DurableObjectNamespace;
}

/** Everything a working deploy has bound: limiters, budgets, generous caps. */
export function boundEnv(extra: Partial<Env> = {}): Partial<Env> {
  return { ROOM_CREATE_LIMITER: fakeLimiter(), TTS_LIMITER: fakeLimiter(), BUDGET: fakeBudgets(), ...extra };
}
