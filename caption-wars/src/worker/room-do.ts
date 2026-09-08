// RoomDO: one Durable Object per room code.
//
// It is a thin shell around the pure reducer in src/shared/room.ts. Every game
// rule lives there; this file only does persistence, auth, the clock, and the
// one alarm.
//
// The five invariants the plan's amendments pin down, and where each is kept:
//
//   1. ONE alarm. Every re-arm goes through nextAlarmAt() (schedule.ts), which
//      returns the earliest of phaseEndsAt / expiresAt / the next bot job. No
//      other code calls setAlarm.
//   2. State loads ONCE, in the constructor under blockConcurrencyWhile, is held
//      in memory, and is written to storage immediately after every mutation.
//   3. No await between reading state and mutating it. Reducer calls are
//      synchronous; anything that awaits (photo fetch, model call) captures a
//      `{ phase, round, version }` stamp first and drops its result if the room
//      moved on.
//   4. Player secrets live in their own storage key and are never part of
//      RoomState, so they cannot leak through a state response.
//   5. Time is checked on every request (settle()), the alarm is only a backup.

import type { BotJob, Player, RoomState } from '../shared/types';
import {
  advance,
  advanceIfDue,
  dueBotJobs,
  enqueueBotJobs,
  orderedCaptions,
  publicView,
  setJobStatus,
  roundMatches,
  stampMatches,
  stampOf,
  submitCaption,
  submitVote,
  touch,
  createRoom,
  join,
  start,
  type StateStamp,
} from '../shared/room';
import { newCaptionId, newPlayerId } from '../shared/ids';
import { pickPersonas, PERSONAS, type Persona } from '../shared/personas';
import { settings, type Env, type Settings } from './env';
import { fetchPhoto } from './photo';
import { buildBotJobs, runBotJob, type BotHost, type BotModels } from './bots';
import { nextAlarmAt } from './schedule';

const KEY_STATE = 'state';
const KEY_SECRETS = 'secrets';
const KEY_PERSONAS = 'personas';
const photoKey = (round: number) => `photo:${round}`;

/** How stale a lastSeenAt may get on disk before a plain poll is worth a write. */
const LAST_SEEN_WRITE_MS = 15_000;

interface StoredPhoto {
  bytes: ArrayBuffer;
  contentType: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export class RoomDO implements DurableObject {
  private room: RoomState | null = null;
  private secrets: Record<string, string> = {};
  /** botId -> persona, so a bot's voice survives a DO restart. */
  private personas: Record<string, string> = {};
  private lastSeenWrittenAt = 0;
  private readonly set: Settings;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {
    this.set = settings(env);
    this.ctx.blockConcurrencyWhile(async () => {
      const [room, secrets, personas] = await Promise.all([
        this.ctx.storage.get<RoomState>(KEY_STATE),
        this.ctx.storage.get<Record<string, string>>(KEY_SECRETS),
        this.ctx.storage.get<Record<string, string>>(KEY_PERSONAS),
      ]);
      this.room = room ?? null;
      this.secrets = secrets ?? {};
      this.personas = personas ?? {};
    });
  }

  // --- persistence -----------------------------------------------------------

  private async save(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put(KEY_STATE, this.room);
  }

  private async armAlarm(now: number): Promise<void> {
    if (!this.room) return;
    const at = nextAlarmAt(this.room, now);
    if (at !== undefined) await this.ctx.storage.setAlarm(at);
  }

  private async destroy(): Promise<void> {
    // deleteAll() does not cancel a pending alarm, so an expired room would
    // otherwise keep waking a Durable Object that holds nothing.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.secrets = {};
    this.personas = {};
  }

  // --- clock -----------------------------------------------------------------

  /**
   * Runs every transition the clock says is due, fetching a photo when the next
   * round needs one. Called at the top of every request and from the alarm.
   */
  private async settle(now: number): Promise<void> {
    for (let pass = 0; pass < 3; pass++) {
      if (!this.room) return;

      const result = advanceIfDue(this.room, now, this.set.revealMinMs);
      if (result.state !== this.room) {
        this.room = result.state;
        await this.save();
        await this.syncBotJobs(now);
      }
      if (!result.needsPhoto || !this.room) return;

      // reveal -> next round: the photo is I/O, so stamp, fetch, re-check.
      const stamp = stampOf(this.room);
      const nextRound = this.room.round + 1;
      const photo = await this.loadPhoto(nextRound);
      if (!this.room || !stampMatches(this.room, stamp)) return;
      if (!photo) return; // could not load one; stay in reveal and retry on the next alarm

      const adv = advance(this.room, 'timer', now, photo, this.set.revealMinMs);
      if (adv.state === this.room) return;
      this.room = adv.state;
      await this.save();
      await this.syncBotJobs(now);
    }
  }

  // --- photos ----------------------------------------------------------------

  /** Fetches, stores, and rotates out the round's photo bytes. Returns its metadata. */
  private async loadPhoto(round: number) {
    if (!this.room) return null;
    try {
      const fetched = await fetchPhoto(this.set, this.room.code, round);
      const buffer = new ArrayBuffer(fetched.bytes.byteLength);
      new Uint8Array(buffer).set(fetched.bytes);
      await this.ctx.storage.put<StoredPhoto>(photoKey(round), {
        bytes: buffer,
        contentType: fetched.contentType,
      });
      // Only the newest two rounds of bytes are kept.
      if (round >= 3) await this.ctx.storage.delete(photoKey(round - 2));
      return fetched.meta;
    } catch (err) {
      console.error('photo: ', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private async photoBytes(round: number): Promise<Uint8Array | null> {
    const stored = await this.ctx.storage.get<StoredPhoto>(photoKey(round));
    if (!stored) return null;
    return new Uint8Array(stored.bytes);
  }

  // --- bots ------------------------------------------------------------------

  private personaFor(botId: string): Persona | undefined {
    const id = this.personas[botId];
    return PERSONAS.find((p) => p.id === id);
  }

  /** Adds this phase's bot jobs exactly once per round+phase. Idempotent. */
  private async syncBotJobs(now: number): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (room.phase !== 'caption' && room.phase !== 'vote') return;

    const already = room.botJobs.some((j) => j.round === room.round && j.phase === room.phase);
    if (already) return;

    const jobs = buildBotJobs(room, room.phase, now, this.set.botTimeoutMs, () =>
      crypto.randomUUID()
    );
    if (jobs.length === 0) return;

    this.room = enqueueBotJobs(room, jobs);
    await this.save();
  }

  private botModels(): BotModels {
    return {
      ai: this.env.AI as unknown as BotModels['ai'],
      visionModel: this.set.visionModel,
      visionModelFallback: this.set.visionModelFallback,
      textModel: this.set.textModel,
      timeoutMs: this.set.botTimeoutMs,
    };
  }

  private botHost(): BotHost {
    return {
      stamp: () => stampOf(this.room!),
      photoBytes: (round) => this.photoBytes(round),
      persona: (botId) => this.personaFor(botId),
      voteOptions: (botId) => {
        const room = this.room;
        if (!room) return [];
        return orderedCaptions(room)
          .filter((c) => c.playerId !== botId)
          .map((c) => ({ id: c.id, text: c.text }));
      },
      applyCaption: async (botId, text, expect) => this.applyBotCaption(botId, text, expect),
      applyVote: async (botId, captionId, expect) => this.applyBotVote(botId, captionId, expect),
    };
  }

  /** Synchronous read + reducer + assignment, then the write. No await in between. */
  private async applyBotCaption(
    botId: string,
    text: string,
    expect: StateStamp
  ): Promise<boolean> {
    const room = this.room;
    if (!room || !roundMatches(room, expect)) return false;
    const result = submitCaption(room, botId, text, newCaptionId(), Date.now());
    if (result.error) return false;
    this.room = result.state;
    await this.save();
    return true;
  }

  private async applyBotVote(
    botId: string,
    captionId: string,
    expect: StateStamp
  ): Promise<boolean> {
    const room = this.room;
    if (!room || !roundMatches(room, expect)) return false;
    const result = submitVote(room, botId, captionId, Date.now());
    if (result.error) return false;
    this.room = result.state;
    await this.save();
    return true;
  }

  /** Runs every due bot job. Failures are logged and dropped; nobody waits on them. */
  private async runDueBotJobs(now: number): Promise<void> {
    const room = this.room;
    if (!room) return;
    const due = dueBotJobs(room, now);
    if (due.length === 0) return;

    // Mark running first so a second alarm cannot double-run the same job.
    let marked = room;
    for (const job of due) marked = setJobStatus(marked, job.jobId, 'running');
    this.room = marked;
    await this.save();

    const models = this.botModels();
    const host = this.botHost();
    const outcomes = await Promise.all(
      due.map(async (job: BotJob) => ({ job, outcome: await runBotJob(job, models, host) }))
    );

    if (!this.room) return;
    let next = this.room;
    for (const { job, outcome } of outcomes) next = setJobStatus(next, job.jobId, outcome);
    this.room = next;
    await this.save();
  }

  // --- alarm -----------------------------------------------------------------

  async alarm(): Promise<void> {
    const now = Date.now();
    if (this.room && now >= this.room.expiresAt) {
      await this.destroy();
      return;
    }

    await this.settle(now);
    await this.runDueBotJobs(Date.now());
    // A bot's own caption can complete the roster and flip the phase, which
    // means the next phase's jobs still need enqueueing before we settle again.
    await this.syncBotJobs(Date.now());
    await this.settle(Date.now());
    await this.armAlarm(Date.now());
  }

  // --- auth ------------------------------------------------------------------

  /** Returns the player id when the caller proves membership, else null. */
  private authenticate(request: Request): string | null {
    const id = request.headers.get('x-player-id');
    const secret = request.headers.get('x-player-secret');
    if (!id || !secret) return null;
    const known = this.secrets[id];
    if (!known || known !== secret) return null;
    return id;
  }

  // --- responses -------------------------------------------------------------

  private envelope(viewerId: string, extra: Record<string, unknown> = {}): Response {
    const now = Date.now();
    return json({ state: publicView(this.room!, viewerId, now), serverTime: now, ...extra });
  }

  // --- HTTP ------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const now = Date.now();

    if (path === 'create') return this.handleCreate(request, now);

    if (this.room && now >= this.room.expiresAt) await this.destroy();
    if (!this.room) return json({ error: 'that room is not around any more' }, 404);

    // The photo bytes are the only route a browser reaches with an <img> tag,
    // which cannot send headers. Rather than push a room secret into a URL
    // (which would then sit in logs and history), this route is open to anyone
    // who knows the room code: the bytes are a public internet photo, and the
    // room state behind it still needs both headers.
    const photoMatch = path.match(/^photo\/(\d+)$/);
    if (photoMatch) return this.handlePhoto(Number(photoMatch[1]));

    if (path === 'join') return this.handleJoin(request, now);

    const playerId = this.authenticate(request);
    if (!playerId) return json({ error: 'not a player in this room' }, 403);

    this.room = touch(this.room, playerId, now);
    if (now - this.lastSeenWrittenAt > LAST_SEEN_WRITE_MS) {
      this.lastSeenWrittenAt = now;
      await this.save();
    }

    await this.settle(now);
    if (!this.room) return json({ error: 'that room is not around any more' }, 404);

    switch (path) {
      case 'state':
        return this.handleState(url, playerId);
      case 'start':
        return this.handleStart(playerId, now);
      case 'caption':
        return this.handleCaption(request, playerId);
      case 'vote':
        return this.handleVote(request, playerId);
      case 'next':
        return this.handleNext(playerId);
      default:
        return json({ error: 'unknown room action' }, 404);
    }
  }

  private async handleCreate(request: Request, now: number): Promise<Response> {
    if (this.room) return json({ error: 'code taken' }, 409); // the worker draws another code

    const body = (await request.json()) as {
      code: string;
      name: string;
      options?: Record<string, number>;
    };

    const hostId = newPlayerId();
    const chosen = pickPersonas(Number(body.options?.botCount ?? 2));
    const bots: Player[] = chosen.map((persona) => ({
      id: newPlayerId(),
      name: persona.name,
      isBot: true,
      score: 0,
      lastSeenAt: now,
    }));

    const room = createRoom(body.code, { id: hostId, name: body.name }, body.options, bots, now);
    if (room.players[0].name.length === 0) return json({ error: 'name required' }, 400);

    // normalizeOptions may have clamped botCount below what we just built.
    const keep = room.options.botCount;
    room.players = [room.players[0], ...bots.slice(0, keep)];

    this.room = room;
    this.secrets = { [hostId]: crypto.randomUUID() };
    this.personas = Object.fromEntries(
      bots.slice(0, keep).map((bot, i) => [bot.id, chosen[i].id])
    );

    await this.ctx.storage.put({
      [KEY_STATE]: this.room,
      [KEY_SECRETS]: this.secrets,
      [KEY_PERSONAS]: this.personas,
    });
    await this.armAlarm(now);

    return this.envelope(hostId, {
      code: room.code,
      playerId: hostId,
      playerSecret: this.secrets[hostId],
    });
  }

  private async handleJoin(request: Request, now: number): Promise<Response> {
    await this.settle(now);
    if (!this.room) return json({ error: 'that room is not around any more' }, 404);

    const body = (await request.json()) as { name?: string };
    const playerId = newPlayerId();
    const result = join(this.room, { id: playerId, name: String(body.name ?? '') }, now);
    if (result.error) return json({ error: result.error }, 409);

    this.room = result.state;
    const secret = crypto.randomUUID();
    this.secrets = { ...this.secrets, [playerId]: secret };
    await this.ctx.storage.put({ [KEY_STATE]: this.room, [KEY_SECRETS]: this.secrets });
    await this.armAlarm(now);

    return this.envelope(playerId, { playerId, playerSecret: secret });
  }

  private async handleStart(playerId: string, now: number): Promise<Response> {
    const room = this.room!;
    if (room.phase !== 'lobby') return json({ error: 'this game already started' }, 409);
    if (playerId !== room.hostId) return json({ error: 'only the host can start' }, 403);

    // The photo is I/O, so stamp before and re-check after.
    const stamp = stampOf(room);
    const photo = await this.loadPhoto(1);
    if (!photo) return json({ error: 'could not load a photo, try again' }, 502);
    if (!this.room || !stampMatches(this.room, stamp)) {
      return json({ error: 'this game already started' }, 409);
    }

    const result = start(this.room, playerId, photo, Date.now());
    if (result.error) return json({ error: result.error }, 409);
    this.room = result.state;
    await this.save();
    await this.syncBotJobs(Date.now());
    await this.armAlarm(Date.now());
    return this.envelope(playerId);
  }

  private async handleCaption(request: Request, playerId: string): Promise<Response> {
    const body = (await request.json()) as { text?: string };
    const result = submitCaption(
      this.room!,
      playerId,
      String(body.text ?? ''),
      newCaptionId(),
      Date.now()
    );
    if (result.error) return json({ error: result.error }, 409);
    this.room = result.state;
    await this.save();
    await this.syncBotJobs(Date.now());
    await this.armAlarm(Date.now());
    return this.envelope(playerId);
  }

  private async handleVote(request: Request, playerId: string): Promise<Response> {
    const body = (await request.json()) as { captionId?: string };
    const result = submitVote(this.room!, playerId, String(body.captionId ?? ''), Date.now());
    if (result.error) return json({ error: result.error }, 409);
    this.room = result.state;
    await this.save();
    await this.armAlarm(Date.now());
    return this.envelope(playerId);
  }

  private async handleNext(playerId: string): Promise<Response> {
    const room = this.room!;
    if (room.phase !== 'reveal') return json({ error: 'nothing to move on from' }, 409);

    const dryRun = advance(room, playerId, Date.now(), undefined, this.set.revealMinMs);
    if (dryRun.error) return json({ error: dryRun.error }, 403);

    let photo;
    if (dryRun.needsPhoto) {
      const stamp = stampOf(room);
      photo = await this.loadPhoto(room.round + 1);
      if (!photo) return json({ error: 'could not load a photo, try again' }, 502);
      if (!this.room || !stampMatches(this.room, stamp)) return this.envelope(playerId);
    }

    const result = advance(this.room!, playerId, Date.now(), photo, this.set.revealMinMs);
    if (result.error) return json({ error: result.error }, 403);
    this.room = result.state;
    await this.save();
    await this.syncBotJobs(Date.now());
    await this.armAlarm(Date.now());
    return this.envelope(playerId);
  }

  private handleState(url: URL, playerId: string): Response {
    const room = this.room!;
    const seen = Number(url.searchParams.get('v'));
    if (Number.isFinite(seen) && seen === room.version) {
      return json({
        unchanged: true,
        version: room.version,
        nextPollMs: room.nextPollMs,
        serverTime: Date.now(),
      });
    }
    return this.envelope(playerId);
  }

  private async handlePhoto(round: number): Promise<Response> {
    const stored = await this.ctx.storage.get<StoredPhoto>(photoKey(round));
    if (!stored) return json({ error: 'no photo for that round' }, 404);
    return new Response(stored.bytes, {
      headers: {
        'Content-Type': stored.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }
}
