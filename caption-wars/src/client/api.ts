// Every call to the room API lives here.
//
// Identity travels in headers (`x-player-id` / `x-player-secret`) on every
// request except "create a room", which is the call that hands the secret
// out. The secret is never rendered and never put in a URL.
//
// Every reply carries the server's clock, which we hand straight to state.ts
// so countdowns run off the server's schedule, not the phone's clock.

import { ACTION_TIMEOUT_MS, POLL_TIMEOUT_MS } from '../shared/config';
import type {
  CreateResponse,
  Identity,
  JoinResponse,
  RoomEnvelope,
  RoomOptions,
} from './contract';
import { noteServerTime } from './state';

/** An API failure with a message a player can actually read. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Plain-language stand-in when the server sends no message of its own. */
function plainError(status: number): string {
  if (status === 0) return 'No connection. Check your signal and try again.';
  if (status === 400) return 'That did not go through. Try again.';
  if (status === 403) return 'This device is no longer signed in to that room. Join it again.';
  if (status === 404) return 'No room with that code. Check the 4 characters.';
  if (status === 409) return 'That room is not taking that right now.';
  if (status === 413) return 'That is too long.';
  if (status === 429) return 'Too many tries at once. Wait a moment.';
  if (status >= 500) return 'The room had a problem. Try again in a moment.';
  return 'That did not work. Try again.';
}

/** Server messages are short and lower case; make them read like a sentence. */
function asSentence(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return '';
  const first = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

function authHeaders(identity?: Identity): Record<string, string> {
  if (!identity) return {};
  return {
    'x-player-id': identity.playerId,
    'x-player-secret': identity.playerSecret,
  };
}

/** What one HTTP round trip gives back, once the body has been read. */
export interface RawReply {
  ok: boolean;
  status: number;
  text: string;
  /**
   * The local clock when the HEADERS landed, not when the body finished: the
   * offset would otherwise absorb a whole round trip and every countdown would
   * run that much generous.
   */
  arrivedAt: number;
}

/**
 * One request with a deadline on it.
 *
 * Nothing in the browser used to bound a request. A fetch that never settles is
 * the normal shape of a phone dropping off wifi, and it is worse than an error:
 * the poll loop's `catch` never runs, so it never retries and never reschedules.
 * The countdown ticks to zero and the phone sits there for ever with no message
 * and no way back but a reload. A tapped button stays disabled just as long.
 *
 * The race is what bounds it (an abort alone cannot reject a promise the fetch
 * implementation never settles); the abort is what releases the real socket. A
 * timeout is deliberately reported as the same status-0 error a dead network
 * gives, because every caller already handles that correctly: the poll loop
 * retries with backoff, and every action button comes back.
 *
 * Exported with an injectable `fetchImpl` so the deadline is testable in node
 * with no DOM and no network.
 */
export async function requestWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<RawReply> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(plainError(0), 0));
    }, timeoutMs);
  });

  const attempt = async (): Promise<RawReply> => {
    const response = await fetchImpl(path, { ...init, signal: controller.signal });
    const arrivedAt = Date.now();
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, arrivedAt };
  };

  try {
    return await Promise.race([attempt(), deadline]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(plainError(0), 0);
  } finally {
    clearTimeout(timer);
  }
}

async function call<T extends RoomEnvelope>(
  path: string,
  init: RequestInit,
  identity?: Identity,
  timeoutMs: number = ACTION_TIMEOUT_MS
): Promise<T> {
  const reply = await requestWithTimeout(
    path,
    {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders(identity) },
    },
    timeoutMs
  );

  let data: unknown = null;
  try {
    data = reply.text ? JSON.parse(reply.text) : null;
  } catch {
    data = null;
  }

  if (!reply.ok) {
    const fromServer = (data as { error?: string } | null)?.error;
    throw new ApiError(fromServer ? asSentence(fromServer) : plainError(reply.status), reply.status);
  }

  const envelope = (data ?? {}) as T;
  noteServerTime(envelope.serverTime ?? envelope.state?.serverTime, reply.arrivedAt);
  return envelope;
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Creates a room. The caller becomes the host; bots are added here. */
export function createRoom(input: {
  name: string;
  options: Partial<RoomOptions>;
}): Promise<CreateResponse> {
  return call<CreateResponse>('/api/rooms', postJson(input));
}

/** Joins an existing room. Mid-game joiners play from the next round. */
export function joinRoom(code: string, name: string): Promise<JoinResponse> {
  return call<JoinResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, postJson({ name }));
}

/** Host only: lobby -> first round. */
export function startRoom(code: string, identity: Identity): Promise<RoomEnvelope> {
  return call<RoomEnvelope>(
    `/api/rooms/${encodeURIComponent(code)}/start`,
    postJson({ playerId: identity.playerId }),
    identity
  );
}

export function sendCaption(
  code: string,
  identity: Identity,
  text: string
): Promise<RoomEnvelope> {
  return call<RoomEnvelope>(
    `/api/rooms/${encodeURIComponent(code)}/caption`,
    postJson({ playerId: identity.playerId, text }),
    identity
  );
}

export function sendVote(
  code: string,
  identity: Identity,
  captionId: string
): Promise<RoomEnvelope> {
  return call<RoomEnvelope>(
    `/api/rooms/${encodeURIComponent(code)}/vote`,
    postJson({ playerId: identity.playerId, captionId }),
    identity
  );
}

/** Host only: reveal -> next round, or the end of the game. */
export function nextRound(code: string, identity: Identity): Promise<RoomEnvelope> {
  return call<RoomEnvelope>(
    `/api/rooms/${encodeURIComponent(code)}/next`,
    postJson({ playerId: identity.playerId }),
    identity
  );
}

/**
 * One poll. `version` lets the server answer `unchanged` for free.
 *
 * The player id used to ride along as `?p=`, which the worker has never read
 * (identity is the headers). It bought nothing and wrote player ids into every
 * access log, so it is gone.
 */
export function fetchRoom(
  code: string,
  identity: Identity,
  version?: number
): Promise<RoomEnvelope> {
  const query = new URLSearchParams();
  if (typeof version === 'number') query.set('v', String(version));
  const suffix = query.toString();
  return call<RoomEnvelope>(
    `/api/rooms/${encodeURIComponent(code)}${suffix ? `?${suffix}` : ''}`,
    { method: 'GET' },
    identity,
    POLL_TIMEOUT_MS
  );
}

/**
 * The photo for one round, served by the worker from Durable Object storage.
 * No query string: an <img> cannot send headers, and the route is deliberately
 * open (it answers a missing photo and a missing room identically), so there is
 * nothing for a player id to do here except end up in a log.
 */
export function photoUrl(code: string, round: number): string {
  return `/api/rooms/${encodeURIComponent(code)}/photo/${round}`;
}
