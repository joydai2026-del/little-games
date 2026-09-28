// One room. Polls the Worker and shows the right screen for this phone:
// teacher (lobby, class board, results) or writer (waiting, writing pad,
// results). A solo practice room is a room whose host is the only writer.
import { ApiError, act, clearSeat, loadSeat, type Envelope, poll, send, setList, setOptions, type Seat } from '../api';
import { GAME, OPTION_LIMITS, type Level } from '../../shared/config';
import type { PublicState } from '../../shared/types';
import { canRequest, cancelled, ended, failed, freshAudio, replaysLeft, requested, started, type WordAudio } from '../../shared/word-audio';
import type { Point } from '../../shared/matcher';
import { inkLayer, startPad, type PadHandle } from '../pad';
import { brand, h, levelBadge, levelPicker, momo, setHeaderLink } from '../ui';
import { goTo, headerLinkOn } from '../route';
import { Sender, type SendMsg } from '../sender';
import { newScreen, onMuteChange, releaseClips, sayWord, setUserMuted, userMuted } from '../speech';
import { board } from './board';

export const HICCUP_TEXT = 'Oops, the internet hiccuped. Keep going from here!';

interface Ctx {
  root: HTMLElement;
  code: string;
  seat: Seat;
  state: PublicState | null;
  offset: number; // serverTime - Date.now()
  /** Set after a send gave up: polls stay FULL until one succeeds. */
  forceFull: boolean;
  refresh(): void;
}

const serverNow = (ctx: Ctx) => Date.now() + ctx.offset;
const secondsLeft = (ctx: Ctx, at: number | null) => Math.max(0, Math.ceil(((at ?? 0) - serverNow(ctx)) / 1000));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const isHost = (s: PublicState) => s.hostId === s.you;

export function renderRoom(root: HTMLElement, code: string): () => void {
  const seat = loadSeat(code);
  if (!seat) {
    window.location.hash = `#/join/${code}`;
    return () => {};
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let kid: KidRound | null = null;
  const ctx: Ctx = { root, code, seat, state: null, offset: 0, forceFull: false, refresh: () => void tick(true) };

  let teacherCounting = false;
  // The class lobby is on the projector: words stay hidden until the teacher taps "Show words".
  let showWords = false;
  const toggleWords = () => {
    showWords = !showWords;
    lastKey = '';
    render();
  };
  let endPolledRound = -1;
  const ticker = setInterval(() => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-until]')) el.textContent = fmt(secondsLeft(ctx, Number(el.dataset.until)));
    kid?.tick();
    const s = ctx.state;
    if (!s || s.phase !== 'racing') return;
    if (teacherCounting && s.goAt != null && serverNow(ctx) >= s.goAt) render();
    if (s.endsAt != null && serverNow(ctx) >= s.endsAt && endPolledRound !== s.round) {
      endPolledRound = s.round;
      ctx.refresh();
    }
  }, 250);

  function render(): void {
    const s = ctx.state!;
    const key = `${s.phase}:${s.round}:${s.role}`;
    setHeaderLink(headerLinkOn(s));
    if (s.role === 'teacher') {
      root.className = 'wide';
      // Keep typing and focus: only rebuild when something visible changed and nobody is typing.
      const active = document.activeElement;
      const typing = active instanceof HTMLTextAreaElement && root.contains(active);
      if (s.phase === 'lobby') {
        const lobbyKey = `${key}:${s.version}:${s.present.join(',')}:${showWords}`;
        if (lobbyKey !== lastKey && !typing) {
          root.replaceChildren(teacherLobby(ctx, showWords, toggleWords));
          lastKey = lobbyKey;
        }
        return;
      }
      if (typing && s.phase === 'done') return;
      teacherCounting = s.phase === 'racing' && s.goAt != null && serverNow(ctx) < s.goAt;
      const raceKey = `${key}:${s.version}:${s.present.join(',')}:${teacherCounting}:${showWords}`;
      if (raceKey !== lastKey) {
        root.replaceChildren(teacherRound(ctx, showWords, toggleWords));
        lastKey = raceKey;
      }
      return;
    }
    root.className = '';
    if (s.phase === 'racing' && !s.me) {
      if (lastKey !== `${key}:late`) root.replaceChildren(kidLate(ctx));
      lastKey = `${key}:late`;
      return;
    }
    if (s.phase === 'racing') {
      if (!kid || kid.round !== s.round) {
        kid?.destroy();
        kid = new KidRound(ctx);
        root.replaceChildren(kid.el);
      }
      kid.update();
      lastKey = key;
      return;
    }
    if (kid) {
      kid.destroy();
      kid = null;
    }
    const doneKey = `${key}:${s.phase === 'done' || s.mode === 'solo' ? s.version : ''}`;
    if (doneKey !== lastKey) {
      root.replaceChildren(s.phase === 'lobby' ? (s.mode === 'solo' ? soloLobby(ctx) : kidLobby(ctx)) : kidDone(ctx));
      lastKey = doneKey;
    }
  }

  async function tick(force = false): Promise<void> {
    if (stopped) return;
    clearTimeout(timer);
    let wait: number = GAME.pollMs.lobby;
    try {
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
      // Only the room's OWN answers mean the seat is dead.
      const roomSaysGone =
        err instanceof ApiError &&
        ((err.status === 404 && err.message === 'that room is not around any more') || (err.status === 403 && err.message === 'not a player in this room'));
      if (roomSaysGone) {
        clearSeat(code);
        const again = h('button', { class: 'btn btn-primary', text: 'Back to the start' });
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
    newScreen();
    releaseClips();
  };
}

// --- shared controls --------------------------------------------------------

function stepper(label: string, value: number, min: number, max: number, step: number, onSet: (n: number) => void): HTMLElement {
  const minus = h('button', { class: 'btn btn-secondary small', text: '−', 'aria-label': `less ${label}` });
  const plus = h('button', { class: 'btn btn-secondary small', text: '+', 'aria-label': `more ${label}` });
  minus.addEventListener('click', () => onSet(Math.max(min, value - step)));
  plus.addEventListener('click', () => onSet(Math.min(max, value + step)));
  return h('div', {}, [h('label', { text: label }), h('div', { class: 'stepper' }, [minus, h('span', { class: 'val', text: String(value) }), plus])]);
}

/** Level buttons + the two steppers: the class lobby, the class done screen, and solo. */
function settingsCard(ctx: Ctx, err: HTMLElement): HTMLElement {
  const s = ctx.state!;
  const save = async (options: Record<string, unknown>) => {
    try {
      await setOptions(ctx.code, ctx.seat, options);
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
  };
  return h('section', { class: 'card' }, [
    h('h2', { text: 'Pick the level' }),
    levelPicker(s.options.level, (level: Level) => void save({ level })),
    h('div', { class: 'row' }, [
      stepper('Base seconds per word', s.options.secondsPerWord, OPTION_LIMITS.secondsPerWord.min, OPTION_LIMITS.secondsPerWord.max, 5, (n) => void save({ secondsPerWord: n })),
      stepper('Words per round', s.options.wordsPerRound, OPTION_LIMITS.wordsPerRound.min, OPTION_LIMITS.wordsPerRound.max, 1, (n) => void save({ wordsPerRound: n })),
    ]),
  ]);
}

/**
 * The list card. The teacher sees a one-line "words we will use" count and
 * every left-out item with the reason; the words themselves only after a tap
 * on "Show words" (the lobby is on the projector while kids join). A writer
 * (solo) never sees them: the room does not send them.
 */
function listCard(ctx: Ctx, err: HTMLElement, words: { shown: boolean; toggle: () => void } | null): HTMLElement {
  const s = ctx.state!;
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
  const n = s.list.count;
  const left: string[] = [];
  if (s.list.skipped.length) left.push(`Headings we skipped (not words): ${s.list.skipped.join(' ')}`);
  if (s.list.missing.length) left.push(`We cannot check strokes for ${s.list.missing.join(' ')} yet, so we left ${s.list.missing.length === 1 ? 'it' : 'them'} out.`);
  if (s.list.tooLong.length) left.push(`Words can have up to ${GAME.maxWordChars} characters. Left out: ${s.list.tooLong.join(' ')}`);
  if (s.list.overflow.length) left.push(`Only the first ${GAME.maxListWords} words are used. Left out: ${s.list.overflow.join(' ')}`);
  const toggle = words ? h('button', { class: 'btn btn-secondary small show-words', text: words.shown ? 'Hide words' : 'Show words' }) : null;
  toggle?.addEventListener('click', () => words!.toggle());
  return h('section', { class: 'card' }, [
    h('h2', { text: `Words we will use: ${n}` }),
    words?.shown
      ? h('div', { class: 'chips' }, s.list.words.map((w) => h('span', { class: 'chip', text: w })))
      : h('p', { class: 'muted', text: words ? 'Hidden, so nobody peeks at the big screen.' : 'Hidden, so you hear them fresh.' }),
    toggle,
    ...left.map((t) => h('p', { class: 'notice warn', text: t })),
    h('details', {}, [h('summary', { text: 'Change the list' }), paste, h('p'), replace]),
  ]);
}

// --- teacher ---------------------------------------------------------------

function teacherLobby(ctx: Ctx, showWords: boolean, toggleWords: () => void): HTMLElement {
  const s = ctx.state!;
  const kids = s.players.filter((p) => s.present.includes(p.id));
  const link = `${location.origin}/#/join/${s.code}`;
  const err = h('p', { class: 'error', role: 'status' });
  const start = h('button', { class: 'btn btn-primary', text: 'Start the race' });
  const why = !s.list.count ? 'Add a word list first.' : !kids.length ? 'Waiting for kids to join...' : '';
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
  return h('div', {}, [
    brand('Kids join on their devices with this code'),
    h('section', { class: 'card' }, [h('p', { class: 'roomcode', text: s.code }), h('p', { class: 'joinlink', text: link })]),
    settingsCard(ctx, err),
    listCard(ctx, err, { shown: showWords, toggle: toggleWords }),
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

function teacherRound(ctx: Ctx, showWords: boolean, toggleWords: () => void): HTMLElement {
  const s = ctx.state!;
  const err = h('p', { class: 'error', role: 'status' });
  const counting = s.phase === 'racing' && s.goAt != null && serverNow(ctx) < s.goAt;
  let footer: HTMLElement | null = null;
  if (s.phase === 'done') {
    const again = h('button', { class: 'btn btn-primary', text: 'Next round (next words)' });
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
    // The same controls as the lobby: switch Easy/Hard, change the clock or the list between rounds.
    footer = h('div', {}, [
      h('h2', { text: 'The words were' }),
      h('div', { class: 'chips' }, s.roundWords.map((w) => h('span', { class: 'chip', text: w }))),
      settingsCard(ctx, err),
      listCard(ctx, err, { shown: showWords, toggle: toggleWords }),
      h('section', { class: 'card' }, [
        again,
        h('p', { class: 'muted', text: next.length ? `Next round: ${next.join(', ')}` : 'Nobody is here for the next round yet.' }),
        err,
      ]),
    ]);
  }
  return h('div', {}, [
    h('div', { class: 'race-head' }, [
      h('span', { text: `Room ${s.code} · Round ${s.round}` }),
      s.phase === 'racing'
        ? h('span', { class: 'timer', 'data-until': String(counting ? s.goAt : s.endsAt), text: fmt(secondsLeft(ctx, counting ? s.goAt : s.endsAt)) })
        : h('span', { class: 'timer', text: 'Finished!' }),
    ]),
    levelBadge(s.options.level),
    s.phase === 'done'
      ? h('div', { class: 'winners-head' }, [momo('bounce'), h('h1', { text: 'Winners!' })])
      : h('h1', { text: counting ? 'Ready, set...' : `Listen and write! ${s.roundSize} words` }),
    board(s),
    footer,
  ]);
}

// --- writer (kid, or the solo player) ---------------------------------------

function kidLobby(ctx: Ctx): HTMLElement {
  const me = ctx.state!.players.find((p) => p.id === ctx.state!.you);
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: `You're in, ${me?.name ?? 'friend'}!`, style: 'text-align:center' }),
    levelBadge(ctx.state!.options.level),
    h('p', { class: 'notice', text: 'Wait for your teacher to start. Turn your sound on: Momo will say each word, and you write it from memory!' }),
  ]);
}

function soloStartButton(ctx: Ctx, label: string, action: 'start' | 'next', err: HTMLElement): HTMLButtonElement {
  const go = h('button', { class: 'btn btn-primary', text: label });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await act(ctx.code, ctx.seat, action);
      ctx.refresh();
    } catch (e) {
      err.textContent = (e as Error).message;
      go.disabled = false;
    }
  });
  return go;
}

function soloLobby(ctx: Ctx): HTMLElement {
  const err = h('p', { class: 'error', role: 'status' });
  return h('div', {}, [
    brand('Practice on your own'),
    settingsCard(ctx, err),
    listCard(ctx, err, null),
    h('section', { class: 'card' }, [soloStartButton(ctx, 'Start practice', 'start', err), err]),
  ]);
}

function kidLate(ctx: Ctx): HTMLElement {
  return h('div', {}, [
    momo('tilt'),
    h('h1', { text: 'You will write next round', style: 'text-align:center' }),
    h('p', { class: 'notice', text: 'This round started without you. Watch the board, and keep this screen on!' }),
    board(ctx.state!),
  ]);
}

function kidDone(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const mine = s.standings.find((r) => r.playerId === s.you);
  const total = s.roundSize;
  const err = h('p', { class: 'error', role: 'status' });
  const solo = s.mode === 'solo';
  return h('div', {}, [
    momo('bounce'),
    h('h1', { text: solo ? 'Practice done!' : mine ? `You are number ${mine.place}!` : 'Round over!', style: 'text-align:center' }),
    mine ? h('p', { class: 'notice', text: `You wrote ${mine.wordsDone} of ${total} word${total === 1 ? '' : 's'}. 好棒!` }) : null,
    h('h2', { text: 'The words were' }),
    h('div', { class: 'chips' }, s.roundWords.map((w) => h('span', { class: 'chip', text: w }))),
    solo ? null : board(s),
    solo && isHost(s) ? settingsCard(ctx, err) : null,
    solo && isHost(s) ? listCard(ctx, err, null) : null,
    solo && isHost(s) ? h('section', { class: 'card' }, [soloStartButton(ctx, 'Next words', 'next', err), err]) : null,
  ]);
}

/**
 * The writing pad for one round. The ROOM is the truth for everything: which
 * word (by index only), how many boxes, which strokes are accepted, when the
 * word clock started and ends. The pad only draws what the room sends and
 * sends the points the finger drew; it never knows the word.
 */
class KidRound {
  readonly el = h('div', { class: 'kid-round' });
  readonly round: number;
  private pad: PadHandle | null = null;
  private padKey = '';
  private shownWord = -1;
  private busy = false; // a cheer or a skip notice is on screen
  private hiccupUntil = 0;
  private errorText: string | null = null;
  private audio: WordAudio = freshAudio(0);
  private minVersion = 0;
  private readonly wordLabel = h('span');
  private readonly mute = h('button', { class: 'btn btn-secondary small mute' });
  private readonly clock = h('span', { class: 'timer' });
  private readonly head = h('div', { class: 'race-head' }, [this.wordLabel, this.mute, this.clock]);
  private readonly wordBar = h('span');
  private readonly listen = h('div', { class: 'listen' });
  private readonly boxes = h('div', { class: 'boxes' });
  private readonly stage = h('div', { class: 'stage' });
  private readonly skipRow = h('div', { class: 'skip-row' });
  private readonly status = h('p', { class: 'muted', role: 'status', style: 'text-align:center' });
  private readonly stopMute: () => void;

  constructor(private readonly ctx: Ctx) {
    this.round = ctx.state!.round;
    this.shownWord = ctx.state!.me?.wordIndex ?? 0;
    this.audio = freshAudio(this.shownWord);
    this.el.append(this.head, levelBadge(ctx.state!.options.level), this.listen, this.boxes, this.stage, this.skipRow, this.status);
    this.mute.addEventListener('click', () => setUserMuted(!userMuted()));
    this.stopMute = onMuteChange(() => {
      this.paintMute();
      this.paintListen();
    });
    this.paintMute();
    const skip = h('button', { class: 'btn btn-secondary small skip', text: '⏭ Skip this word' });
    skip.addEventListener('click', () => this.skip());
    this.skipRow.append(skip);
  }

  private get state(): PublicState {
    return this.ctx.state!;
  }
  private get me() {
    return this.state.me;
  }
  private get beforeGo(): boolean {
    const s = this.state;
    return s.goAt != null && serverNow(this.ctx) < s.goAt;
  }
  private get finished(): boolean {
    return this.me?.finishedAt != null;
  }

  private size(): number {
    const header = document.querySelector('.avery-header')?.getBoundingClientRect().height ?? 0;
    return Math.max(160, Math.min(window.innerWidth - 40, window.innerHeight - 380 - header, 440));
  }

  /** A new room state arrived (poll or a send's answer). */
  update(): void {
    const me = this.me;
    if (!me || this.state.version < this.minVersion) return this.tick();
    if (this.sender.gaveUp && this.sender.pending === 0 && !this.ctx.forceFull) {
      this.sender.reset();
      this.hiccupUntil = Date.now() + GAME.hiccupNoticeMs;
    }
    // The room closed a word (written, skipped, or its clock ran out): cheer, then the next.
    if (me.wordIndex > this.shownWord && !this.busy) {
      const last = me.closed[me.closed.length - 1];
      this.shownWord = me.wordIndex;
      this.audio = freshAudio(me.wordIndex);
      this.dropPad();
      if (last?.result === 'written') this.celebrate([momo(), h('p', { class: 'big', text: '好棒!' }), h('p', { text: this.state.mode === 'solo' ? 'Word done!' : 'Your bean jumps ahead!' })], this.state.mode !== 'solo');
      else this.celebrate([momo('tilt'), h('p', { text: this.skipped ? 'Skipped. Here comes the next word!' : "Time's up for that word. Here comes the next one!" })], false);
      this.skipped = false;
      return;
    }
    this.tick();
  }
  private skipped = false;

  tick(): void {
    const s = this.state;
    const me = this.me;
    const label = this.finished ? 'All done!' : `Word ${(me?.wordIndex ?? 0) + 1} of ${s.roundSize}`;
    if (this.wordLabel.textContent !== label) this.wordLabel.textContent = label;
    this.clock.dataset.until = String(s.endsAt);
    this.clock.textContent = fmt(secondsLeft(this.ctx, s.endsAt));
    this.showStatus();
    if (this.beforeGo) {
      const n = Math.max(1, Math.ceil(((s.goAt ?? 0) - serverNow(this.ctx)) / 1000));
      if (this.stage.dataset.show !== `count${n}`) {
        this.stage.dataset.show = `count${n}`;
        this.stage.replaceChildren(h('p', { class: 'countdown', text: String(n) }), h('p', { class: 'notice', text: 'Ready? Listen to Momo, then write the word.' }));
        this.listen.replaceChildren();
        this.boxes.replaceChildren();
        this.skipRow.hidden = true;
      }
      return;
    }
    if (!me || this.busy) return;
    if (this.finished) {
      const fin = this.sender.pending > 0 || this.sender.gaveUp ? 'sending' : 'done';
      if (this.stage.dataset.show !== fin) {
        this.stage.dataset.show = fin;
        this.dropPad();
        this.listen.replaceChildren();
        this.boxes.replaceChildren();
        this.skipRow.hidden = true;
        this.stage.replaceChildren(
          momo('bounce'),
          h('h1', { text: fin === 'done' ? 'You finished!' : 'Almost there...', style: 'text-align:center' }),
          h('p', { class: 'notice', text: fin === 'done' ? (s.mode === 'solo' ? 'Well done! Your results are coming.' : 'Look at the big screen to see the race.') : 'Sending your writing to the board.' })
        );
      }
      return;
    }
    this.skipRow.hidden = false;
    // First look at a new word: Momo says it straight away.
    if (this.audio.status === 'waiting' && this.audio.plays === 0 && this.stage.dataset.asked !== `${me.wordIndex}`) {
      this.stage.dataset.asked = `${me.wordIndex}`;
      this.hear();
    }
    // The room's word clock ran out: ask the room, which closes the word.
    if (me.deadlineAt != null && serverNow(this.ctx) >= me.deadlineAt && this.stage.dataset.expired !== `${me.wordIndex}`) {
      this.stage.dataset.expired = `${me.wordIndex}`;
      this.ctx.refresh();
    }
    this.paintListen();
    this.paintBoxes();
    if (me.heard) this.paintPad();
    else if (this.stage.dataset.show !== `wait${this.audio.status}`) {
      this.dropPad();
      this.stage.dataset.show = `wait${this.audio.status}`;
      this.stage.replaceChildren(this.audio.status === 'failed' ? this.problem() : h('div', { class: 'pad-locked' }, [momo('tilt'), h('p', { text: 'Listen to Momo first...' })]));
    }
  }

  private paintMute(): void {
    const muted = userMuted();
    this.mute.textContent = muted ? '🔇' : '🔊';
    this.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    this.mute.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
  }

  private paintListen(): void {
    const me = this.me;
    if (!me || this.finished || this.beforeGo) return;
    const total = me.clockMs ?? 1;
    const msLeft = me.deadlineAt == null ? null : Math.max(0, me.deadlineAt - serverNow(this.ctx));
    this.wordBar.style.width = `${msLeft === null ? 100 : Math.round((msLeft / total) * 100)}%`;
    const max = GAME.replaysPerWord;
    const muted = userMuted();
    const key = `${me.wordIndex}:${this.audio.status}:${this.audio.plays}:${muted}:${msLeft === null}`;
    if (this.listen.dataset.key === key) return;
    this.listen.dataset.key = key;
    const left = replaysLeft(this.audio, max);
    const label =
      this.audio.status === 'loading' ? 'Momo is saying it...' : this.audio.status === 'playing' ? 'Listen...' : this.audio.plays === 0 ? 'Hear the word' : left > 0 ? `Hear it again (${left} left)` : 'No more replays';
    const hear = h('button', { class: `btn btn-primary hear${this.audio.status === 'playing' ? ' speaking' : ''}`, text: `🔊 ${label}` });
    hear.disabled = muted || !canRequest(this.audio, max);
    hear.addEventListener('click', () => this.hear());
    this.listen.replaceChildren(
      h('div', { class: 'listen-row' }, [momo(this.audio.status === 'playing' ? 'talk' : ''), hear]),
      ...(muted
        ? [
            h('div', { class: 'notice warn', role: 'status' }, [
              h('p', { text: '🔇 Sound is off. This game needs sound.' }),
              h('button', { class: 'btn btn-primary', text: '🔊 Turn sound on', onclick: () => setUserMuted(false) }),
            ]),
          ]
        : []),
      h('div', { class: 'wordclock', 'aria-label': msLeft === null ? 'The word clock starts when you hear the word' : 'Time left for this word' }, [this.wordBar])
    );
  }

  /** One small 田字格 per character: written ones in ink (from the room's accepted strokes), the current one ringed. */
  private paintBoxes(): void {
    const me = this.me!;
    const n = me.charCount ?? 0;
    const key = `${me.wordIndex}:${me.charIndex}:${n}`;
    if (this.boxes.dataset.key === key) return;
    this.boxes.dataset.key = key;
    this.boxes.replaceChildren(
      ...Array.from({ length: n }, (_, i) =>
        h('span', { class: `box${i < me.charIndex ? ' done' : i === me.charIndex ? ' now' : ''}`, 'aria-label': i < me.charIndex ? 'written' : i === me.charIndex ? 'writing now' : 'still to write' }, [
          i < me.charIndex ? miniInk(me.accepted[i] ?? []) : null,
        ])
      )
    );
  }

  private dropPad(): void {
    this.pad?.destroy();
    this.pad = null;
    this.padKey = '';
  }

  /** The big pad for the current character, redrawn from what the room says. */
  private paintPad(): void {
    const me = this.me!;
    const view = { ink: me.accepted[me.charIndex] ?? [], outline: me.outline, hint: me.hint };
    this.pad?.root.classList.toggle('spent', me.missesLeft === 0);
    const charKey = `${me.wordIndex}:${me.charIndex}`;
    if (!this.pad || !this.padKey.startsWith(`${charKey}|`)) {
      this.dropPad();
      const wordIndex = me.wordIndex;
      const charIndex = me.charIndex;
      const handle = startPad({ size: this.size(), level: this.state.options.level, view }, (points) => this.sendStroke(handle, wordIndex, charIndex, points));
      this.pad = handle;
      this.stage.dataset.show = 'pad';
      this.stage.replaceChildren(handle.root);
    }
    const viewKey = `${charKey}|${view.ink.length}:${view.outline ? 1 : 0}:${view.hint ?? ''}`;
    if (viewKey !== this.padKey) {
      this.pad.show(view);
      this.padKey = viewKey;
    }
  }

  private problem(): HTMLElement {
    const retry = h('button', { class: 'btn btn-primary', text: '🔊 Try again' });
    retry.addEventListener('click', () => this.hear());
    const skip = h('button', { class: 'btn btn-secondary', text: '⏭ Skip this word' });
    skip.addEventListener('click', () => this.skip());
    return h('div', { class: 'problem', role: 'status' }, [
      h('p', { text: 'The word did not play. Check the sound, then try again, or skip this word.' }),
      h('div', { class: 'row' }, [retry, skip]),
    ]);
  }

  private hear(): void {
    const me = this.me;
    if (!me || !canRequest(this.audio, GAME.replaysPerWord) || userMuted()) {
      this.paintListen();
      return;
    }
    const index = me.wordIndex;
    this.audio = requested(this.audio, GAME.replaysPerWord);
    delete this.stage.dataset.show;
    this.paintListen();
    sayWord(this.ctx.code, this.ctx.seat, this.round, index, () => {
      if (this.shownWord === index) {
        this.audio = ended(this.audio);
        this.paintListen();
      }
    }).then(
      (result) => {
        if (this.shownWord !== index) return;
        this.audio = result === 'started' ? started(this.audio, Date.now()) : cancelled(this.audio);
        // The room started this word's clock when it served the clip: fetch it.
        if (result === 'started' && !this.me?.heard) this.ctx.refresh();
        this.tick();
      },
      (err: unknown) => {
        if (this.shownWord !== index) return;
        this.audio = failed(this.audio);
        console.warn('word did not play', err);
        this.tick();
      }
    );
  }

  private showStatus(): void {
    const me = this.me;
    let text = '';
    if (this.errorText && !this.beforeGo) text = this.errorText;
    else if (Date.now() < this.hiccupUntil) text = HICCUP_TEXT;
    else if (!this.beforeGo && me && !this.finished && me.heard)
      text = me.missesLeft === 0 ? 'No more tries on this word. Tap Skip for the next one.' : me.hint ? 'Look at the pink stroke, then write it.' : this.state.options.level === 'easy' ? 'Write it stroke by stroke. The faint outline helps you.' : 'Write it from memory, stroke by stroke.';
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private readonly sender = new Sender<Envelope & { verdict?: 'correct' | 'mistake' }>({
    send: (msg: SendMsg) => send(this.ctx.code, this.ctx.seat, msg),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: GAME.sendRetryBackoffMs,
    isRetryable: (err) => !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500,
    onSent: (env) => {
      this.ctx.state = env.state;
      this.minVersion = Math.max(this.minVersion, env.state.version);
      if (env.verdict === 'mistake') this.pad?.wiggle();
      this.pad?.lock(false);
      this.update();
    },
    onDrained: (gaveUp) => {
      this.pad?.lock(false);
      if (gaveUp) this.ctx.forceFull = true;
      this.ctx.refresh();
    },
  });

  private sendStroke(handle: PadHandle, wordIndex: number, charIndex: number, points: Point[]): void {
    if (this.pad !== handle || !this.me) return;
    this.errorText = null;
    const pts = points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
    void this.sender.enqueue({ kind: 'stroke', race: this.round, seq: this.me.seq + 1 + this.sender.pending, wordIndex, charIndex, points: pts });
  }

  /** Moves on without writing this word. A skipped word scores 0. */
  private skip(): void {
    const me = this.me;
    if (this.busy || !me || this.finished) return;
    newScreen(); // the old word must never play over the next one
    this.skipped = true;
    void this.sender.enqueue({ kind: 'skip', race: this.round, seq: me.seq + 1 + this.sender.pending, wordIndex: me.wordIndex });
  }

  private celebrate(children: HTMLElement[], withBoard: boolean): void {
    this.busy = true;
    this.skipRow.hidden = true;
    const s = this.state;
    const overlay = h('div', { class: 'cheer' }, [
      h('div', {}, withBoard ? [...children, board(s, { compact: true, jumpFor: s.you })] : children),
    ]);
    document.body.append(overlay);
    setTimeout(() => {
      overlay.remove();
      delete this.stage.dataset.show;
      this.listen.dataset.key = '';
      this.boxes.dataset.key = '';
      this.busy = false;
      this.update();
    }, GAME.cheerMs);
  }

  destroy(): void {
    this.dropPad();
    this.stopMute();
    document.querySelectorAll('.cheer').forEach((n) => n.remove());
  }
}

/** A tiny picture of a written box: the kid's own accepted strokes. */
function miniInk(strokes: number[][][]): SVGElement {
  const el = inkLayer(strokes, 58, 'mini');
  el.setAttribute('aria-hidden', 'true');
  return el;
}
