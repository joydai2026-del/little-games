// HubService: the named RPC entrypoint games reach through a service binding
// ("entrypoint": "HubService"). A named entrypoint gets no internet traffic;
// only the default export's fetch does, and it has no route to any of this.
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../env';
import { hub, type Caller } from './core';

export class HubService extends WorkerEntrypoint<Env> {
  redeemHandoff(caller: Caller, token: string, bindValue: string) { return hub.redeemHandoff(this.env, caller, token, bindValue); }
  resolveSession(caller: Caller, gameSessionId: string) { return hub.resolveSession(this.env, caller, gameSessionId); }
  entitlement(caller: Caller, gameSessionId: string) { return hub.entitlement(this.env, caller, gameSessionId); }
  authorizeRound(caller: Caller) { return hub.authorizeRound(this.env, caller); }
  useTaste(caller: Caller, gameSessionId: string, mode: string) { return hub.useTaste(this.env, caller, gameSessionId, mode); }
  switchFreeMode(caller: Caller, gameSessionId: string, mode: string) { return hub.switchFreeMode(this.env, caller, gameSessionId, mode); }
  listLists(caller: Caller, gameSessionId: string) { return hub.listLists(this.env, caller, gameSessionId); }
  getList(caller: Caller, gameSessionId: string, listId: string) { return hub.getList(this.env, caller, gameSessionId, listId); }
  saveList(caller: Caller, gameSessionId: string, input: unknown) { return hub.saveList(this.env, caller, gameSessionId, input); }
  deleteList(caller: Caller, gameSessionId: string, listId: string) { return hub.deleteList(this.env, caller, gameSessionId, listId); }
  listClasses(caller: Caller, gameSessionId: string) { return hub.listClasses(this.env, caller, gameSessionId); }
  saveClass(caller: Caller, gameSessionId: string, input: unknown) { return hub.saveClass(this.env, caller, gameSessionId, input); }
  deleteClass(caller: Caller, gameSessionId: string, classId: string) { return hub.deleteClass(this.env, caller, gameSessionId, classId); }
  mintRoomPass(caller: Caller, gameSessionId: string, roomCode: string) { return hub.mintRoomPass(this.env, caller, gameSessionId, roomCode); }
  checkRoomPass(caller: Caller, passId: string) { return hub.checkRoomPass(this.env, caller, passId); }
  signOut(caller: Caller, gameSessionId: string) { return hub.signOut(this.env, caller, gameSessionId); }
}
