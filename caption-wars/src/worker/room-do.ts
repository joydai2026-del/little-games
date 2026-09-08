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
//
// Two rules the first review round added:
//
//   6. Photo bytes are fetched BEFORE anything is written, through one shared
//      in-flight promise per round, and the bytes land in storage immediately
//      before the state that names them. Two concurrent settles can never leave
//      state naming photo A while storage holds B.
//   7. Every path out of fetch() re-arms the alarm exactly once, at the end.
//      A plain GET can advance the room, so a GET must re-arm too.
//
// And three the second round added:
//
//   8. Every clock read AFTER an await is fresh. A slow photo download must not
//      set a retry backoff in the past, nor open a round with a short timer.
//   9. The reducer runs on the state as it is after the last await, never on a
//      copy read before it: a `join` landing in that window would otherwise be
//      erased from `players` while its secret survived in `secrets`.
//  10. A rollover that cannot get a photo is bounded on EVERY path, the host's
//      Next included: it backs off, and ends the game after PHOTO_MAX_ATTEMPTS.

import type { BotJob, PhotoMeta, Player, RoomOptions, RoomState } from '../shared/types';
import {
  advance,
  advanceIfDue,
  clearSpentLobbyPhotoRetry,
  dueBotJobs,
  enqueueBotJobs,
  markJobsRunning,
  noteAiOffline,
  notePhotoFailure,
  orderedCaptions,
  photoRetryBlocked,
  publicView,
  reapBotJobs,
  setJobStatus,
  roundMatches,
  stampOf,
  submitCaption,
  submitVote,
  touch,
  createRoom,
  join,
  start,
  type StateStamp,
} from '../shared/room';
import { normalizeOptions } from '../shared/config';
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

/** A photo that has been fetched but not yet written anywhere. */
interface PendingPhoto {
  meta: PhotoMeta;
  bytes: ArrayBuffer;
  contentType: string;
}

/** The body both photo 404s use, so the route cannot be used to probe room codes. */
const ROOM_GONE = 'that room is not around any more';

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
  /** One in-flight photo fetch per round, so concurrent settles share one download. */
  private readonly photoFetches = new Map<number, Promise<PendingPhoto | null>>();
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
    await this.reapJobs(now);

    // A spent backoff in the LOBBY has no consumer, so it is dropped here rather
    // than left to spin the alarm and to show the host a countdown that has
    // already run out. No version bump: the value it removes is one the view
    // already renders as zero. See clearSpentLobbyPhotoRetry.
    if (this.room) {
      const tidied = clearSpentLobbyPhotoRetry(this.room, now);
      if (tidied !== this.room) {
        this.room = tidied;
        await this.save();
      }
    }

    for (let pass = 0; pass < 3; pass++) {
      if (!this.room) return;

      const result = advanceIfDue(this.room, now, this.set.revealMinMs);
      if (result.state !== this.room) {
        this.room = result.state;
        await this.save();
        await this.syncBotJobs(now);
      }
      if (!result.needsPhoto || !this.room) return;

      // A previous fetch failed and its backoff has not run out: do nothing,
      // the alarm is already set for the retry moment.
      if (photoRetryBlocked(this.room, now)) return;

      // reveal -> next round: the photo is I/O, so stamp, fetch, re-check, and
      // only then write the bytes and the state that names them.
      const stamp = stampOf(this.room);
      const nextRound = this.room.round + 1;
      const pending = await this.fetchPhotoOnce(nextRound);
      // The clock moved while the photo downloaded. Every decision below uses
      // the time AFTER the await, never the stale `now`: a 6-second download
      // measured against the old clock would put the retry backoff in the past
      // (so the alarm re-fires instantly) and would open the next round with a
      // caption timer already 6 seconds short.
      const settledAt = Date.now();
      if (!this.room) return;

      if (!pending) {
        // Both image hosts are down. Back off, and after a few tries end the
        // game honestly instead of spinning the alarm on a dead fetch.
        // Phase and round, not version: a player joining during the failed
        // fetch must not swallow the attempt, or a dead host never runs out of
        // tries while anyone is arriving.
        if (!roundMatches(this.room, stamp)) return; // somebody else moved the room on
        const failed = notePhotoFailure(this.room, settledAt);
        this.room = failed.state;
        await this.save();
        return;
      }

      // Bytes first, then the state that names them, so no client can ever ask
      // for a photo the room has already announced.
      if (!roundMatches(this.room, stamp)) return; // already past this rollover
      await this.commitPhotoBytes(nextRound, pending);
      // Re-read AFTER that write. The room is still in the same phase and round
      // (another settle would have moved it), but a concurrent `join` mutates
      // `this.room` inside exactly this window, and computing the transition
      // from the pre-await copy would erase the joiner from `players` while
      // their secret survived: they would authenticate and then be told they
      // are not in the room. So the reducer runs on the FRESH state, with no
      // await between this check and the assignment (amendment 9).
      if (!this.room || !roundMatches(this.room, stamp)) {
        await this.discardOrphanPhoto(nextRound);
        return;
      }
      const adv = advance(this.room, 'timer', Date.now(), pending.meta, this.set.revealMinMs);
      if (adv.state === this.room) {
        await this.discardOrphanPhoto(nextRound);
        return;
      }
      this.room = adv.state;
      await this.save();
      await this.syncBotJobs(Date.now());
    }
  }

  // --- photos ----------------------------------------------------------------

  /**
   * Downloads the round's photo. Writes NOTHING: the caller re-checks its state
   * stamp first and then calls commitPhotoBytes, so a duplicate Start/Next can
   * never leave `photo.sha256` in state pointing at bytes another request
   * overwrote.
   *
   * One in-flight promise per round, shared by every concurrent caller, so two
   * settles racing the same rollover download once and agree on the result.
   */
  private fetchPhotoOnce(round: number): Promise<PendingPhoto | null> {
    const existing = this.photoFetches.get(round);
    if (existing) return existing;

    const promise = this.downloadPhoto(round);
    this.photoFetches.set(round, promise);
    void promise.then(
      () => {
        if (this.photoFetches.get(round) === promise) this.photoFetches.delete(round);
      },
      () => {
        if (this.photoFetches.get(round) === promise) this.photoFetches.delete(round);
      }
    );
    return promise;
  }

  /** The download itself. Never throws: a failure is null, which the caller backs off on. */
  private async downloadPhoto(round: number): Promise<PendingPhoto | null> {
    const code = this.room?.code;
    if (!code) return null;
    try {
      const fetched = await fetchPhoto(this.set, code, round);
      const buffer = new ArrayBuffer(fetched.bytes.byteLength);
      new Uint8Array(buffer).set(fetched.bytes);
      return { meta: fetched.meta, bytes: buffer, contentType: fetched.contentType };
    } catch (err) {
      console.error('photo: ', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Writes the fetched bytes, then rotates old rounds out. Called immediately
   * before the state that names them is saved, so the bytes are always on disk
   * by the time any client can ask for them.
   */
  private async commitPhotoBytes(round: number, pending: PendingPhoto): Promise<void> {
    await this.ctx.storage.put<StoredPhoto>(photoKey(round), {
      bytes: pending.bytes,
      contentType: pending.contentType,
    });
    // Only the newest two rounds of bytes are kept.
    if (round >= 3) await this.ctx.storage.delete(photoKey(round - 2));
  }

  /**
   * Drops bytes written for a rollover that then bailed out.
   *
   * Bytes are committed BEFORE the reducer runs (rule 6), so a bail-out on the
   * final re-check leaves a `photo:<round>` for a round the room never opened.
   * They were harmless (identical bytes, overwritten at the real rollover, and
   * `deleteAll()` takes them with the room), but nothing is served from a round
   * the room never entered, so they are simply rubbish.
   *
   * Deliberately conservative: it only removes bytes for a round AHEAD of the
   * live one that the live state does not name. Rotation of older rounds stays
   * with commitPhotoBytes.
   */
  private async discardOrphanPhoto(round: number): Promise<void> {
    if (this.room && (this.room.photo?.round === round || this.room.round >= round)) return;
    await this.ctx.storage.delete(photoKey(round));
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

  private botModels(onAiOffline?: (message: string) => void): BotModels {
    return {
      ai: this.env.AI as unknown as BotModels['ai'],
      ...(onAiOffline ? { onAiOffline } : {}),
      visionModel: this.set.visionModel,
      visionModelFallback: this.set.visionModelFallback,
      textModel: this.set.textModel,
      timeoutMs: this.set.botTimeoutMs,
      judgeTimeoutMs: this.set.captionJudgeTimeoutMs,
      visionMaxBytes: this.set.visionMaxBytes,
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

  /**
   * Closes out every job whose deadline has passed. A job left `running` by a
   * Durable Object that died mid-model-call is otherwise never retried and never
   * recorded, so the room's job list would never converge.
   */
  private async reapJobs(now: number): Promise<void> {
    if (!this.room) return;
    const reaped = reapBotJobs(this.room, now);
    if (reaped === this.room) return;
    this.room = reaped;
    await this.save();
  }

  /** Runs every due bot job. Failures are logged and dropped; nobody waits on them. */
  private async runDueBotJobs(now: number): Promise<void> {
    const room = this.room;
    if (!room) return;
    const due = dueBotJobs(room, now);
    if (due.length === 0) return;

    // Take the lease first (status `running` plus `startedAt`) so a second alarm
    // cannot double-run the same job, and so a job abandoned by a dying DO can
    // be recognised and failed later by reapBotJobs.
    this.room = markJobsRunning(room, due.map((job) => job.jobId), now);
    await this.save();

    // THE WALL, not a hiccup (review round 7, must-fix 1; plan rule 55). Every
    // model call in this batch reports an account-level Workers AI error through
    // this one flag, and the room reacts ONCE, after the batch, through the
    // reducer. Four bots meeting the same wall in the same second is the normal
    // case, and `noteAiOffline` is idempotent so that costs one version bump.
    let sawAiOffline = false;
    const models = this.botModels(() => {
      sawAiOffline = true;
    });
    const host = this.botHost();
    const outcomes = await Promise.all(
      due.map(async (job: BotJob) => ({ job, outcome: await runBotJob(job, models, host) }))
    );

    if (!this.room) return;
    let next = this.room;
    for (const { job, outcome } of outcomes) next = setJobStatus(next, job.jobId, outcome);
    this.room = next;
    await this.save();

    if (!sawAiOffline || !this.room) return;
    // After the statuses, so the reason lands on jobs this batch has already
    // closed out rather than racing them.
    const noted = noteAiOffline(this.room, Date.now());
    if (noted.state === this.room) return;
    this.room = noted.state;
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
    await this.reapJobs(Date.now());
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
    return json({
      state: publicView(this.room!, viewerId, now, this.set.revealMinMs),
      serverTime: now,
      ...extra,
    });
  }

  // --- HTTP ------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const now = Date.now();

    if (path === 'create') return this.handleCreate(request, now);

    if (this.room && now >= this.room.expiresAt) await this.destroy();
    if (!this.room) return json({ error: ROOM_GONE }, 404);

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
    if (!this.room) return json({ error: ROOM_GONE }, 404);

    const response = await this.route(path, url, request, playerId, now);

    // Every path down here can have mutated the room, INCLUDING the plain GET:
    // settle() above advances the clock on any request. The single alarm is
    // re-armed once, here, so no route can strand a due bot job or a phase
    // deadline by returning early.
    await this.armAlarm(Date.now());
    return response;
  }

  private route(
    path: string,
    url: URL,
    request: Request,
    playerId: string,
    now: number
  ): Promise<Response> | Response {
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
    // Clamp FIRST, then build exactly that many bots, so state's botCount and the
    // actual roster can never disagree (a botCount of "x" used to advertise 2 AI
    // players and create none).
    const options = normalizeOptions(body.options as Partial<RoomOptions> | undefined);
    const chosen = pickPersonas(options.botCount);
    const bots: Player[] = chosen.map((persona) => ({
      id: newPlayerId(),
      name: persona.name,
      isBot: true,
      score: 0,
      lastSeenAt: now,
    }));

    const room = createRoom(body.code, { id: hostId, name: body.name }, options, bots, now);
    if (room.players[0].name.length === 0) return json({ error: 'name required' }, 400);

    this.room = room;
    this.secrets = { [hostId]: crypto.randomUUID() };
    this.personas = Object.fromEntries(bots.map((bot, i) => [bot.id, chosen[i].id]));

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
    if (!this.room) return json({ error: ROOM_GONE }, 404);

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

    // Start goes through the SAME photo-retry path the timer and the host's Next
    // do. Without it, every tap on a dead image host fired three fresh outbound
    // requests, consumed no attempt, and could be repeated for ever: the one
    // rollover path that was still unbounded.
    if (photoRetryBlocked(room, now)) return this.envelope(playerId);

    // The photo is I/O, so stamp, fetch, re-check, and only then write.
    const stamp = stampOf(room);
    const pending = await this.fetchPhotoOnce(1);
    const settledAt = Date.now(); // after the download, never the pre-fetch clock
    if (!this.room) return json({ error: ROOM_GONE }, 404);
    if (!pending) {
      // Phase and round, not version: see the same check in settle().
      if (roundMatches(this.room, stamp)) {
        const failed = notePhotoFailure(this.room, settledAt);
        this.room = failed.state;
        await this.save();
        // The attempt cap ran out. The game is over before it began, but it says
        // so honestly instead of leaving the host tapping a button for ever.
        if (this.room.phase === 'done') return this.envelope(playerId);
      }
      return json({ error: 'could not load a photo, try again' }, 502);
    }
    // Phase and round, NOT version. A friend joining during the second the photo
    // took to download bumps the version, and telling the host "this game
    // already started" when it has not is the one dead end a party host cannot
    // talk their way out of. The reducer below still refuses a real double
    // start, because a started room is no longer in `lobby`.
    if (!this.room || !roundMatches(this.room, stamp)) {
      return json({ error: 'this game already started' }, 409);
    }

    // Bytes first, then the reducer on the state as it is RIGHT NOW (the joiner
    // included), with no await in between.
    await this.commitPhotoBytes(1, pending);
    if (!this.room || !roundMatches(this.room, stamp)) {
      await this.discardOrphanPhoto(1);
      return json({ error: 'this game already started' }, 409);
    }
    const result = start(this.room, playerId, pending.meta, Date.now());
    if (result.error) {
      await this.discardOrphanPhoto(1);
      return json({ error: result.error }, 409);
    }
    this.room = result.state;
    await this.save();
    await this.syncBotJobs(Date.now());
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
    return this.envelope(playerId);
  }

  private async handleVote(request: Request, playerId: string): Promise<Response> {
    const body = (await request.json()) as { captionId?: string };
    const result = submitVote(this.room!, playerId, String(body.captionId ?? ''), Date.now());
    if (result.error) return json({ error: result.error }, 409);
    this.room = result.state;
    await this.save();
    return this.envelope(playerId);
  }

  private async handleNext(playerId: string): Promise<Response> {
    const room = this.room!;
    // The reveal timer can auto-advance to `done` in the gap between the host
    // reading the screen and their tap landing. Asking to move on from a game
    // that is already over got what it asked for, so it is a 200 with the state,
    // not an error the champion screen has to apologise for.
    //
    // THE ASYMMETRY WITH caption/vote IS DELIBERATE (round 8, Claude nit 4).
    // `handleCaption` and `handleVote` on a `done` room answer 409 through the
    // reducer, and that is also right: those ask the room to RECORD something,
    // and a write that silently does nothing is worse than an error. `next` only
    // asks the room to move to a state it has already reached. Do not "fix" one
    // to match the other.
    if (room.phase === 'done') return this.envelope(playerId);
    if (room.phase !== 'reveal') return json({ error: 'nothing to move on from' }, 409);

    const dryRun = advance(room, playerId, Date.now(), undefined, this.set.revealMinMs);
    if (dryRun.error) return json({ error: dryRun.error }, 403);

    let pending: PendingPhoto | null = null;
    const nextRound = room.round + 1;
    if (dryRun.needsPhoto) {
      // The host's Next button goes through the SAME photo-retry path the timer
      // does. Without this, every frustrated tap during a dead-photo backoff
      // fired three fresh outbound image requests, consumed no attempt, and
      // could never reach `endedReason: 'photo-unavailable'`: one rollover path
      // was bounded and the other was not.
      if (photoRetryBlocked(room, Date.now())) return this.envelope(playerId);

      const stamp = stampOf(room);
      pending = await this.fetchPhotoOnce(nextRound);
      const settledAt = Date.now(); // after the download, never the pre-fetch clock
      if (!this.room) return json({ error: ROOM_GONE }, 404);
      if (!pending) {
        // Phase and round, not version: see the same check in settle().
        if (roundMatches(this.room, stamp)) {
          const failed = notePhotoFailure(this.room, settledAt);
          this.room = failed.state;
          await this.save();
          // The attempt cap ran out: the room is now `done` with a reason, and
          // the host should see that scoreboard rather than an error.
          if (this.room.phase === 'done') return this.envelope(playerId);
        }
        return json({ error: 'could not load a photo, try again' }, 502);
      }
      if (!roundMatches(this.room, stamp)) return this.envelope(playerId);
      // Bytes first, then the reducer on the freshest state (a join can land in
      // this window), with no await between the check and the assignment.
      await this.commitPhotoBytes(nextRound, pending);
      if (!this.room || !roundMatches(this.room, stamp)) {
        await this.discardOrphanPhoto(nextRound);
        return this.envelope(playerId);
      }
    }

    const result = advance(
      this.room!,
      playerId,
      Date.now(),
      pending?.meta,
      this.set.revealMinMs
    );
    if (result.error) return json({ error: result.error }, 403);
    this.room = result.state;
    await this.save();
    await this.syncBotJobs(Date.now());
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
    // Deliberately the same body a missing room gives. This route is open (an
    // <img> cannot send headers), so a different message here would turn it into
    // an unauthenticated oracle for "is this room code live?".
    if (!stored) return json({ error: ROOM_GONE }, 404);
    return new Response(stored.bytes, {
      headers: {
        'Content-Type': stored.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
        // These bytes came from a third-party image host and are served from our
        // own origin, where the room's playerSecret lives in sessionStorage.
        // nosniff stops a browser deciding for itself that they are something
        // executable; photo.ts refuses image/svg+xml on the way in as well.
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
