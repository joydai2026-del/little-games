// One room. Polls the Worker and shows the right screen for this phone:
// teacher (lobby, race board, results) or kid (waiting, tracing pad, results).
import { ApiError, act, clearSeat, loadSeat, type Envelope, poll, sendStroke, setList, setOptions, type Seat } from '../api';
import { GAME, OPTION_LIMITS } from '../../shared/config';
import type { PublicState, StrokeResult } from '../../shared/types';
import { startTrace, type TraceHandle } from '../tracer';
import { brand, credits, h, momo } from '../ui';
import { goTo } from '../route';
import { StrokeSender } from '../sender';
import { HICCUP_TEXT, kidStatusText } from '../status';
import { board } from './board';

interface Ctx {
  root: HTMLElement;
  code: string;
  seat: Seat;
  state: PublicState | null;
  offset: number; // serverTime - Date.now()
  /** Set after a stroke send gave up: polls stay FULL (never "unchanged") until one succeeds. */
  forceFull: boolean;
  refresh(): void;
}

const serverNow = (ctx: Ctx) => Date.now() + ctx.offset;
const secondsLeft = (ctx: Ctx, at: number | null) => Math.max(0, Math.ceil(((at ?? 0) - serverNow(ctx)) / 1000));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function renderRoom(root: HTMLElement, code: string): () => void {
  const seat = loadSeat(code);
  if (!seat) {
    window.location.hash = `#/join/${code}`;
    return () => {};
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let kid: KidRace | null = null;
  const ctx: Ctx = { root, code, seat, state: null, offset: 0, forceFull: false, refresh: () => void tick(true) };

  let teacherCounting = false;
  let endPolledRound = -1;
  const ticker = setInterval(() => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-until]')) {
      el.textContent = fmt(secondsLeft(ctx, Number(el.dataset.until)));
    }
    kid?.tick();
    const s = ctx.state;
    if (!s || s.phase !== 'racing') return;
    // The board switches from "Ready, set..." to the race clock by itself at GO.
    if (teacherCounting && s.goAt != null && serverNow(ctx) >= s.goAt) render();
    // At the race end, ask the room now instead of waiting for the next poll.
    if (s.endsAt != null && serverNow(ctx) >= s.endsAt && endPolledRound !== s.round) {
      endPolledRound = s.round;
      ctx.refresh();
    }
  }, 250);

  function render(): void {
    const s = ctx.state!;
    const key = `${s.phase}:${s.round}:${s.role}`;
    if (s.role === 'teacher') {
      root.className = 'wide';
      if (s.phase === 'lobby') {
        // Keep typing and focus: only rebuild the lobby when something visible changed.
        const lobbyKey = `${key}:${s.version}:${s.present.join(',')}`;
        const active = document.activeElement;
        const typing = active instanceof HTMLTextAreaElement && root.contains(active);
        if (lobbyKey !== lastKey && !typing) {
          root.replaceChildren(teacherLobby(ctx));
          lastKey = lobbyKey;
        }
        return;
      }
      teacherCounting = s.phase === 'racing' && s.goAt != null && serverNow(ctx) < s.goAt;
      root.replaceChildren(teacherRace(ctx));
      lastKey = key;
      return;
    }
    if (s.phase === 'racing' && !s.progress[s.you]) {
      // Joined after Start: the roster is frozen, so this kid races the next one.
      if (lastKey !== `${key}:late`) root.replaceChildren(kidLate(ctx));
      lastKey = `${key}:late`;
      return;
    }
    if (s.phase === 'racing') {
      if (!kid || kid.round !== s.round) {
        kid?.destroy();
        kid = new KidRace(ctx);
        root.replaceChildren(kid.el);
      }
      kid.update();
      lastKey = key;
      return;
    }
    kid?.destroy();
    kid = null;
    root.replaceChildren(s.phase === 'lobby' ? kidLobby(ctx) : kidDone(ctx));
    lastKey = key;
  }

  async function tick(force = false): Promise<void> {
    if (stopped) return;
    clearTimeout(timer);
    let wait: number = GAME.pollMs.lobby;
    try {
      // Full reads (no ?v) when forced, after a give-up, and for the teacher
      // outside a race: "Kids here" changes with time, not only with the version.
      const s0 = ctx.state;
      const full = force || ctx.forceFull || !s0 || (s0.role === 'teacher' && s0.phase !== 'racing');
      const res = await poll(code, seat!, full ? undefined : s0!.version);
      ctx.offset = res.serverTime - Date.now();
      if (res.state) {
        ctx.state = res.state;
        if (full) ctx.forceFull = false;
        render();
      }
      wait = res.nextPollMs ?? GAME.pollMs[ctx.state?.phase ?? 'lobby'];
    } catch (err) {
      // Only the room's OWN answers mean the seat is dead; a stray 403 from the
      // network (an edge challenge, a captive portal) must not delete a good seat.
      const roomSaysGone =
        err instanceof ApiError &&
        ((err.status === 404 && err.message === 'that room is not around any more') ||
          (err.status === 403 && err.message === 'not a player in this room'));
      if (roomSaysGone) {
        // The saved seat is for a room that is gone (codes are reused): forget it, so the
        // join link works again instead of looping back here.
        clearSeat(code);
        const again = h('button', { class: 'btn', text: 'Join again' });
        again.addEventListener('click', () => goTo(`#/join/${code}`, window, () => new HashChangeEvent('hashchange')));
        root.replaceChildren(brand('This room has ended.'), h('p', {}, [again]));
        stopped = true;
        return;
      }
    }
    if (!stopped) timer = setTimeout(() => void tick(), wait);
  }

  void tick(true);
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(ticker);
    kid?.destroy();
  };
}

// --- teacher ---------------------------------------------------------------

function stepper(label: string, value: number, min: number, max: number, step: number, onSet: (n: number) => void): HTMLElement {
  const minus = h('button', { class: 'btn secondary small', text: '−', 'aria-label': `less ${label}` });
  const plus = h('button', { class: 'btn secondary small', text: '+', 'aria-label': `more ${label}` });
  minus.addEventListener('click', () => onSet(Math.max(min, value - step)));
  plus.addEventListener('click', () => onSet(Math.min(max, value + step)));
  return h('div', {}, [h('label', { text: label }), h('div', { class: 'stepper' }, [minus, h('span', { class: 'val', text: String(value) }), plus])]);
}

function teacherLobby(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  // The SAME list Start races with (presentKids on the server).
  const kids = s.players.filter((p) => s.present.includes(p.id));
  const link = `${location.origin}/#/join/${s.code}`;
  const err = h('p', { class: 'error', role: 'status' });
  const save = async (options: Record<string, unknown>) => {
    try {
      await setOptions(ctx.code, ctx.seat, options);
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };
  const hints = h('input', { type: 'checkbox', 'aria-label': 'Show stroke hints' });
  hints.checked = s.options.hints;
  hints.addEventListener('change', () => void save({ hints: hints.checked }));

  const start = h('button', { class: 'btn coral', text: 'Start the race' });
  const why = !s.list.chars.length ? 'Add a character list first.' : !kids.length ? 'Waiting for kids to join...' : '';
  start.disabled = Boolean(why);
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      await act(ctx.code, ctx.seat, 'start');
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
      start.disabled = false;
    }
  });

  const paste = h('textarea', { 'aria-label': 'New character list', placeholder: 'Paste a new list to replace this one' });
  const replace = h('button', { class: 'btn secondary', text: 'Use this list' });
  replace.addEventListener('click', async () => {
    try {
      await setList(ctx.code, ctx.seat, paste.value);
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });

  return h('div', {}, [
    brand('Kids join on their phones with this code'),
    h('section', { class: 'card' }, [
      h('p', { class: 'roomcode', text: s.code }),
      h('p', { class: 'joinlink', text: link }),
    ]),
    h('section', { class: 'card' }, [
      h('h2', { text: `Characters (${s.list.chars.length})` }),
      h('div', { class: 'chips' }, s.list.chars.map((c) => h('span', { class: 'chip', text: c }))),
      s.list.missing.length
        ? h('p', { class: 'notice warn', text: `We cannot trace ${s.list.missing.join(' ')} yet, so we left ${s.list.missing.length === 1 ? 'it' : 'them'} out.` })
        : null,
      s.list.overflow.length ? h('p', { class: 'notice warn', text: `Only the first ${GAME.maxListChars} are used. Left out: ${s.list.overflow.join(' ')}` }) : null,
      h('details', {}, [h('summary', { text: 'Change the list' }), paste, h('p'), replace]),
    ]),
    h('section', { class: 'card' }, [
      h('div', { class: 'row' }, [
        stepper('Seconds per character', s.options.secondsPerChar, OPTION_LIMITS.secondsPerChar.min, OPTION_LIMITS.secondsPerChar.max, 5, (n) => void save({ secondsPerChar: n })),
        stepper('Characters per race', s.options.charsPerRound, OPTION_LIMITS.charsPerRound.min, OPTION_LIMITS.charsPerRound.max, 1, (n) => void save({ charsPerRound: n })),
      ]),
      h('label', { class: 'toggle' }, [hints, 'Show stroke hints (best for K-2)']),
    ]),
    h('section', { class: 'card' }, [
      h('h2', { text: `Kids here (${kids.length})` }),
      kids.length ? h('div', { class: 'chips' }, kids.map((k) => h('span', { class: 'tag', text: k.agent ? `${k.name} (AI)` : k.name }))) : h('p', { class: 'muted', text: 'Nobody yet.' }),
      h('p'),
      start,
      why ? h('p', { class: 'muted', text: why }) : null,
      err,
    ]),
    credits(),
  ]);
}

function teacherRace(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const err = h('p', { class: 'error', role: 'status' });
  const counting = s.phase === 'racing' && s.goAt != null && serverNow(ctx) < s.goAt;
  let footer: HTMLElement | null = null;
  if (s.phase === 'done') {
    const again = h('button', { class: 'btn coral', text: 'Race again (next characters)' });
    again.addEventListener('click', async () => {
      again.disabled = true;
      try {
        await act(ctx.code, ctx.seat, 'next');
        ctx.refresh();
      } catch (e) {
        err.textContent = (e as Error).message;
        again.disabled = false;
      }
    });
    const next = s.players.filter((p) => s.present.includes(p.id)).map((p) => p.name);
    footer = h('div', {}, [
      again,
      h('p', { class: 'muted', text: next.length ? `Next race: ${next.join(', ')}` : 'Nobody is here for the next race yet.' }),
      err,
    ]);
  }
  return h('div', {}, [
    h('div', { class: 'race-head' }, [
      h('span', { text: `Room ${s.code} · Race ${s.round}` }),
      s.phase === 'racing'
        ? h('span', { class: 'timer', 'data-until': String(counting ? s.goAt : s.endsAt), text: fmt(secondsLeft(ctx, counting ? s.goAt : s.endsAt)) })
        : h('span', { class: 'timer', text: 'Finished!' }),
    ]),
    h('h1', { text: s.phase === 'done' ? 'Winners!' : counting ? 'Ready, set...' : 'Race is on!' }),
    h('div', { class: 'chips' }, s.roundChars.map((c) => h('span', { class: 'chip', text: c }))),
    board(s),
    footer,
  ]);
}

// --- kid -------------------------------------------------------------------

function kidLobby(ctx: Ctx): HTMLElement {
  const me = ctx.state!.players.find((p) => p.id === ctx.state!.you);
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: `You're in, ${me?.name ?? 'friend'}!`, style: 'text-align:center' }),
    h('p', { class: 'notice', text: 'Wait for your teacher to start the race. Get your finger ready!' }),
  ]);
}

function kidLate(ctx: Ctx): HTMLElement {
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: 'You will race next round', style: 'text-align:center' }),
    h('p', { class: 'notice', text: 'This race started without you. Watch the board, and keep this screen on!' }),
    board(ctx.state!),
  ]);
}

function kidDone(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const mine = s.standings.find((r) => r.playerId === s.you);
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: mine ? `You are number ${mine.place}!` : 'Race over!', style: 'text-align:center' }),
    mine ? h('p', { class: 'notice', text: `You wrote ${mine.charsDone} character${mine.charsDone === 1 ? '' : 's'}. 好棒!` }) : null,
    board(s),
  ]);
}

/**
 * The kid's tracing pad for one race.
 *
 * The pad moves ahead of the room (a stroke fills in before the server says
 * so), which keeps it fast. It is reconciled with the room whenever no stroke
 * is in flight: if the room's progress differs from the pad (a send was
 * refused, or every retry failed), the pad jumps back to where the room says
 * this kid is. The room is always the truth; the pad never says "finished"
 * while the board says otherwise.
 */
class KidRace {
  readonly el = h('div');
  readonly round: number;
  private charIndex = 0;
  private startStroke = 0;
  private strokesDone = 0;
  private seq = 0;
  private tracer: TraceHandle | null = null;
  private cheering = false;
  private hiccupUntil = 0;
  private errorText: string | null = null;
  /** Only states at least this new may be used to reconcile (drops a stale poll that crossed a send). */
  private minVersion = 0;
  private readonly head = h('div', { class: 'race-head' });
  private readonly stage = h('div');
  private readonly status = h('p', { class: 'muted', role: 'status', style: 'text-align:center' });
  private readonly dots = h('div', { class: 'dots' });

  constructor(private readonly ctx: Ctx) {
    this.round = ctx.state!.round;
    this.adoptServer();
    this.el.append(this.head, this.dots, this.stage, this.status);
  }

  private get state(): PublicState {
    return this.ctx.state!;
  }

  private size(): number {
    return Math.min(window.innerWidth - 40, window.innerHeight - 220, 520);
  }

  /** Take the room's word for where this kid is. */
  private adoptServer(): void {
    const mine = this.state.progress[this.state.you];
    this.charIndex = mine?.charIndex ?? 0;
    this.startStroke = mine?.strokeIndex ?? 0;
    this.strokesDone = this.startStroke;
    this.seq = mine?.seq ?? 0;
  }

  /** True when the pad and the room disagree and nothing is in flight to explain it. */
  private outOfStep(): boolean {
    if (this.sender.pending > 0 || this.cheering || this.state.version < this.minVersion) return false;
    const mine = this.state.progress[this.state.you];
    if (!mine) return false;
    const localDone = this.charIndex >= this.state.roundChars.length;
    const serverDone = mine.finishedAt != null;
    if (localDone || serverDone) return localDone !== serverDone;
    return mine.charIndex !== this.charIndex || mine.strokeIndex !== this.strokesDone;
  }

  private resync(): void {
    this.tracer?.destroy();
    this.tracer = null;
    delete this.stage.dataset.fin;
    this.sender.reset();
    this.adoptServer();
    this.hiccupUntil = Date.now() + GAME.hiccupNoticeMs;
    this.status.textContent = HICCUP_TEXT;
  }

  update(): void {
    if (this.outOfStep()) this.resync();
    // A give-up whose strokes DID land (only the answers were lost): after a
    // full read shows the pad and the room agree, stop skipping strokes.
    else if (this.sender.gaveUp && this.sender.pending === 0 && !this.ctx.forceFull) this.sender.reset();
    const s = this.state;
    const total = s.roundChars.length;
    this.head.replaceChildren(
      h('span', { text: this.charIndex >= total ? 'All done!' : `Character ${this.charIndex + 1} of ${total}` }),
      h('span', { class: 'timer', 'data-until': String(s.endsAt), text: fmt(secondsLeft(this.ctx, s.endsAt)) })
    );
    this.tick();
  }

  /** Writes the help line; called on every tick so the hiccup notice clears itself on time. */
  private showStatus(): void {
    const text = kidStatusText({ hints: this.state.options.hints, hiccupUntil: this.hiccupUntil, now: Date.now(), error: this.errorText });
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  tick(): void {
    const s = this.state;
    if (this.tracer) this.showStatus();
    if (s.goAt != null && Date.now() + this.ctx.offset < s.goAt) {
      const n = Math.max(1, Math.ceil((s.goAt - Date.now() - this.ctx.offset) / 1000));
      if (this.stage.dataset.count !== String(n)) {
        this.stage.dataset.count = String(n);
        this.stage.replaceChildren(h('p', { class: 'countdown', text: String(n) }), h('p', { class: 'notice', text: 'Ready, set...' }));
      }
      return;
    }
    if (!this.tracer && !this.cheering && this.charIndex < s.roundChars.length) this.mount();
    // Never say "You finished!" while strokes are still on their way to the room.
    const fin = this.sender.pending > 0 ? 'sending' : 'done';
    if (this.charIndex >= s.roundChars.length && !this.cheering && this.stage.dataset.fin !== fin) {
      this.stage.dataset.fin = fin;
      this.stage.replaceChildren(
        momo('bounce'),
        h('h1', { text: fin === 'done' ? 'You finished!' : 'Almost there...', style: 'text-align:center' }),
        h('p', { class: 'notice', text: fin === 'done' ? 'Look at the big screen to see the race.' : 'Sending your strokes to the board.' })
      );
      this.dots.replaceChildren();
    }
  }

  private renderDots(): void {
    const total = this.state.list.strokeCounts[this.state.roundChars[this.charIndex]] ?? 0;
    this.dots.replaceChildren(
      ...Array.from({ length: total }, (_, i) =>
        h('span', { class: `dot${i < this.strokesDone ? ' done' : i === this.strokesDone ? ' now' : ''}` })
      )
    );
  }

  private mount(): void {
    const char = this.state.roundChars[this.charIndex];
    const index = this.charIndex;
    this.strokesDone = this.startStroke;
    this.renderDots();
    this.errorText = null;
    this.showStatus();
    const handle = startTrace(char, { size: this.size(), hints: this.state.options.hints, startStroke: this.startStroke }, {
      onCorrect: (i) => {
        if (this.tracer !== handle) return;
        this.strokesDone = i + 1;
        this.renderDots();
        this.send(index, i, 'correct');
      },
      onMistake: (i) => this.tracer === handle && this.send(index, i, 'mistake'),
      onComplete: () => this.tracer === handle && this.cheer(),
      onError: (msg) => {
        this.errorText = msg;
        this.showStatus();
      },
    });
    this.tracer = handle;
    this.stage.replaceChildren(handle.root);
  }

  private readonly sender = new StrokeSender<Envelope>({
    send: (msg) => sendStroke(this.ctx.code, this.ctx.seat, msg),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: GAME.strokeRetryBackoffMs,
    isRetryable: (err) => !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500,
    onSent: (env) => {
      this.ctx.state = env.state;
      this.minVersion = Math.max(this.minVersion, env.state.version);
    },
    onDrained: (gaveUp) => {
      // A give-up forces full reads until one succeeds, so the reconcile below
      // runs even when nothing changed in the room (a whole-class outage).
      if (gaveUp) this.ctx.forceFull = true;
      this.ctx.refresh();
    },
  });

  private send(charIndex: number, strokeIndex: number, result: StrokeResult): void {
    void this.sender.enqueue({ race: this.round, seq: ++this.seq, charIndex, strokeIndex, result });
  }

  private cheer(): void {
    this.cheering = true;
    const overlay = h('div', { class: 'cheer' }, [h('div', {}, [momo(), h('p', { class: 'big', text: '好棒!' }), h('p', { text: 'Great writing!' })])]);
    document.body.append(overlay);
    setTimeout(() => {
      overlay.remove();
      this.tracer?.destroy();
      this.tracer = null;
      this.charIndex += 1;
      this.startStroke = 0;
      this.strokesDone = 0;
      this.cheering = false;
      this.update();
    }, GAME.cheerMs);
  }

  destroy(): void {
    this.tracer?.destroy();
    this.tracer = null;
    document.querySelectorAll('.cheer').forEach((n) => n.remove());
  }
}
