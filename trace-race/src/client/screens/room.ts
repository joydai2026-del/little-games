// One room. Polls the Worker and shows the right screen for this phone:
// teacher (lobby, race board, results) or kid (waiting, tracing pad, results).
import { ApiError, act, loadSeat, poll, sendStroke, setList, setOptions, type Seat } from '../api';
import { GAME, OPTION_LIMITS } from '../../shared/config';
import type { PublicState, StrokeResult } from '../../shared/types';
import { startTrace, type TraceHandle } from '../tracer';
import { brand, credits, h, momo } from '../ui';
import { board } from './board';

interface Ctx {
  root: HTMLElement;
  code: string;
  seat: Seat;
  state: PublicState | null;
  offset: number; // serverTime - Date.now()
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
  const ctx: Ctx = { root, code, seat, state: null, offset: 0, refresh: () => void tick(true) };

  const ticker = setInterval(() => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-until]')) {
      el.textContent = fmt(secondsLeft(ctx, Number(el.dataset.until)));
    }
    kid?.tick();
  }, 250);

  function render(): void {
    const s = ctx.state!;
    const key = `${s.phase}:${s.round}:${s.role}`;
    if (s.role === 'teacher') {
      root.className = 'wide';
      if (s.phase === 'lobby') {
        // Keep typing and focus: only rebuild the lobby when something visible changed.
        const lobbyKey = `${key}:${s.version}`;
        const active = document.activeElement;
        const typing = active instanceof HTMLTextAreaElement && root.contains(active);
        if (lobbyKey !== lastKey && !typing) {
          root.replaceChildren(teacherLobby(ctx));
          lastKey = lobbyKey;
        }
        return;
      }
      root.replaceChildren(teacherRace(ctx));
      lastKey = key;
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
      const res = await poll(code, seat!, force || !ctx.state ? undefined : ctx.state.version);
      ctx.offset = res.serverTime - Date.now();
      if (res.state) {
        ctx.state = res.state;
        render();
      }
      wait = res.nextPollMs ?? GAME.pollMs[ctx.state?.phase ?? 'lobby'];
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        root.replaceChildren(brand('This room has ended.'), h('p', {}, [h('a', { href: '#/', text: 'Start again' })]));
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
  const kids = s.players.filter((p) => p.role === 'kid');
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
      s.list.missing.length ? h('p', { class: 'notice warn', text: `No stroke data for ${s.list.missing.join(' ')}, skipped.` }) : null,
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
    footer = h('div', {}, [again, err]);
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

class KidRace {
  readonly el = h('div');
  readonly round: number;
  private charIndex: number;
  private startStroke: number;
  private tracer: TraceHandle | null = null;
  private cheering = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly head = h('div', { class: 'race-head' });
  private readonly stage = h('div');
  private readonly status = h('p', { class: 'muted', role: 'status', style: 'text-align:center' });
  private readonly dots = h('div', { class: 'dots' });
  private strokesDone = 0;

  constructor(private readonly ctx: Ctx) {
    const s = ctx.state!;
    const mine = s.progress[s.you];
    this.round = s.round;
    this.charIndex = mine?.charIndex ?? 0;
    this.startStroke = mine?.strokeIndex ?? 0;
    this.el.append(this.head, this.dots, this.stage, this.status);
  }

  private get state(): PublicState {
    return this.ctx.state!;
  }

  private size(): number {
    return Math.min(window.innerWidth - 40, window.innerHeight - 220, 520);
  }

  update(): void {
    const s = this.state;
    const total = s.roundChars.length;
    const done = Math.min(this.charIndex, total);
    this.head.replaceChildren(
      h('span', { text: done >= total ? 'All done!' : `Character ${this.charIndex + 1} of ${total}` }),
      h('span', { class: 'timer', 'data-until': String(s.endsAt), text: fmt(secondsLeft(this.ctx, s.endsAt)) })
    );
    this.tick();
  }

  tick(): void {
    const s = this.state;
    if (s.goAt != null && Date.now() + this.ctx.offset < s.goAt) {
      const n = Math.max(1, Math.ceil((s.goAt - Date.now() - this.ctx.offset) / 1000));
      if (this.stage.dataset.count !== String(n)) {
        this.stage.dataset.count = String(n);
        this.stage.replaceChildren(h('p', { class: 'countdown', text: String(n) }), h('p', { class: 'notice', text: 'Ready, set...' }));
      }
      return;
    }
    if (!this.tracer && !this.cheering && this.charIndex < s.roundChars.length) this.mount();
    if (this.charIndex >= s.roundChars.length && !this.cheering && this.stage.dataset.fin !== '1') {
      this.stage.dataset.fin = '1';
      this.stage.replaceChildren(momo('bounce'), h('h1', { text: 'You finished!', style: 'text-align:center' }), h('p', { class: 'notice', text: 'Look at the big screen to see the race.' }));
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
    this.status.textContent = this.state.options.hints ? 'Trace the strokes in order. Stuck? Try once, the hint will show you.' : 'Trace the strokes in order.';
    this.tracer = startTrace(char, { size: this.size(), hints: this.state.options.hints, startStroke: this.startStroke }, {
      onCorrect: (i) => {
        this.strokesDone = i + 1;
        this.renderDots();
        this.send(index, i, 'correct');
      },
      onMistake: (i) => this.send(index, i, 'mistake'),
      onComplete: () => this.cheer(),
      onError: (msg) => (this.status.textContent = msg),
    });
    this.stage.replaceChildren(this.tracer.root);
  }

  private send(charIndex: number, strokeIndex: number, result: StrokeResult): void {
    this.queue = this.queue.then(async () => {
      for (let attempt = 0; attempt < GAME.strokeSendRetries; attempt++) {
        try {
          const env = await sendStroke(this.ctx.code, this.ctx.seat, charIndex, strokeIndex, result);
          this.ctx.state = env.state;
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) return; // refused: the poll resyncs
        }
      }
    });
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
