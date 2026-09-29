// RoomDO: one Durable Object per room code. A thin shell around the pure
// reducer in src/shared/dash.ts: it persists, checks player secrets, reads the
// clock, and keeps ONE alarm (round end or room expiry, whichever is first).
// Same shape as trace-race/src/worker/room-do.ts:
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
  markHeard,
  markServeFailed,
  nextRoundChars,
  nextAlarmAt,
  parseSkipInput,
  parseStrokeInput,
  publicView,
  setList,
  setOptions,
  skipWord,
  startRound,
  submitStroke,
  touch,
  wordToSay,
  type Result,
} from '../shared/dash';
import type { CharGeom, Mode, RoomState } from '../shared/types';
import type { Env } from './env';
import { loadGeometry, resolveWords } from './strokes';
import { speakWord } from './tts';
import { budgetConfig, ttsConfig, utcDay } from './env';

const KEY_STATE = 'state';
/** Word clips live in the room's own storage: the Cache API does nothing on workers.dev. */
const CLIP_PREFIX = 'clip:';
/** Verified stroke data for the characters of the list's rounds (server-only). */
const KEY_GEOM = 'geom';
/** This room's paid speech calls today. */
const KEY_TTS = 'ttsDay';
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
  /** Recent join times per IP (memory only, never stored): the per-IP anti-flood control. */
  private readonly joinsByIp = new Map<string, number[]>();
  private geom: Record<string, CharGeom> = {};
  /** This room's paid speech calls today, held in memory so a reservation never awaits (persisted on every change). */
  private ttsDay: { day: string; used: number } = { day: '', used: 0 };
  /** One synthesis per word at a time: 30 kids hearing a new word make ONE model call. */
  private readonly speaking = new Map<string, Promise<Response>>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {
    this.ctx.blockConcurrencyWhile(async () => {
      const [room, secrets, geom, ttsDay] = await Promise.all([
        this.ctx.storage.get<RoomState>(KEY_STATE),
        this.ctx.storage.get<Record<string, string>>(KEY_SECRETS),
        this.ctx.storage.get<Record<string, CharGeom>>(KEY_GEOM),
        this.ctx.storage.get<{ day: string; used: number }>(KEY_TTS),
      ]);
      this.ttsDay = ttsDay ?? { day: '', used: 0 };
      this.room = room ?? null;
      this.secrets = secrets ?? {};
      this.geom = geom ?? {};
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
    this.geom = {};
  }

  /** Makes sure the room holds verified stroke data for every character it needs. Returns an error message or null. */
  private async loadGeometryFor(chars: string[]): Promise<string | null> {
    const need = chars.filter((c) => !this.geom[c]);
    if (!need.length) return null;
    try {
      const loaded = await Promise.all(need.map((c) => loadGeometry(c, this.env)));
      const next = { ...this.geom };
      need.forEach((c, i) => (next[c] = loaded[i]));
      this.geom = next;
      await this.ctx.storage.put(KEY_GEOM, this.geom);
      return null;
    } catch {
      return 'the stroke data for these words did not load, please try again';
    }
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
    return json({ state: publicView(this.room!, viewerId, now, this.geom), serverTime: now, ...extra });
  }

  /** Applies a reducer result: an error becomes JSON, a change is saved. */
  private async apply(result: Result, viewerId: string): Promise<Response> {
    if (result.error) return json({ error: result.error, serverTime: Date.now() }, result.status ?? 409);
    if (result.state !== this.room) {
      this.room = result.state;
      await this.save();
    }
    return this.envelope(viewerId, result.verdict ? { verdict: result.verdict } : result.duplicate ? { duplicate: true } : {});
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
      // Per-IP flood control first (before the room's rate and fullness): one device cannot take many seats.
      const ip = request.headers.get('x-client-ip') ?? 'no-ip';
      const recent = (this.joinsByIp.get(ip) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= GAME.joinsPerIpPerMinute) return json({ error: 'too many joins from this device, wait a minute and try again' }, 429);
      const b = await body(request);
      const playerId = newPlayerId();
      const result = join(this.room, { id: playerId, name: String(b.name ?? ''), agent: b.agent === true }, now);
      if (result.error) return json({ error: result.error }, result.status ?? 409);
      this.joinsByIp.set(ip, [...recent, now]);
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
        if (url.searchParams.has('v') && Number.isFinite(v) && v === this.room.version) {
          response = json({ unchanged: true, nextPollMs: GAME.pollMs[this.room.phase], serverTime: Date.now() });
        } else {
          response = this.envelope(playerId);
        }
        break;
      }
      case 'say': {
        // Which word to speak. Only a player of the running round, only a word
        // they have reached, only with the round named: nobody can listen
        // ahead, and nothing outside a real round is sent to the speech model.
        // The first successful clip of the current word starts its clock.
        const index = Number(url.searchParams.get('w'));
        const prog = this.room.progress[playerId];
        const word = wordToSay(this.room, index);
        const round = url.searchParams.get('r');
        if (round === null || !/^\d{1,6}$/.test(round)) response = json({ error: 'say which round: ?r=<round>&w=<word>' }, 400);
        else if (Number(round) !== this.room.round) response = json({ error: 'that was for a different round' }, 409);
        else if (!prog) response = json({ error: 'only players of this round can hear its words' }, 403);
        else if (word === null) response = json({ error: 'no such word in this round' }, 404);
        else if (prog.finishedAt == null && index > prog.wordIndex) response = json({ error: 'that word is still coming' }, 409);
        else if (this.room.phase !== 'racing' || (this.room.goAt != null && now < this.room.goAt)) response = json({ error: 'wait for GO' }, 409);
        else {
          response = await this.clip(word, request);
          if (this.room) {
            // Served: the word's clock starts. Not served: Skip is allowed without hearing.
            const next = response.ok ? markHeard(this.room, playerId, index, Date.now()) : markServeFailed(this.room, playerId, index);
            if (next !== this.room) {
              this.room = next;
              await this.save();
            }
          }
        }
        break;
      }
      case 'budget': {
        // Readback: this room's paid speech calls today (any player of the room may look).
        response = json({ day: utcDay(now), used: this.ttsDay.day === utcDay(now) ? this.ttsDay.used : 0, limit: budgetConfig(this.env).roomDaily });
        break;
      }
      case 'start':
      case 'next': {
        // The room must hold verified stroke data before a round can start: it grades every stroke.
        const problem = playerId === this.room.hostId && this.room.phase !== 'racing' ? await this.loadGeometryFor(nextRoundChars(this.room)) : null;
        response = problem ? json({ error: problem }, 503) : await this.apply(startRound(this.room, playerId, Date.now()), playerId);
        break;
      }
      case 'list': {
        const b = await body(request);
        const text = typeof b.text === 'string' ? b.text : '';
        if (text.length > GAME.maxPasteLength) {
          response = json({ error: PASTE_TOO_LONG }, 400);
          break;
        }
        response = await this.apply(setList(this.room, playerId, resolveWords(text)), playerId);
        break;
      }
      case 'options':
        response = await this.apply(setOptions(this.room, playerId, await body(request)), playerId);
        break;
      case 'stroke': {
        const input = parseStrokeInput(await body(request));
        response = typeof input === 'string' ? json({ error: input }, 400) : await this.apply(submitStroke(this.room, playerId, input, this.geom, now), playerId);
        break;
      }
      case 'skip': {
        const input = parseSkipInput(await body(request));
        response = input ? await this.apply(skipWord(this.room, playerId, input, now), playerId) : json({ error: 'send race, seq and wordIndex' }, 400);
        break;
      }
      default:
        response = json({ error: 'unknown room action' }, 404);
    }
    await this.armAlarm(Date.now());
    return response;
  }

  /**
   * The audio for one word. Room storage first (keyed by the word, so every
   * kid and every round shares one clip), else ONE model call that everyone
   * asking for the same word waits on. Storage is cleared with the room.
   */
  private clip(word: string, request: Request): Promise<Response> {
    const running = this.speaking.get(word);
    if (running) return running.then((r) => r.clone());
    const storage = this.ctx.storage;
    const store = {
      async match(): Promise<Response | undefined> {
        const saved = await storage.get<{ bytes: ArrayBuffer }>(CLIP_PREFIX + word);
        return saved ? new Response(saved.bytes) : undefined;
      },
      async put(_key: Request, res: Response): Promise<void> {
        await storage.put(CLIP_PREFIX + word, { bytes: await res.arrayBuffer() });
      },
    } as unknown as Cache;
    const ip = request.headers.get('x-client-ip') ?? 'no-ip';
    const job = speakWord(word, ttsConfig(this.env), request.url, {
      ai: this.env.AI,
      cache: store,
      beforeAttempt: () => this.reserveSpeechCall(ip),
    }).finally(() => this.speaking.delete(word));
    this.speaking.set(word, job);
    return job.then((r) => r.clone());
  }

  /**
   * One paid model call may go ahead only if ALL of these say yes, and each
   * FAILS CLOSED (a missing binding, an error or a timeout means no): the
   * per-IP rate limit, this room's daily budget, the game's daily budget.
   */
  private async reserveSpeechCall(ip: string): Promise<boolean> {
    const limiter = this.env.TTS_LIMITER;
    const budgets = this.env.BUDGET;
    if (!limiter || !budgets) return false;
    const { roomDaily, globalDaily, ipDaily } = budgetConfig(this.env);
    // 1. The room's slot: read, check, increment and persist in ONE synchronous
    //    step (no await in between), so parallel misses for different words
    //    cannot both see the last free slot (Codex review round 2).
    const day = utcDay(Date.now());
    const used = this.ttsDay.day === day ? this.ttsDay.used : 0;
    if (used + 1 > roomDaily) return false;
    this.ttsDay = { day, used: used + 1 };
    void this.ctx.storage.put(KEY_TTS, this.ttsDay);
    const release = () => {
      if (this.ttsDay.day === day && this.ttsDay.used > 0) this.ttsDay = { day, used: this.ttsDay.used - 1 };
      void this.ctx.storage.put(KEY_TTS, this.ttsDay);
      return false;
    };
    // 2. The per-IP limiter, then the game's daily budget (and this IP's share of it). All fail closed.
    try {
      if (!(await limiter.limit({ key: ip })).success) return release();
      const global = await budgets
        .get(budgets.idFromName('global'))
        .fetch(new Request(`https://budget/reserve?limit=${globalDaily}&ipLimit=${ipDaily}&ip=${encodeURIComponent(ip)}`, { method: 'POST' }));
      if (!global.ok || !((await global.json()) as { ok?: boolean }).ok) return release();
      return true;
    } catch {
      return release();
    }
  }

  private async handleCreate(request: Request, now: number): Promise<Response> {
    if (this.room) return json({ error: 'code taken' }, 409);
    const b = await body(request);
    if (typeof b.text === 'string' && b.text.length > GAME.maxPasteLength) return json({ error: PASTE_TOO_LONG }, 400);
    const hostId = newPlayerId();
    const mode: Mode = b.mode === 'solo' ? 'solo' : 'class';
    const options = b.options && typeof b.options === 'object' ? (b.options as Record<string, unknown>) : undefined;
    this.room = createRoom(String(b.code ?? ''), { id: hostId, name: String(b.name ?? '') }, mode, options, resolveWords(typeof b.text === 'string' ? b.text : ''), now);
    this.secrets = { [hostId]: crypto.randomUUID() };
    await this.ctx.storage.put({ [KEY_STATE]: this.room, [KEY_SECRETS]: this.secrets });
    await this.armAlarm(now);
    return this.envelope(hostId, { code: this.room.code, playerId: hostId, playerSecret: this.secrets[hostId] });
  }
}
