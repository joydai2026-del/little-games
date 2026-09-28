// Hand-written fakes of the Cloudflare pieces the Worker and RoomDO touch:
// storage, blockConcurrencyWhile, and a Durable Object namespace. Nothing here
// talks to the network.
import { RoomDO } from '../src/worker/room-do';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/env';
import { vi } from 'vitest';
import shan from './fixtures/山.json?raw';
import shui from './fixtures/水.json?raw';
import huo from './fixtures/火.json?raw';
import ren from './fixtures/人.json?raw';
import kou from './fixtures/口.json?raw';
import shi from './fixtures/十.json?raw';
import yi from './fixtures/一.json?raw';
import wo from './fixtures/wo-6211.json?raw';

// Byte-identical hanzi-writer-data 2.0.1 files (ASCII JSON, so the raw text IS the bytes).
const FIXTURE: Record<string, string> = { 山: shan, 水: shui, 火: huo, 人: ren, 口: kou, 十: shi, 一: yi, 我: wo };

/**
 * Stands in for the pinned upstream (jsDelivr): serves the committed,
 * byte-identical hanzi-writer-data files, so the room's hash check runs for
 * real. Anything else is a 404. Returns the list of URLs fetched.
 */
export function stubUpstream(): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const ch = decodeURIComponent(url.split('/').pop()!.replace(/\.json$/, ''));
    const file = FIXTURE[ch];
    if (!url.startsWith('https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/') || !file) return new Response('nope', { status: 404 });
    return new Response(new TextEncoder().encode(file));
  });
  return seen;
}

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
    worker.fetch(new Request(new URL(input, 'https://missing.test').toString(), init) as never, env);
  return { env, fetch: fetchFn, rooms };
}
