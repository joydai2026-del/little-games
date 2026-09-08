// Client-side memory that outlives one screen.
//
// Identity (playerId + playerSecret) is stored per ROOM CODE in
// sessionStorage, so reloading the page rejoins the same room as the same
// player, a second tab is a second player, and closing the tab forgets the
// secret. The display name is kept in localStorage because typing it again
// every game is annoying.
//
// Every function here takes an optional storage object so the pure parts can
// be tested in node without a DOM.

import type { Identity } from './contract';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const IDENTITY_PREFIX = 'cw.player.';
const NAME_KEY = 'cw.name.v1';

/** sessionStorage key for one room's identity. Code is always upper case. */
export function identityKey(code: string): string {
  return IDENTITY_PREFIX + normalizeCode(code);
}

/** A room code as the server wants it: 4 upper-case letters, nothing else. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function sessionStore(): StorageLike | null {
  try {
    return (globalThis as { sessionStorage?: StorageLike }).sessionStorage ?? null;
  } catch {
    return null; // private mode, or storage blocked
  }
}

function localStore(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads the identity for a room, or null if we have never joined it here. */
export function readIdentity(code: string, storage: StorageLike | null = sessionStore()): Identity | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(identityKey(code));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (typeof parsed?.playerId === 'string' && typeof parsed?.playerSecret === 'string') {
      return { playerId: parsed.playerId, playerSecret: parsed.playerSecret };
    }
  } catch {
    // corrupt entry: treat as "never joined"
  }
  return null;
}

export function writeIdentity(
  code: string,
  identity: Identity,
  storage: StorageLike | null = sessionStore()
): void {
  if (!storage) return;
  try {
    storage.setItem(identityKey(code), JSON.stringify(identity));
  } catch {
    // no storage: a reload will ask for the name again, nothing worse
  }
}

export function forgetIdentity(code: string, storage: StorageLike | null = sessionStore()): void {
  if (!storage) return;
  try {
    storage.removeItem(identityKey(code));
  } catch {
    // nothing to do
  }
}

export function savedName(storage: StorageLike | null = localStore()): string {
  try {
    return storage?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string, storage: StorageLike | null = localStore()): void {
  try {
    storage?.setItem(NAME_KEY, name);
  } catch {
    // fine: the name simply is not remembered next time
  }
}

// ---------- clock offset ----------
//
// Phone clocks are wrong all the time. Every reply carries the server's own
// clock, so we keep the difference and read every deadline through it. The
// latest sample wins (a fresher measurement beats an averaged stale one).

let offset = 0;

export function noteServerTime(serverTime: number | undefined, localNow: number = Date.now()): void {
  if (typeof serverTime === 'number' && Number.isFinite(serverTime)) {
    offset = serverTime - localNow;
  }
}

export function clockOffsetMs(): number {
  return offset;
}

/** Best guess at the server's clock right now. */
export function serverNow(localNow: number = Date.now()): number {
  return localNow + offset;
}

/** Test seam only. */
export function resetClockOffset(): void {
  offset = 0;
}
