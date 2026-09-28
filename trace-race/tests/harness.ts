// Hand-written fakes of the Cloudflare pieces the Worker and RoomDO touch:
// storage, blockConcurrencyWhile, and a Durable Object namespace. Nothing here
// talks to the network.
import { RoomDO } from '../src/worker/room-do';
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
export function buildWorker(): { env: Env; fetch: (input: string, init?: RequestInit) => Promise<Response>; rooms: Map<string, Built> } {
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
  } as Env;
  const fetchFn = (input: string, init?: RequestInit) =>
    worker.fetch(new Request(new URL(input, 'https://trace.test').toString(), init) as never, env);
  return { env, fetch: fetchFn, rooms };
}
