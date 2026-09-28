// The phone's side of the HTTP API, plus where this phone keeps its seat.
import type { PublicState } from '../shared/types';
import { GAME } from '../shared/config';
import { timeoutSignal } from './timeout';

export interface Seat {
  playerId: string;
  playerSecret: string;
}

const memory = new Map<string, Seat>();
const seatKey = (code: string) => `stroke-reveal:seat:${code}`;

export function saveSeat(code: string, seat: Seat): void {
  memory.set(code, seat);
  try {
    localStorage.setItem(seatKey(code), JSON.stringify(seat));
  } catch {
    // private mode or blocked storage: the in-memory seat still works
  }
}

export function clearSeat(code: string): void {
  memory.delete(code);
  try {
    localStorage.removeItem(seatKey(code));
  } catch {
    // ignore
  }
}

export function loadSeat(code: string): Seat | null {
  if (memory.has(code)) return memory.get(code)!;
  try {
    const raw = localStorage.getItem(seatKey(code));
    if (!raw) return null;
    const seat = JSON.parse(raw) as Seat;
    if (typeof seat.playerId === 'string' && typeof seat.playerSecret === 'string') return seat;
  } catch {
    // ignore
  }
  return null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, seat?: Seat | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (seat) {
    headers['x-player-id'] = seat.playerId;
    headers['x-player-secret'] = seat.playerSecret;
  }
  let res: Response;
  let data: { error?: string };
  try {
    // A deadline on the whole request, body included: a hung request on weak
    // classroom Wi-Fi must fail, so the retry and resync logic can run.
    const signal = timeoutSignal(GAME.requestTimeoutMs);
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    data = (await res.json().catch((err: unknown) => {
      if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw err;
      return {};
    })) as { error?: string };
  } catch {
    throw new ApiError('No internet right now. Trying again...', 0);
  }
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong', res.status);
  return data as T;
}

export interface Envelope {
  state: PublicState;
  serverTime: number;
}
export interface Polled {
  state?: PublicState;
  unchanged?: boolean;
  nextPollMs?: number;
  serverTime: number;
}

export async function createRoom(name: string, text: string): Promise<Envelope & { code: string } & Seat> {
  const data = await call<Envelope & { code: string } & Seat>('POST', '/api/rooms', { name, text });
  saveSeat(data.code, { playerId: data.playerId, playerSecret: data.playerSecret });
  return data;
}

export async function joinRoom(code: string, name: string): Promise<Envelope & Seat> {
  const data = await call<Envelope & Seat>('POST', `/api/rooms/${code}/join`, { name });
  saveSeat(code, { playerId: data.playerId, playerSecret: data.playerSecret });
  return data;
}

export const poll = (code: string, seat: Seat, v?: number) =>
  call<Polled>('GET', `/api/rooms/${code}${v === undefined ? '' : `?v=${v}`}`, undefined, seat);
export const act = (code: string, seat: Seat, action: 'start' | 'next') => call<Envelope>('POST', `/api/rooms/${code}/${action}`, {}, seat);
export const setList = (code: string, seat: Seat, text: string) => call<Envelope>('POST', `/api/rooms/${code}/list`, { text }, seat);
export const setOptions = (code: string, seat: Seat, options: Record<string, unknown>) =>
  call<Envelope>('POST', `/api/rooms/${code}/options`, options, seat);
export const sendGuess = (code: string, seat: Seat, guess: { race: number; question: number; seq: number; card: number }) =>
  call<Envelope>('POST', `/api/rooms/${code}/guess`, guess, seat);
