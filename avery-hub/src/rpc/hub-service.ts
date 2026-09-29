// HubService: the named RPC entrypoint games reach through a service binding
// ("entrypoint": "HubService"). A named entrypoint gets no internet traffic;
// only the default export's fetch does, and it has no route to any of this.
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../env';
import { hub, type Caller } from './core';

import { ALERT_TAG } from '../alert';
export { ALERT_TAG };

/**
 * Workers RPC sends a thrown error (message and stack) to the caller. Never
 * let one out: log it with the alert tag (an internal error is a bug to look
 * at, unlike the hub simply being unreachable, which the game sees as a thrown
 * RPC call) and hand the game a typed failure.
 */
async function safe<T>(method: string, fn: () => Promise<T>): Promise<T | { ok: false; error: 'unavailable' }> {
  try {
    return await fn();
  } catch (e) {
    console.error(`${ALERT_TAG} HubService.${method} internal error: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: 'unavailable' };
  }
}

export class HubService extends WorkerEntrypoint<Env> {
  redeemHandoff(caller: Caller, token: string, bindValue: string) { return safe('redeemHandoff', () => hub.redeemHandoff(this.env, caller, token, bindValue)); }
  resolveSession(caller: Caller, gameSessionId: string) { return safe('resolveSession', () => hub.resolveSession(this.env, caller, gameSessionId)); }
  entitlement(caller: Caller, gameSessionId: string) { return safe('entitlement', () => hub.entitlement(this.env, caller, gameSessionId)); }
  authorizeRound(caller: Caller) { return safe('authorizeRound', () => hub.authorizeRound(this.env, caller)); }
  useTaste(caller: Caller, gameSessionId: string, mode: string) { return safe('useTaste', () => hub.useTaste(this.env, caller, gameSessionId, mode)); }
  switchFreeMode(caller: Caller, gameSessionId: string, mode: string) { return safe('switchFreeMode', () => hub.switchFreeMode(this.env, caller, gameSessionId, mode)); }
  listLists(caller: Caller, gameSessionId: string) { return safe('listLists', () => hub.listLists(this.env, caller, gameSessionId)); }
  getList(caller: Caller, gameSessionId: string, listId: string) { return safe('getList', () => hub.getList(this.env, caller, gameSessionId, listId)); }
  saveList(caller: Caller, gameSessionId: string, input: unknown) { return safe('saveList', () => hub.saveList(this.env, caller, gameSessionId, input)); }
  deleteList(caller: Caller, gameSessionId: string, listId: string) { return safe('deleteList', () => hub.deleteList(this.env, caller, gameSessionId, listId)); }
  listClasses(caller: Caller, gameSessionId: string) { return safe('listClasses', () => hub.listClasses(this.env, caller, gameSessionId)); }
  saveClass(caller: Caller, gameSessionId: string, input: unknown) { return safe('saveClass', () => hub.saveClass(this.env, caller, gameSessionId, input)); }
  deleteClass(caller: Caller, gameSessionId: string, classId: string) { return safe('deleteClass', () => hub.deleteClass(this.env, caller, gameSessionId, classId)); }
  mintRoomPass(caller: Caller, gameSessionId: string, roomCode: string) { return safe('mintRoomPass', () => hub.mintRoomPass(this.env, caller, gameSessionId, roomCode)); }
  checkRoomPass(caller: Caller, passId: string) { return safe('checkRoomPass', () => hub.checkRoomPass(this.env, caller, passId)); }
  signOut(caller: Caller, gameSessionId: string) { return safe('signOut', () => hub.signOut(this.env, caller, gameSessionId)); }
}
