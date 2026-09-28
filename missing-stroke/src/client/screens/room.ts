// One room (or the solo game). Polls its Backend and shows the right screen for
// this phone: teacher (lobby, class board, winners) or kid (waiting, drawing
// pad, answer reveal, results).
import { ApiError, type Answered, type Backend, clearSeat } from '../api';
import { GAME, LEVELS, LEVEL_ORDER, OPTION_LIMITS } from '../../shared/config';
import { hintMissesLeft, turnDeadline } from '../../shared/race';
import { strokeOutcome } from '../status';
import type { PublicState, PublicTurn } from '../../shared/types';
import type { Point } from '../../shared/matcher';
import { glyph, glyphFromPaths, startPad, type PadHandle } from '../tracer';
import { brand, h, momo, setHeaderLink } from '../ui';
import { goTo, headerLinkOn } from '../route';
import { StrokeSender } from '../sender';
import { kidStatusText, seconds, winnerLine, type KidStage } from '../status';
import { board } from './board';

interface Ctx {
  root: HTMLElement;
  backend: Backend;
  state: PublicState | null;
  offset: number; // serverTime - Date.now()
  /** Set after a send gave up: polls stay FULL (never "unchanged") until one succeeds. */
  forceFull: boolean;
  refresh(): void;
}

const serverNow = (ctx: Ctx) => Date.now() + ctx.offset;
const secondsLeft = (ctx: Ctx, at: number | null) => Math.max(0, Math.ceil(((at ?? 0) - serverNow(ctx)) / 1000));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const nameOf = (s: PublicState, id: string) => s.players.find((p) => p.id === id)?.name ?? '';

/** The next moment this screen must look again: the countdown end, the character's deadline, or the reveal end. */
function nextStepAt(s: PublicState): number | null {
  if (s.phase !== 'racing' || !s.turn) return null;
  if (s.goAt != null && s.serverNow < s.goAt) return s.goAt;
  return s.turn.closedAt == null ? turnDeadline(s.turn) : s.turn.closedAt + s.rules.revealMs;
}

export function renderRoom(root: HTMLElement, backend: Backend): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let kid: KidRace | null = null;
  const ctx: Ctx = { root, backend, state: null, offset: 0, forceFull: false, refresh: () => void tick(true) };
  let polledStep = -1;
  // Polls and forced refreshes can overlap: only the answer to the newest request sent is applied.
  let sentReads = 0;
  let appliedRead = 0;

  const ticker = setInterval(() => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-until]')) {
      el.textContent = fmt(secondsLeft(ctx, Number(el.dataset.until)));
    }
    kid?.tick();
    const s = ctx.state;
    if (!s) return;
    // At GO, a character's deadline or the end of a reveal, ask the room now instead of waiting for the next poll.
    const at = nextStepAt(s);
    if (at != null && serverNow(ctx) >= at && polledStep !== at) {
      polledStep = at;
      ctx.refresh();
    }
  }, 250);

  function render(): void {
    const s = ctx.state!;
    const key = `${s.phase}:${s.round}:${s.role}`;
    // A kid in a live race must not be able to tap the header and leave.
    setHeaderLink(headerLinkOn(s));
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
      const counting = s.phase === 'racing' && s.goAt != null && serverNow(ctx) < s.goAt;
      const raceKey = `${key}:${s.version}:${s.present.join(',')}:${counting}`;
      if (raceKey !== lastKey) {
        root.replaceChildren(teacherRace(ctx));
        lastKey = raceKey;
      }
      return;
    }
    if (s.phase === 'racing' && !s.progress[s.you]) {
      // Joined after Start: the roster is frozen, so this kid plays the next race.
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
    if (lastKey !== `${key}:${s.version}`) root.replaceChildren(s.phase === 'lobby' ? kidLobby(ctx) : kidDone(ctx));
    lastKey = `${key}:${s.version}`;
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
      const readNo = ++sentReads;
      const res = await backend.poll(full ? undefined : s0!.version);
      const stale = readNo < appliedRead;
      if (!stale) {
        appliedRead = readNo;
        ctx.offset = res.serverTime - Date.now();
      }
      // An answer to an older request, or an older version than we show, is dropped.
      if (stale || (res.state && ctx.state && res.state.version < ctx.state.version)) {
        wait = GAME.pollMs[ctx.state?.phase ?? 'lobby'];
      } else if (res.state) {
        ctx.state = res.state;
        if (full) ctx.forceFull = false;
        render();
      }
      wait = res.nextPollMs ?? GAME.pollMs[ctx.state?.phase ?? 'lobby'];
    } catch (err) {
      // Only the room's OWN answers mean the seat is dead; a stray 403 from the
      // network (an edge challenge, a captive portal) must not delete a good seat.
      const roomSaysGone =
        !backend.solo &&
        err instanceof ApiError &&
        ((err.status === 404 && err.message === 'that room is not around any more') ||
          (err.status === 403 && err.message === 'not a player in this room'));
      if (roomSaysGone) {
        clearSeat(backend.code);
        const again = h('button', { class: 'btn btn-primary', text: 'Join again' });
        again.addEventListener('click', () => goTo(`#/join/${backend.code}`, window, () => new HashChangeEvent('hashchange')));
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

// --- shared bits -----------------------------------------------------------

function levelPicker(current: string, onPick: (level: string) => void): HTMLElement {
  return h('div', { class: 'levels', role: 'radiogroup', 'aria-label': 'Who is playing?' },
    LEVEL_ORDER.map((level) => {
      const rule = LEVELS[level];
      const b = h('button', {
        class: `btn ${level === current ? 'btn-primary' : 'btn-secondary'} level`,
        role: 'radio',
        'aria-checked': level === current ? 'true' : 'false',
        'data-level': level,
      }, [h('span', { class: 'level-name', text: rule.label }), h('span', { class: 'level-sub', text: `${rule.secondsPerChar} seconds each` })]);
      b.addEventListener('click', () => onPick(level));
      return b;
    })
  );
}

/** The big character for the class screen: stroke missing while open, the answer in pink after. */
function turnPicture(s: PublicState, size: number): HTMLElement {
  const t = s.turn!;
  const closed = t.closedAt != null;
  const names = t.winners.map((id) => nameOf(s, id));
  return h('div', { class: 'turn-pic' }, [
    glyphFromPaths(t.visible, closed ? t.answer : null, size),
    closed
      ? h('p', { class: 'reveal-line', text: winnerLine(names, t.winners.includes(s.you)) })
      : h('p', { class: 'muted', text: 'Momo forgot one stroke. Who can draw it first?' }),
    // The stroke number is part of the answer: only after the character closes (from the finished results).
    closed && s.results[t.index] ? h('p', { class: 'muted', text: `It was stroke ${s.results[t.index].hidden + 1} of ${s.list.strokeCounts[t.char] ?? '?'}.` }) : null,
  ]);
}

/** "一 has only one stroke, so we skipped it." */
export function skippedNote(skipped: string[]): string {
  return skipped.length === 1
    ? `${skipped[0]} has only one stroke, so we skipped it.`
    : `${skipped.join(' ')} have only one stroke each, so we skipped them.`;
}

// --- teacher ---------------------------------------------------------------

function stepper(label: string, value: number, min: number, max: number, step: number, onSet: (n: number) => void): HTMLElement {
  const minus = h('button', { class: 'btn btn-secondary small', text: '−', 'aria-label': `less ${label}` });
  const plus = h('button', { class: 'btn btn-secondary small', text: '+', 'aria-label': `more ${label}` });
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
      await ctx.backend.setOptions(options);
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };

  const start = h('button', { class: 'btn btn-primary', text: 'Start the game' });
  const why = !s.list.chars.length ? 'Add a character list first.' : !kids.length ? 'Waiting for kids to join...' : '';
  start.disabled = Boolean(why);
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      await ctx.backend.act('start');
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
      start.disabled = false;
    }
  });

  const paste = h('textarea', { 'aria-label': 'New character list', placeholder: 'Paste a new list to replace this one' });
  const replace = h('button', { class: 'btn btn-secondary', text: 'Use this list' });
  replace.addEventListener('click', async () => {
    try {
      await ctx.backend.setList(paste.value);
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  });

  return h('div', {}, [
    brand('Kids join on their phones with this code'),
    h('section', { class: 'card' }, [h('p', { class: 'roomcode', text: s.code }), h('p', { class: 'joinlink', text: link })]),
    h('section', { class: 'card' }, [
      h('h2', { text: `Characters (${s.list.chars.length})` }),
      h('div', { class: 'chips' }, s.list.chars.map((c) => h('span', { class: 'chip', text: c }))),
      s.list.missing.length
        ? h('p', { class: 'notice warn', text: `We do not have strokes for ${s.list.missing.join(' ')} yet, so we left ${s.list.missing.length === 1 ? 'it' : 'them'} out.` })
        : null,
      s.list.skipped?.length ? h('p', { class: 'notice warn', text: skippedNote(s.list.skipped) }) : null,
      s.list.overflow.length ? h('p', { class: 'notice warn', text: `Only the first ${GAME.maxListChars} are used. Left out: ${s.list.overflow.join(' ')}` }) : null,
      h('details', {}, [h('summary', { text: 'Change the list' }), paste, h('p'), replace]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', { text: 'Who is playing?' }),
      levelPicker(s.options.level, (level) => void save({ level })),
      stepper('Characters per game', s.options.charsPerRound, OPTION_LIMITS.charsPerRound.min, OPTION_LIMITS.charsPerRound.max, 1, (n) => void save({ charsPerRound: n })),
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

function teacherRace(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const err = h('p', { class: 'error', role: 'status' });
  const counting = s.phase === 'racing' && s.goAt != null && serverNow(ctx) < s.goAt;
  let footer: HTMLElement | null = null;
  if (s.phase === 'done') {
    const again = h('button', { class: 'btn btn-primary', text: 'Play again (next characters)' });
    again.addEventListener('click', async () => {
      again.disabled = true;
      try {
        await ctx.backend.act('next');
        ctx.refresh();
      } catch (e) {
        err.textContent = (e as Error).message;
        again.disabled = false;
      }
    });
    const next = s.players.filter((p) => s.present.includes(p.id)).map((p) => p.name);
    footer = h('div', {}, [
      again,
      h('p', { class: 'muted', text: next.length ? `Next game: ${next.join(', ')}` : 'Nobody is here for the next game yet.' }),
      err,
    ]);
  }
  const t = s.turn;
  const open = t && t.closedAt == null;
  const head = h('div', { class: 'race-head' }, [
    h('span', { text: `Room ${s.code} · ${s.phase === 'done' || !t ? `Game ${s.round}` : `Character ${t.index + 1} of ${s.roundChars.length}`}` }),
    s.phase !== 'racing'
      ? h('span', { class: 'timer', text: 'Finished!' })
      : counting
        ? h('span', { class: 'timer', 'data-until': String(s.goAt), text: fmt(secondsLeft(ctx, s.goAt)) })
        : open
          ? h('span', { class: 'timer', 'data-until': String(turnDeadline(t!)), text: fmt(secondsLeft(ctx, turnDeadline(t!))) })
          : h('span', { class: 'timer', text: 'Answer' }),
  ]);
  let middle: HTMLElement;
  if (s.phase === 'done') middle = h('div', {}, [h('div', { class: 'winners-head' }, [momo('bounce'), h('h1', { text: 'Winners!' })]), resultsStrip(s, true)]);
  else if (counting) middle = h('h1', { class: 'center', text: 'Ready, set...' });
  else middle = h('div', { class: 'class-turn' }, [turnPicture(s, 300), t && t.closedAt != null ? momo('bounce') : null]);
  return h('div', {}, [
    head,
    middle,
    // Only finished characters show in full; the current and upcoming ones are "?" (the full
    // character next to the one with a stroke missing would give the answer away).
    s.phase === 'racing'
      ? h('div', { class: 'chips' }, s.roundChars.map((c, i) => {
          const finished = t != null && (i < t.index || (i === t.index && t.closedAt != null));
          return h('span', { class: `chip${t && i === t.index ? ' current' : ''}${finished ? '' : ' later'}`, text: finished ? c : '?' });
        }))
      : null,
    board(s),
    footer,
  ]);
}

// --- kid -------------------------------------------------------------------

function kidLobby(ctx: Ctx): HTMLElement {
  const me = ctx.state!.players.find((p) => p.id === ctx.state!.you);
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: `You're in, ${me?.name ?? 'friend'}!`, class: 'center' }),
    h('p', { class: 'notice', text: 'Momo forgot one stroke in each character. Wait for your teacher, then draw the missing stroke as fast as you can!' }),
  ]);
}

function kidLate(ctx: Ctx): HTMLElement {
  return h('div', {}, [
    momo('tilt'),
    h('h1', { text: 'You will play next game', class: 'center' }),
    h('p', { class: 'notice', text: 'This game started without you. Watch the board, and keep this screen on!' }),
    board(ctx.state!),
  ]);
}

function kidDone(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const mine = s.standings.find((r) => r.playerId === s.you);
  const total = s.roundChars.length;
  let again: HTMLElement | null = null;
  if (ctx.backend.solo) {
    const err = h('p', { class: 'error', role: 'status' });
    const btn = h('button', { class: 'btn btn-primary', text: 'Play again (next characters)' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await ctx.backend.act('next');
        ctx.refresh();
      } catch (e) {
        err.textContent = (e as Error).message;
        btn.disabled = false;
      }
    });
    const home = h('a', { class: 'btn btn-secondary', href: '#/', text: 'New list' });
    again = h('div', {}, [btn, h('p'), home, err]);
  }
  const fastest = s.results.map((r) => r.times[s.you]).filter((n) => n != null).sort((a, b) => a - b)[0];
  return h('div', {}, [
    momo('bounce'),
    h('h1', {
      text: ctx.backend.solo ? `You found ${mine?.rights ?? 0} of ${total}!` : mine ? `You are number ${mine.place}!` : 'Game over!',
      class: 'center',
    }),
    mine
      ? h('p', {
          class: 'notice',
          text: ctx.backend.solo
            ? fastest != null ? `Your fastest stroke: ${seconds(fastest)}. 好棒!` : 'Momo says: try again, you can do it!'
            : `You won ${mine.wins} and got ${mine.rights} of ${total} right. 好棒!`,
        })
      : null,
    ctx.backend.solo ? resultsStrip(s) : board(s),
    again,
  ]);
}

/** Each character of the game with its missing stroke in pink: your time (solo) or who was fastest (class). */
function resultsStrip(s: PublicState, forClass = false): HTMLElement {
  return h('div', { class: 'results' }, s.results.map((r) => {
    const label = forClass
      ? r.winners.length ? r.winners.map((id) => nameOf(s, id)).join(', ') : 'nobody'
      : r.times[s.you] != null ? seconds(r.times[s.you]) : 'missed';
    const good = forClass ? r.winners.length > 0 : r.times[s.you] != null;
    return h('div', { class: 'result' }, [glyph(r.char, r.hidden, 96), h('span', { class: good ? 'ok' : 'muted', text: label })]);
  }));
}

/**
 * The kid's screen for one race. Each character (turn) gets a fresh pad that
 * shows only the strokes the room sent. Every stroke the kid draws goes to
 * the room as points; the ROOM says right or wrong, and the pad follows. The
 * room is always the truth: a lost or doubled send (two tabs, a retry) is
 * read back from the room's state, never guessed.
 */
class KidRace {
  readonly el = h('div');
  readonly round: number;
  private seq = 0;
  private pad: PadHandle | null = null;
  private padKey = '';
  private viewKey = '';
  private hintShown = false;
  private again = false;
  private hiccupUntil = 0;
  private errorText: string | null = null;
  private readonly head = h('div', { class: 'race-head' });
  private readonly stage = h('div');
  private readonly status = h('p', { class: 'muted status', role: 'status' });

  constructor(private readonly ctx: Ctx) {
    this.round = ctx.state!.round;
    this.seq = ctx.state!.progress[ctx.state!.you]?.seq ?? 0;
    this.el.append(this.head, this.stage, this.status);
  }

  private get state(): PublicState {
    return this.ctx.state!;
  }

  private size(): number {
    const header = document.querySelector('.avery-header')?.getBoundingClientRect().height ?? 0;
    return Math.max(200, Math.min(window.innerWidth - 40, window.innerHeight - 200 - header, 520));
  }

  private stageNow(): KidStage {
    const s = this.state;
    const t = s.turn;
    if (!t) return 'finished';
    if (s.goAt != null && serverNow(this.ctx) < s.goAt) return 'countdown';
    if (t.closedAt != null) return 'reveal';
    const mine = s.progress[s.you];
    if (mine?.turn === t.index && mine.rightAt != null) return 'right';
    return 'drawing';
  }

  update(): void {
    if (this.sender.gaveUp && this.sender.pending === 0 && !this.ctx.forceFull) this.sender.reset();
    // Never reuse a number the room already has (another tab, or a reload).
    this.seq = Math.max(this.seq, this.state.progress[this.state.you]?.seq ?? 0);
    this.tick();
  }

  private showHead(): void {
    const s = this.state;
    const t = s.turn;
    const stage = this.stageNow();
    const until = stage === 'countdown' ? s.goAt : t && t.closedAt == null ? turnDeadline(t) : null;
    const key = `${t?.index}:${stage}:${until}`;
    if (this.head.dataset.key === key) return;
    this.head.dataset.key = key;
    this.head.replaceChildren(
      h('span', { text: t ? `Character ${t.index + 1} of ${s.roundChars.length}` : '' }),
      until != null ? h('span', { class: 'timer', 'data-until': String(until), text: fmt(secondsLeft(this.ctx, until)) }) : h('span', { class: 'timer', text: 'Answer' })
    );
  }

  tick(): void {
    const s = this.state;
    const t = s.turn;
    const stage = this.stageNow();
    this.showHead();
    if (stage === 'countdown') {
      const n = Math.max(1, Math.ceil((s.goAt! - serverNow(this.ctx)) / 1000));
      const key = `count:${n}`;
      if (this.viewKey !== key) {
        this.viewKey = key;
        const skipped = this.ctx.backend.solo && s.list.skipped?.length ? h('p', { class: 'notice warn', text: skippedNote(s.list.skipped) }) : null;
        this.stage.replaceChildren(h('p', { class: 'countdown', text: String(n) }), h('p', { class: 'notice', text: 'Momo forgot one stroke. Get your finger ready!' }), skipped ?? '');
      }
    } else if (t && (stage === 'drawing' || stage === 'right')) {
      const key = `${this.round}:${t.index}`;
      if (this.padKey === key) {
        this.viewKey = `pad:${key}`;
      } else if (stage === 'right') {
        // Already right (the room says so) but no pad on this phone for it, e.g. after a reload.
        if (this.viewKey !== `got:${key}`) {
          this.viewKey = `got:${key}`;
          this.pad?.destroy();
          this.pad = null;
          this.stage.replaceChildren(glyphFromPaths(t.visible, t.answer, Math.min(this.size(), 320)), momo('bounce'));
        }
      } else {
        this.mount(t);
        this.viewKey = `pad:${key}`;
      }
    } else if (t && stage === 'reveal') {
      const key = `reveal:${t.index}`;
      if (this.viewKey !== key) {
        this.viewKey = key;
        this.pad?.destroy();
        this.pad = null;
        this.padKey = '';
        this.hintShown = false;
        this.again = false;
        const mine = s.progress[s.you];
        const names = t.winners.map((id) => nameOf(s, id));
        const got = mine?.rightAt != null;
        this.stage.replaceChildren(
          glyphFromPaths(t.visible, t.answer, Math.min(this.size(), 320)),
          h('p', { class: 'reveal-line', text: winnerLine(names, t.winners.includes(s.you)) }),
          got ? h('p', { class: 'notice', text: `You got it in ${seconds(mine!.rightAt! - t.opensAt)}. 好棒!` }) : h('p', { class: 'notice', text: 'The pink stroke was the missing one. Next one is coming!' }),
          momo(got ? 'bounce' : 'tilt')
        );
      }
    }
    const mine = s.progress[s.you];
    const missed = mine?.turn === t?.index ? mine?.turnMistakes ?? 0 : 0;
    const text = kidStatusText({
      stage,
      hiccupUntil: this.hiccupUntil,
      now: Date.now(),
      error: this.errorText,
      missesLeftForHint: hintMissesLeft(s.rules.hintAfterMisses, missed),
      hintShowing: this.hintShown,
      again: this.again,
      rightMs: mine?.rightAt != null && t ? mine.rightAt - t.opensAt : null,
    });
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private mount(t: PublicTurn): void {
    this.pad?.destroy();
    this.errorText = null;
    this.hintShown = false;
    this.again = false;
    this.padKey = `${this.round}:${t.index}`;
    const handle = startPad({ size: this.size(), visible: t.visible }, (points) => {
      if (this.pad !== handle) return;
      this.again = false;
      this.send(t.index, points);
    });
    this.pad = handle;
    this.stage.dataset.char = t.char;
    this.stage.replaceChildren(handle.root);
    // A pad rebuilt after the kid already earned the hint shows it again.
    if (t.hint && t.answer) this.showHint(t.answer);
    if (t.visible.length === 0) this.errorText = 'The strokes did not load. Wait a moment...';
  }

  private showHint(answer: string): void {
    this.pad?.flashHint(answer);
    this.hintShown = true;
  }

  /** The room answered a stroke: follow what the ROOM says. */
  private onAnswer(env: Answered, turn: number): void {
    const s = env.state;
    const t = s.turn;
    if (!this.pad || !t || t.index !== turn || this.padKey !== `${this.round}:${turn}`) return;
    const outcome = strokeOutcome(env, s.you, turn);
    // A confirmed answer clears the old notices (hiccup, "draw it again").
    this.hiccupUntil = 0;
    this.again = outcome === 'again';
    if (outcome === 'right') {
      this.hintShown = false;
      this.pad.showRight(t.answer);
      this.cheer();
    } else if (outcome === 'wrong') {
      this.pad.wiggle();
      if (t.hint && t.answer) this.showHint(t.answer);
      else this.hintShown = false;
    }
    this.tick();
  }

  private readonly sender = new StrokeSender<Answered>({
    send: (msg) => this.ctx.backend.send(msg),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: GAME.strokeRetryBackoffMs,
    isRetryable: (err) => !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500,
    onSent: (env, msg) => {
      if (!this.ctx.state || env.state.version >= this.ctx.state.version) this.ctx.state = env.state;
      this.seq = Math.max(this.seq, env.state.progress[env.state.you]?.seq ?? 0);
      this.onAnswer(env, msg.turn);
    },
    onDrained: (gaveUp) => {
      if (gaveUp) {
        this.ctx.forceFull = true;
        this.hiccupUntil = Date.now() + GAME.hiccupNoticeMs;
      }
      this.ctx.refresh();
    },
  });

  private send(turn: number, points: Point[]): void {
    const pts = points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] as [number, number]);
    void this.sender.enqueue({ race: this.round, seq: ++this.seq, turn, points: pts });
  }

  private cheer(): void {
    const overlay = h('div', { class: 'cheer' }, [h('div', {}, [momo(), h('p', { class: 'big', text: '好棒!' }), h('p', { text: 'You found the missing stroke!' })])]);
    document.body.append(overlay);
    setTimeout(() => overlay.remove(), GAME.cheerMs);
  }

  destroy(): void {
    this.pad?.destroy();
    this.pad = null;
    document.querySelectorAll('.cheer').forEach((n) => n.remove());
  }
}
