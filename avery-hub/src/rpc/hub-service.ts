// HubService: the named RPC entrypoint games reach through a service binding
// ("entrypoint": "HubService"). A named entrypoint gets no internet traffic;
// only the default export's fetch does, and it has no route to any of this.
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../env';
import { hub, type Caller } from './core';

/**
 * Workers RPC sends a thrown error (message and stack) to the caller. Never
 * let one out: log the message here and hand the game a typed failure.
 */
async function safe<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: 'unavailable' }> {
  try {
    return await fn();
  } catch (e) {
    console.error('HubService error', e instanceof Error ? e.message : String(e));
    return { ok: false, error: 'unavailable' };
  }
}

export class HubService extends WorkerEntrypoint<Env> {
  redeemHandoff(caller: Caller, token: string, bindValue: string) { return safe(() => hub.redeemHandoff(this.env, caller, token, bindValue)); }
  resolveSession(caller: Caller, gameSessionId: string) { return safe(() => hub.resolveSession(this.env, caller, gameSessionId)); }
  entitlement(caller: Caller, gameSessionId: string) { return safe(() => hub.entitlement(this.env, caller, gameSessionId)); }
  authorizeRound(caller: Caller) { return safe(() => hub.authorizeRound(this.env, caller)); }
  useTaste(caller: Caller, gameSessionId: string, mode: string) { return safe(() => hub.useTaste(this.env, caller, gameSessionId, mode)); }
  switchFreeMode(caller: Caller, gameSessionId: string, mode: string) { return safe(() => hub.switchFreeMode(this.env, caller, gameSessionId, mode)); }
  listLists(caller: Caller, gameSessionId: string) { return safe(() => hub.listLists(this.env, caller, gameSessionId)); }
  getList(caller: Caller, gameSessionId: string, listId: string) { return safe(() => hub.getList(this.env, caller, gameSessionId, listId)); }
  saveList(caller: Caller, gameSessionId: string, input: unknown) { return safe(() => hub.saveList(this.env, caller, gameSessionId, input)); }
  deleteList(caller: Caller, gameSessionId: string, listId: string) { return safe(() => hub.deleteList(this.env, caller, gameSessionId, listId)); }
  listClasses(caller: Caller, gameSessionId: string) { return safe(() => hub.listClasses(this.env, caller, gameSessionId)); }
  saveClass(caller: Caller, gameSessionId: string, input: unknown) { return safe(() => hub.saveClass(this.env, caller, gameSessionId, input)); }
  deleteClass(caller: Caller, gameSessionId: string, classId: string) { return safe(() => hub.deleteClass(this.env, caller, gameSessionId, classId)); }
  mintRoomPass(caller: Caller, gameSessionId: string, roomCode: string) { return safe(() => hub.mintRoomPass(this.env, caller, gameSessionId, roomCode)); }
  checkRoomPass(caller: Caller, passId: string) { return safe(() => hub.checkRoomPass(this.env, caller, passId)); }
  signOut(caller: Caller, gameSessionId: string) { return safe(() => hub.signOut(this.env, caller, gameSessionId)); }
}
