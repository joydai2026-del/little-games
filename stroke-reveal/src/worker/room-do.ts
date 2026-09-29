// RoomDO: one Durable Object per room code. A thin shell around the pure
// reducer in src/shared/reveal.ts: it persists, checks player secrets, reads the
// clock, and keeps ONE alarm (the next timeline moment or room expiry, whichever is first).
//
// Rules kept from Caption Wars:
//   - State loads once in the constructor and is written after every change.
//   - No await between reading state and changing it (the reducer is sync).
//   - Secrets live in their own storage key, never inside RoomState.
//   - The clock is checked on every request; the alarm is only a backup.

import { GAME } from '../shared/config';
import { newPlayerId } from '../shared/ids';
import {
  advanceIfDue,
  createRoom,
  join,
  nextAlarmAt,
  parseGuessInput,
  publicView,
  setList,
  setOptions,
  startRound,
  strokesShown,
  submitGuess,
  touch,
  type Result,
} from '../shared/reveal';
import type { RoomState } from '../shared/types';
import type { Env } from './env';
import { resolveList } from './strokes';

const KEY_STATE = 'state';
const KEY_SECRETS = 'secrets';
const ROOM_GONE = 'that room is not around any more';
const PASTE_TOO_LONG = `That paste is too long. Paste a shorter list (up to ${GAME.maxPasteLength} characters).`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class RoomDO implements DurableObject {
  private room: RoomState | null = null;
  private secrets: Record<string, string> = {};
  private lastSeenWrittenAt = 0;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {
    this.ctx.blockConcurrencyWhile(async () => {
      const [room, secrets] = await Promise.all([
        this.ctx.storage.get<RoomState>(KEY_STATE),
        this.ctx.storage.get<Record<string, string>>(KEY_SECRETS),
      ]);
      this.room = room ?? null;
      this.secrets = secrets ?? {};
    });
  }

  private async save(): Promise<void> {
    if (this.room) await this.ctx.storage.put(KEY_STATE, this.room);
  }

  private async armAlarm(now: number): Promise<void> {
    if (this.room) await this.ctx.storage.setAlarm(nextAlarmAt(this.room, now));
  }

  private async destroy(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.secrets = {};
  }

  private async settle(now: number): Promise<void> {
    if (!this.room) return;
    const next = advanceIfDue(this.room, now);
    if (next !== this.room) {
      this.room = next;
      await this.save();
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    if (this.room && now >= this.room.expiresAt) {
      await this.destroy();
      return;
    }
    await this.settle(now);
    await this.armAlarm(Date.now());
  }

  private authenticate(request: Request): string | null {
    const id = request.headers.get('x-player-id');
    const secret = request.headers.get('x-player-secret');
    if (!id || !secret) return null;
    const known = this.secrets[id];
    return known && known === secret ? id : null;
  }

  private envelope(viewerId: string, extra: Record<string, unknown> = {}): Response {
    const now = Date.now();
    return json({ state: publicView(this.room!, viewerId, now), serverTime: now, ...extra });
  }

  /** Applies a reducer result: an error becomes JSON, a change is saved. */
  private async apply(result: Result, viewerId: string): Promise<Response> {
    if (result.error) return json({ error: result.error, serverTime: Date.now() }, result.status ?? 409);
    if (result.state !== this.room) {
      this.room = result.state;
      await this.save();
    }
    return this.envelope(viewerId);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const now = Date.now();

    if (path === 'create') return this.handleCreate(request, now);

    if (this.room && now >= this.room.expiresAt) await this.destroy();
    if (!this.room) return json({ error: ROOM_GONE }, 404);

    if (path === 'join') {
      await this.settle(now);
      const b = await body(request);
      const playerId = newPlayerId();
      const result = join(this.room, { id: playerId, name: String(b.name ?? ''), agent: b.agent === true }, now);
      if (result.error) return json({ error: result.error }, result.status ?? 409);
      this.room = result.state;
      const secret = crypto.randomUUID();
      this.secrets = { ...this.secrets, [playerId]: secret };
      await this.ctx.storage.put({ [KEY_STATE]: this.room, [KEY_SECRETS]: this.secrets });
      await this.armAlarm(now);
      return this.envelope(playerId, { playerId, playerSecret: secret });
    }

    const playerId = this.authenticate(request);
    if (!playerId) return json({ error: 'not a player in this room' }, 403);

    this.room = touch(this.room, playerId, now);
    if (now - this.lastSeenWrittenAt > GAME.lastSeenWriteMs) {
      this.lastSeenWrittenAt = now;
      await this.save();
    }
    await this.settle(now);

    let response: Response;
    switch (path) {
      case 'state': {
        const v = Number(url.searchParams.get('v'));
        if (Number.isFinite(v) && v === this.room.version) {
          const nextPollMs = GAME.pollMs[this.room.phase];
          response = json({ unchanged: true, nextPollMs, serverTime: Date.now() });
        } else {
          response = this.envelope(playerId);
        }
        break;
      }
      case 'start':
      case 'next':
        response = await this.apply(startRound(this.room, playerId, now, Math.random), playerId);
        break;
      case 'drawing': {
        // INTERNAL: only the Worker's /drawing route calls this, and it strips
        // `char` after loading the stroke paths. Never returned to a phone.
        const r = this.room;
        const shown = strokesShown(r, now);
        const q = r.questions[r.qIndex];
        response = json({
          round: r.round,
          question: r.phase === 'lobby' ? null : r.qIndex,
          shown,
          complete: Boolean(q) && shown >= q.strokes,
          char: shown > 0 && q ? q.char : null,
          serverTime: now,
        });
        break;
      }
      case 'list': {
        const b = await body(request);
        const text = typeof b.text === 'string' ? b.text : '';
        if (text.length > GAME.maxPasteLength) {
          response = json({ error: PASTE_TOO_LONG }, 400);
          break;
        }
        response = await this.apply(setList(this.room, playerId, resolveList(text)), playerId);
        break;
      }
      case 'options': {
        const b = await body(request);
        response = await this.apply(setOptions(this.room, playerId, b), playerId);
        break;
      }
      case 'guess': {
        const input = parseGuessInput(await body(request));
        if (!input) {
          response = json({ error: 'send race, question, seq and card (whole numbers)' }, 400);
          break;
        }
        response = await this.apply(submitGuess(this.room, playerId, input, now), playerId);
        break;
      }
      default:
        response = json({ error: 'unknown room action' }, 404);
    }
    await this.armAlarm(Date.now());
    return response;
  }

  private async handleCreate(request: Request, now: number): Promise<Response> {
    if (this.room) return json({ error: 'code taken' }, 409);
    const b = await body(request);
    if (typeof b.text === 'string' && b.text.length > GAME.maxPasteLength) return json({ error: PASTE_TOO_LONG }, 400);
    const hostId = newPlayerId();
    const options = b.options && typeof b.options === 'object' ? (b.options as Record<string, unknown>) : undefined;
    this.room = createRoom(
      String(b.code ?? ''),
      { id: hostId, name: String(b.name ?? '') },
      options as never,
      resolveList(typeof b.text === 'string' ? b.text : ''),
      now
    );
    this.secrets = { [hostId]: crypto.randomUUID() };
    await this.ctx.storage.put({ [KEY_STATE]: this.room, [KEY_SECRETS]: this.secrets });
    await this.armAlarm(now);
    return this.envelope(hostId, { code: this.room.code, playerId: hostId, playerSecret: this.secrets[hostId] });
  }
}
