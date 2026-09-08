// Every call to the room API lives here.
//
// Identity travels in headers (`x-player-id` / `x-player-secret`) on every
// request except "create a room", which is the call that hands the secret
// out. The secret is never rendered and never put in a URL.
//
// Every reply carries the server's clock, which we hand straight to state.ts
// so countdowns run off the server's schedule, not the phone's clock.

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

async function call<T extends RoomEnvelope>(
  path: string,
  init: RequestInit,
  identity?: Identity
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders(identity) },
    });
  } catch {
    throw new ApiError(plainError(0), 0);
  }
  // Stamp the local clock the moment the headers land, not after the body has
  // been read and parsed: otherwise the offset absorbs a whole round trip and
  // every countdown runs that much generous.
  const arrivedAt = Date.now();

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const fromServer = (data as { error?: string } | null)?.error;
    throw new ApiError(
      fromServer ? asSentence(fromServer) : plainError(response.status),
      response.status
    );
  }

  const envelope = (data ?? {}) as T;
  noteServerTime(envelope.serverTime ?? envelope.state?.serverTime, arrivedAt);
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

/** One poll. `version` lets the server answer `unchanged` for free. */
export function fetchRoom(
  code: string,
  identity: Identity,
  version?: number
): Promise<RoomEnvelope> {
  const query = new URLSearchParams({ p: identity.playerId });
  if (typeof version === 'number') query.set('v', String(version));
  return call<RoomEnvelope>(
    `/api/rooms/${encodeURIComponent(code)}?${query.toString()}`,
    { method: 'GET' },
    identity
  );
}

/**
 * The photo for one round, served by the worker from Durable Object storage.
 * An <img> cannot send headers, so the player id rides along as a query
 * parameter; the secret never does.
 */
export function photoUrl(code: string, round: number, playerId: string): string {
  const query = new URLSearchParams({ p: playerId });
  return `/api/rooms/${encodeURIComponent(code)}/photo/${round}?${query.toString()}`;
}
