// One room. Polls the Worker and shows the right screen for this device:
// teacher (lobby, the big drawing screen, winners) or kid (waiting, word
// cards, results).
import { ApiError, act, clearSeat, loadSeat, poll, sendGuess, setList, setOptions, type Seat } from '../api';
import { GAME, LEVELS, OPTION_LIMITS, type Level } from '../../shared/config';
import type { PublicState } from '../../shared/types';
import { startDrawing, type DrawHandle } from '../drawer';
import { cardsView } from '../cards';
import { brand, h, momo, setHeaderLink } from '../ui';
import { goTo, headerLinkOn } from '../route';
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

interface Game {
  round: number;
  el: HTMLElement;
  update(): void;
  tick(): void;
  destroy(): void;
}

export function renderRoom(root: HTMLElement, code: string): () => void {
  const seat = loadSeat(code);
  if (!seat) {
    window.location.hash = `#/join/${code}`;
    return () => {};
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let game: Game | null = null;
  let lastMoment = '';
  const ctx: Ctx = { root, code, seat, state: null, offset: 0, refresh: () => void tick(true) };

  const ticker = setInterval(() => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-until]')) {
      el.textContent = fmt(secondsLeft(ctx, Number(el.dataset.until)));
    }
    game?.tick();
    // When the room's clock moves (a word closes, the next starts), ask now
    // instead of waiting for the next poll.
    const q = ctx.state?.phase === 'playing' ? ctx.state.question : null;
    if (q) {
      const now = serverNow(ctx);
      const moment = q.closedAt == null ? (now >= q.endsAt ? `end:${q.index}` : '') : q.nextAt != null && now >= q.nextAt ? `next:${q.index}` : '';
      if (moment && moment !== lastMoment) {
        lastMoment = moment;
        ctx.refresh();
      }
    }
  }, 250);

  function render(): void {
    const s = ctx.state!;
    setHeaderLink(headerLinkOn(s));
    const key = `${s.phase}:${s.round}:${s.role}`;
    if (s.phase === 'playing' && (s.role === 'teacher' || s.inRound)) {
      root.className = s.role === 'teacher' ? 'wide' : '';
      if (!game || game.round !== s.round) {
        game?.destroy();
        game = s.role === 'teacher' ? new TeacherGame(ctx) : new KidGame(ctx);
        root.replaceChildren(game.el);
      }
      game.update();
      lastKey = key;
      return;
    }
    game?.destroy();
    game = null;
    if (s.role === 'teacher') {
      root.className = 'wide';
      // Keep typing and focus: only rebuild when something visible changed.
      const viewKey = `${key}:${s.version}:${s.present.join(',')}`;
      const active = document.activeElement;
      const typing = active instanceof HTMLTextAreaElement && root.contains(active);
      if (viewKey !== lastKey && !typing) {
        root.replaceChildren(s.phase === 'lobby' ? teacherLobby(ctx) : teacherDone(ctx));
        lastKey = viewKey;
      }
      return;
    }
    root.className = '';
    const viewKey = `${key}:${s.version}`;
    if (viewKey !== lastKey) {
      root.replaceChildren(s.phase === 'lobby' ? kidLobby(ctx) : s.phase === 'playing' ? kidLate(ctx) : kidDone(ctx));
      lastKey = viewKey;
    }
  }

  async function tick(force = false): Promise<void> {
    if (stopped) return;
    clearTimeout(timer);
    let wait: number = GAME.pollMs.lobby;
    try {
      // Full reads (no ?v) when forced and for the teacher outside a round:
      // "Kids here" changes with time, not only with the version.
      const s0 = ctx.state;
      const full = force || !s0 || (s0.role === 'teacher' && s0.phase !== 'playing');
      const res = await poll(code, seat!, full ? undefined : s0!.version);
      ctx.offset = res.serverTime - Date.now();
      if (res.state && (!ctx.state || res.state.version >= ctx.state.version || full)) {
        ctx.state = res.state;
        render();
      }
      wait = res.nextPollMs ?? GAME.pollMs[ctx.state?.phase ?? 'lobby'];
    } catch (err) {
      // Only the room's OWN answers mean the seat is dead.
      const roomSaysGone =
        err instanceof ApiError &&
        ((err.status === 404 && err.message === 'that room is not around any more') ||
          (err.status === 403 && err.message === 'not a player in this room'));
      if (roomSaysGone) {
        clearSeat(code);
        const again = h('button', { class: 'btn btn-primary', text: 'Join again' });
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
    game?.destroy();
  };
}

// --- teacher ---------------------------------------------------------------

function stepper(label: string, value: number, min: number, max: number, onSet: (n: number) => void): HTMLElement {
  const minus = h('button', { class: 'btn btn-secondary small', text: '−', 'aria-label': `less ${label}` });
  const plus = h('button', { class: 'btn btn-secondary small', text: '+', 'aria-label': `more ${label}` });
  minus.addEventListener('click', () => onSet(Math.max(min, value - 1)));
  plus.addEventListener('click', () => onSet(Math.min(max, value + 1)));
  return h('div', {}, [h('label', { text: label }), h('div', { class: 'stepper' }, [minus, h('span', { class: 'val', text: String(value) }), plus])]);
}

function levelPicker(current: Level, onSet: (level: Level) => void): HTMLElement {
  const buttons = (Object.keys(LEVELS) as Level[]).map((level) => {
    const b = h('button', { class: `btn ${level === current ? 'btn-primary' : 'btn-secondary'} small`, text: LEVELS[level].label, 'aria-pressed': level === current ? 'true' : 'false' });
    b.addEventListener('click', () => onSet(level));
    return b;
  });
  const rules = LEVELS[current];
  const help = rules.lockOnWrong
    ? `Momo draws a stroke every ${rules.strokeMs / 1000} seconds. A wrong tap means you sit out that word.`
    : `Momo draws a stroke every ${rules.strokeMs / 1000} seconds. A wrong tap just waits a moment, then you can try again.`;
  return h('div', {}, [h('label', { text: 'Class level' }), h('div', { class: 'row levels' }, buttons), h('p', { class: 'muted', text: help })]);
}

function listNotes(s: PublicState): (HTMLElement | null)[] {
  const plural = (n: number) => (n === 1 ? 'it' : 'them');
  return [
    s.list.missing.length ? h('p', { class: 'notice warn', text: `Momo cannot draw ${s.list.missing.join(' ')} yet, so we left ${plural(s.list.missing.length)} out.` }) : null,
    s.list.skipped.length ? h('p', { class: 'notice', text: `These looked like headings, so they are not cards: ${s.list.skipped.join(' ')}` }) : null,
    s.list.overflow.length ? h('p', { class: 'notice warn', text: `Only the first ${GAME.maxListWords} words are used. Left out: ${s.list.overflow.join(' ')}` }) : null,
  ];
}

function teacherLobby(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
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
  const start = h('button', { class: 'btn btn-primary', text: 'Start the game' });
  const why = s.list.words.length < 2 ? 'Add at least 2 words first.' : !kids.length ? 'Waiting for kids to join...' : '';
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
  const paste = h('textarea', { 'aria-label': 'New word list', placeholder: 'Paste a new list to replace this one' });
  const replace = h('button', { class: 'btn btn-secondary', text: 'Use this list' });
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
    h('section', { class: 'card' }, [h('p', { class: 'roomcode', text: s.code }), h('p', { class: 'joinlink', text: link })]),
    h('section', { class: 'card' }, [
      h('h2', { text: `Words (${s.list.words.length})` }),
      h('div', { class: 'chips' }, s.list.words.map((w) => h('span', { class: 'chip word', text: w }))),
      ...listNotes(s),
      h('details', {}, [h('summary', { text: 'Change the list' }), paste, h('p'), replace]),
    ]),
    h('section', { class: 'card' }, [
      levelPicker(s.options.level, (level) => void save({ level })),
      stepper('Words per round', s.options.charsPerRound, OPTION_LIMITS.charsPerRound.min, OPTION_LIMITS.charsPerRound.max, (n) => void save({ charsPerRound: n })),
    ]),
    h('section', { class: 'card' }, [
      h('h2', { text: `Kids here (${kids.length})` }),
      kids.length ? h('div', { class: 'chips' }, kids.map((k) => h('span', { class: 'tag', text: k.agent ? `${k.name} (AI)` : k.name }))) : h('p', { class: 'muted', text: 'Nobody yet.' }),
      h('p'),
      start,
      why ? h('p', { class: 'muted', text: why }) : null,
      err,
    ]),
  ]);
}

function teacherDone(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const err = h('p', { class: 'error', role: 'status' });
  const again = h('button', { class: 'btn btn-primary', text: 'Play again (next words)' });
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
  return h('div', {}, [
    h('div', { class: 'race-head' }, [h('span', { text: `Room ${s.code} · Round ${s.round}` }), h('span', { class: 'timer', text: 'Finished!' })]),
    h('div', { class: 'winners-head' }, [momo('bounce'), h('h1', { text: 'Winners!' })]),
    h('div', { class: 'chips' }, s.history.map((x) => h('span', { class: 'chip word', text: x.word }))),
    board(s, false),
    again,
    h('p', { class: 'muted', text: next.length ? `Next round: ${next.join(', ')}` : 'Nobody is here for the next round yet.' }),
    err,
  ]);
}

/**
 * The big screen for one round: Momo draws the character stroke by stroke in
 * step with the room's clock, the four word cards the kids see, and the live
 * board. The drawing pad is built once per word and survives every poll.
 */
class TeacherGame implements Game {
  readonly el = h('div', { class: 'teacher-game' });
  readonly round: number;
  private qKey = '';
  private pad: DrawHandle | null = null;
  private readonly head = h('div', { class: 'race-head' });
  private readonly title = h('h1', { class: 'stage-title' });
  private readonly padBox = h('div', { class: 'pad-box' });
  private readonly buddy = momo('tilt');
  private readonly cards = h('div', { class: 'cards big-cards' });
  private readonly boardBox = h('div', { class: 'board-box' });
  private readonly note = h('p', { class: 'muted', role: 'status' });

  constructor(private readonly ctx: Ctx) {
    this.round = ctx.state!.round;
    this.el.append(
      this.head,
      h('div', { class: 'stage' }, [h('div', { class: 'stage-left' }, [this.title, h('div', { class: 'pad-row' }, [this.padBox, this.buddy]), this.cards, this.note]), this.boardBox])
    );
  }

  update(): void {
    const s = this.ctx.state!;
    const q = s.question;
    if (!q) return;
    const key = `${s.round}:${q.index}`;
    if (key !== this.qKey && q.char) {
      this.qKey = key;
      this.pad?.destroy();
      const size = Math.max(200, Math.min(window.innerHeight - 330, 480));
      this.pad = startDrawing(q.char, size, (msg) => (this.note.textContent = msg));
      this.padBox.replaceChildren(this.pad.root);
      this.note.textContent = '';
    }
    const closed = q.closedAt != null;
    this.cards.replaceChildren(
      ...q.cards.map((w, i) => h('div', { class: `word-card${closed && q.answer === i ? ' right' : closed ? ' off' : ''}`, text: w }))
    );
    this.boardBox.replaceChildren(h('h2', { text: 'Scores' }), board(s, true));
    this.tick();
  }

  tick(): void {
    const s = this.ctx.state!;
    const q = s.question;
    if (!q || !this.pad) return;
    const now = serverNow(this.ctx);
    const closed = q.closedAt != null;
    let headRight: HTMLElement;
    let title: string;
    if (closed) {
      this.pad.showAll();
      title = `It was ${q.cards[q.answer ?? 0]}!`;
      const last = q.index + 1 >= q.total;
      headRight = h('span', { class: 'timer', text: last ? 'Scores next!' : `Next word in ${secondsLeft(this.ctx, q.nextAt)}` });
      this.buddy.className = 'momo bounce';
    } else if (now < q.startAt) {
      title = `Ready, set... ${secondsLeft(this.ctx, q.startAt)}`;
      headRight = h('span', { class: 'timer', 'data-until': String(q.startAt), text: fmt(secondsLeft(this.ctx, q.startAt)) });
      this.buddy.className = 'momo bounce';
    } else {
      const shown = Math.min(q.strokes ?? 0, Math.floor((now - q.startAt) / q.strokeMs) + 1);
      this.pad.showUpTo(shown);
      title = shown >= (q.strokes ?? 0) ? 'Momo is done drawing. Last chance!' : 'What is Momo drawing?';
      headRight = h('span', { class: 'timer', 'data-until': String(q.endsAt), text: fmt(secondsLeft(this.ctx, q.endsAt)) });
      this.buddy.className = 'momo tilt';
    }
    if (this.title.textContent !== title) this.title.textContent = title;
    const headKey = `${q.index}:${closed}:${headRight.textContent}`;
    if (this.head.dataset.key !== headKey) {
      this.head.dataset.key = headKey;
      this.head.replaceChildren(h('span', { text: `Room ${s.code} · Round ${s.round} · Word ${q.index + 1} of ${q.total}` }), headRight);
    }
  }

  destroy(): void {
    this.pad?.destroy();
    this.pad = null;
  }
}

// --- kid -------------------------------------------------------------------

function kidLobby(ctx: Ctx): HTMLElement {
  const me = ctx.state!.players.find((p) => p.id === ctx.state!.you);
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: `You're in, ${me?.name ?? 'friend'}!`, style: 'text-align:center' }),
    h('p', { class: 'notice', text: 'Wait for your teacher to start. Watch the big screen: Momo will draw a character, and you tap the word!' }),
  ]);
}

function kidLate(ctx: Ctx): HTMLElement {
  return h('div', {}, [
    momo('tilt'),
    h('h1', { text: 'You will play next round', style: 'text-align:center' }),
    h('p', { class: 'notice', text: 'This round started without you. Watch the big screen, and keep this screen on!' }),
    board(ctx.state!, false),
  ]);
}

function kidDone(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const mine = s.standings.find((r) => r.playerId === s.you);
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: mine ? `You are number ${mine.place}!` : 'Round over!', style: 'text-align:center' }),
    mine ? h('p', { class: 'notice', text: `You got ${mine.correct} word${mine.correct === 1 ? '' : 's'} right, ${mine.points} points. 好棒!` }) : null,
    board(s, false),
  ]);
}

/** The kid's phone for one round: the word cards, one tap per guess. */
class KidGame implements Game {
  readonly el = h('div', { class: 'kid-game' });
  readonly round: number;
  private sending = false;
  private seq = 0;
  private errorText = '';
  private errorUntil = 0;
  private cheeredFor = '';
  private viewKey = '';
  private readonly head = h('div', { class: 'race-head' });
  private readonly stage = h('div');

  constructor(private readonly ctx: Ctx) {
    this.round = ctx.state!.round;
    this.el.append(this.head, this.stage);
  }

  update(): void {
    const s = this.ctx.state!;
    this.seq = Math.max(this.seq, s.score?.seq ?? 0);
    this.viewKey = '';
    this.tick();
  }

  tick(): void {
    const s = this.ctx.state!;
    const q = s.question;
    if (!q) return;
    const now = serverNow(this.ctx);
    const view = cardsView(q, s.mine, now, this.sending);
    const message = Date.now() < this.errorUntil ? this.errorText : view.message;
    const counting = now < q.startAt && q.closedAt == null;
    const count = counting ? secondsLeft(this.ctx, q.startAt) : 0;
    const key = `${s.version}:${q.index}:${view.looks.join(',')}:${message}:${count}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.head.replaceChildren(
      h('span', { text: `Word ${q.index + 1} of ${q.total}` }),
      h('span', { class: 'timer', text: `${s.score?.points ?? 0} points` })
    );
    if (counting && q.index === 0) {
      this.stage.replaceChildren(h('p', { class: 'countdown', text: String(Math.max(1, count)) }), h('p', { class: 'notice', text: 'Ready, set... look at the big screen!' }));
      return;
    }
    const closed = q.closedAt != null;
    const got = s.mine?.correctAt != null;
    this.stage.replaceChildren(
      h('p', { class: 'prompt', role: 'status', text: message }),
      h(
        'div',
        { class: 'cards' },
        q.cards.map((w, i) =>
          h('button', {
            class: `word-card ${view.looks[i]}`,
            text: w,
            disabled: view.looks[i] !== 'open',
            'aria-label': `Word ${w}`,
            onClick: () => void this.tap(i),
          })
        )
      ),
      momo(closed || got ? 'bounce' : s.mine?.locked ? 'tilt' : 'tilt small')
    );
  }

  private async tap(card: number): Promise<void> {
    const s = this.ctx.state!;
    const q = s.question;
    if (!q || this.sending) return;
    if (!cardsView(q, s.mine, serverNow(this.ctx), false).canTap) return;
    this.sending = true;
    this.viewKey = '';
    this.tick();
    const msg = { race: s.round, question: q.index, seq: ++this.seq, card };
    try {
      let env = null;
      // Retry only a lost connection, with the SAME seq, so a guess never counts twice.
      for (const wait of [0, 400, 1200]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          env = await sendGuess(this.ctx.code, this.ctx.seat, msg);
          break;
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 0) throw err;
        }
      }
      if (env && env.state.version >= (this.ctx.state?.version ?? 0)) this.ctx.state = env.state;
      const mine = this.ctx.state?.mine;
      if (mine?.correctAt != null && this.cheeredFor !== `${msg.race}:${msg.question}`) {
        this.cheeredFor = `${msg.race}:${msg.question}`;
        this.cheer(mine.points);
      } else if (env) {
        this.el.classList.remove('wiggle');
        void this.el.offsetWidth;
        this.el.classList.add('wiggle');
      }
    } catch (err) {
      this.errorText = (err as Error).message;
      this.errorUntil = Date.now() + 2500;
    } finally {
      this.sending = false;
      this.viewKey = '';
      this.tick();
      this.ctx.refresh();
    }
  }

  private cheer(points: number): void {
    const overlay = h('div', { class: 'cheer' }, [h('div', {}, [momo(), h('p', { class: 'big', text: '好棒!' }), h('p', { class: 'points', text: `+${points}` })])]);
    document.body.append(overlay);
    setTimeout(() => overlay.remove(), GAME.cheerMs);
  }

  destroy(): void {
    document.querySelectorAll('.cheer').forEach((n) => n.remove());
  }
}
