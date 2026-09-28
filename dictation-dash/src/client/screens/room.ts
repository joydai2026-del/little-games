// One room. Polls the Worker and shows the right screen for this phone:
// teacher (lobby, class board, results) or writer (waiting, writing pad,
// results). A solo practice room is a room whose host is the only writer.
import { ApiError, act, clearSeat, loadSeat, type Envelope, poll, send, setList, setOptions, type Seat } from '../api';
import { GAME, OPTION_LIMITS, type Level } from '../../shared/config';
import type { PublicState, StrokeResult } from '../../shared/types';
import { canRequest, canWrite, cancelled, ended, failed, freshAudio, replaysLeft, requested, started, wordMsLeft, type WordAudio } from '../../shared/word-audio';
import { startWrite, type WriteHandle } from '../writer';
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
      if (s.phase === 'lobby') {
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
      const raceKey = `${key}:${s.version}:${s.present.join(',')}:${teacherCounting}`;
      if (raceKey !== lastKey) {
        root.replaceChildren(teacherRound(ctx));
        lastKey = raceKey;
      }
      return;
    }
    root.className = '';
    if (s.phase === 'racing' && !s.progress[s.you]) {
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

/** Level buttons + the two steppers, for the teacher lobby and solo practice. */
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
      stepper('Seconds per word', s.options.secondsPerWord, OPTION_LIMITS.secondsPerWord.min, OPTION_LIMITS.secondsPerWord.max, 5, (n) => void save({ secondsPerWord: n })),
      stepper('Words per round', s.options.wordsPerRound, OPTION_LIMITS.wordsPerRound.min, OPTION_LIMITS.wordsPerRound.max, 1, (n) => void save({ wordsPerRound: n })),
    ]),
  ]);
}

function listCard(ctx: Ctx, err: HTMLElement, showWords: boolean): HTMLElement {
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
  const left: string[] = [];
  if (s.list.missing.length) left.push(`We cannot check strokes for ${s.list.missing.join(' ')} yet, so we left ${s.list.missing.length === 1 ? 'it' : 'them'} out.`);
  if (s.list.tooLong.length) left.push(`Words can have up to ${GAME.maxWordChars} characters. Left out: ${s.list.tooLong.join(' ')}`);
  if (s.list.overflow.length) left.push(`Only the first ${GAME.maxListWords} words are used. Left out: ${s.list.overflow.join(' ')}`);
  return h('section', { class: 'card' }, [
    h('h2', { text: `Words (${s.list.words.length})` }),
    showWords ? h('div', { class: 'chips' }, s.list.words.map((w) => h('span', { class: 'chip', text: w }))) : h('p', { class: 'muted', text: 'Hidden, so nobody peeks. The kids hear them one at a time.' }),
    ...left.map((t) => h('p', { class: 'notice warn', text: t })),
    h('details', {}, [h('summary', { text: 'Change the list' }), paste, h('p'), replace]),
  ]);
}

// --- teacher ---------------------------------------------------------------

function teacherLobby(ctx: Ctx): HTMLElement {
  const s = ctx.state!;
  const kids = s.players.filter((p) => s.present.includes(p.id));
  const link = `${location.origin}/#/join/${s.code}`;
  const err = h('p', { class: 'error', role: 'status' });
  const start = h('button', { class: 'btn btn-primary', text: 'Start the race' });
  const why = !s.list.words.length ? 'Add a word list first.' : !kids.length ? 'Waiting for kids to join...' : '';
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
    listCard(ctx, err, true),
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

function teacherRound(ctx: Ctx): HTMLElement {
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
    footer = h('div', {}, [
      h('h2', { text: 'The words were' }),
      h('div', { class: 'chips' }, s.roundWords.map((w) => h('span', { class: 'chip', text: w }))),
      h('p'),
      again,
      h('p', { class: 'muted', text: next.length ? `Next round: ${next.join(', ')}` : 'Nobody is here for the next round yet.' }),
      err,
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
      : h('h1', { text: counting ? 'Ready, set...' : `Listen and write! ${s.roundWords.length} words` }),
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
    listCard(ctx, err, false),
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
  const total = s.roundWords.length;
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
    solo && isHost(s) ? h('section', { class: 'card' }, [soloStartButton(ctx, 'Next words', 'next', err), err]) : null,
  ]);
}

/**
 * The writing pad for one round.
 *
 * Per word: Momo says it (the pad waits until it has been heard), the kid
 * writes each character in its own 田字格, stroke by stroke. The pad moves
 * ahead of the room, and is reconciled with it whenever nothing is in flight:
 * if the room disagrees, the pad jumps to where the room says this kid is.
 */
class KidRound {
  readonly el = h('div', { class: 'kid-round' });
  readonly round: number;
  private wordIndex = 0;
  private charIndex = 0;
  private startStroke = 0;
  private strokesDone = 0;
  private seq = 0;
  private writer: WriteHandle | null = null;
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
  /** Words this kid has written this round, as the pad knows it (the cheer's bean uses it). */
  private written = 0;
  private readonly listen = h('div', { class: 'listen' });
  private readonly boxes = h('div', { class: 'boxes' });
  private readonly stage = h('div', { class: 'stage' });
  private readonly status = h('p', { class: 'muted', role: 'status', style: 'text-align:center' });
  private readonly stopMute: () => void;

  constructor(private readonly ctx: Ctx) {
    this.round = ctx.state!.round;
    this.adoptServer();
    this.el.append(this.head, levelBadge(ctx.state!.options.level), this.listen, this.boxes, this.stage, this.status);
    this.mute.addEventListener('click', () => setUserMuted(!userMuted()));
    this.stopMute = onMuteChange(() => {
      this.paintMute();
      this.paintListen();
    });
    this.paintMute();
  }

  private get state(): PublicState {
    return this.ctx.state!;
  }
  private get word(): string[] {
    return [...(this.state.roundWords[this.wordIndex] ?? '')];
  }
  private get total(): number {
    return this.state.roundWords.length;
  }
  private get beforeGo(): boolean {
    const s = this.state;
    return s.goAt != null && serverNow(this.ctx) < s.goAt;
  }

  private size(): number {
    const header = document.querySelector('.avery-header')?.getBoundingClientRect().height ?? 0;
    return Math.max(160, Math.min(window.innerWidth - 40, window.innerHeight - 330 - header, 440));
  }

  /** Take the room's word for where this kid is. */
  private adoptServer(): void {
    const mine = this.state.progress[this.state.you];
    const wordIndex = mine?.wordIndex ?? 0;
    if (wordIndex !== this.audio.wordIndex) this.audio = freshAudio(wordIndex);
    this.wordIndex = wordIndex;
    this.charIndex = mine?.charIndex ?? 0;
    this.startStroke = mine?.strokeIndex ?? 0;
    this.strokesDone = this.startStroke;
    this.seq = mine?.seq ?? 0;
    this.written = mine?.wordsDone ?? 0;
  }

  private outOfStep(): boolean {
    if (this.sender.pending > 0 || this.busy || this.state.version < this.minVersion) return false;
    const mine = this.state.progress[this.state.you];
    if (!mine) return false;
    const localDone = this.wordIndex >= this.total;
    const serverDone = mine.finishedAt != null;
    if (localDone || serverDone) return localDone !== serverDone;
    return mine.wordIndex !== this.wordIndex || mine.charIndex !== this.charIndex || mine.strokeIndex !== this.strokesDone;
  }

  private resync(): void {
    this.writer?.destroy();
    this.writer = null;
    delete this.stage.dataset.show;
    this.sender.reset();
    this.adoptServer();
    this.hiccupUntil = Date.now() + GAME.hiccupNoticeMs;
  }

  update(): void {
    if (this.outOfStep()) this.resync();
    else if (this.sender.gaveUp && this.sender.pending === 0 && !this.ctx.forceFull) this.sender.reset();
    this.tick();
  }

  /** Called 4 times a second and after every state change. */
  tick(): void {
    const s = this.state;
    const done = this.wordIndex >= this.total;
    const label = done ? 'All done!' : `Word ${this.wordIndex + 1} of ${this.total}`;
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
      }
      return;
    }
    if (done) {
      const fin = this.sender.pending > 0 || this.sender.gaveUp ? 'sending' : 'done';
      if (!this.busy && this.stage.dataset.show !== fin) {
        this.stage.dataset.show = fin;
        this.listen.replaceChildren();
        this.boxes.replaceChildren();
        this.stage.replaceChildren(
          momo('bounce'),
          h('h1', { text: fin === 'done' ? 'You finished!' : 'Almost there...', style: 'text-align:center' }),
          h('p', { class: 'notice', text: fin === 'done' ? (s.mode === 'solo' ? 'Well done! Your results are coming.' : 'Look at the big screen to see the race.') : 'Sending your writing to the board.' })
        );
      }
      return;
    }
    if (this.busy) return;
    // First look at a new word: Momo says it straight away.
    if (this.audio.status === 'waiting' && this.audio.plays === 0 && !this.stage.dataset.asked) {
      this.stage.dataset.asked = String(this.wordIndex);
      this.hear();
    }
    // The word clock: out of time on this word = move on (no penalty beyond the lost word).
    const left = wordMsLeft(this.audio, s.options.secondsPerWord, Date.now());
    if (left === 0) {
      this.skip("Time's up for that word. Here comes the next one!");
      return;
    }
    this.paintListen(left);
    this.paintBoxes();
    if (canWrite(this.audio) && !this.writer) this.mount();
    if (!canWrite(this.audio) && this.stage.dataset.show !== `wait${this.audio.status}`) {
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

  private paintListen(msLeft: number | null = wordMsLeft(this.audio, this.state.options.secondsPerWord, Date.now())): void {
    if (this.wordIndex >= this.total || this.beforeGo) return;
    const max = GAME.replaysPerWord;
    const muted = userMuted();
    const pct = msLeft === null ? 100 : Math.round((msLeft / (this.state.options.secondsPerWord * 1000)) * 100);
    this.wordBar.style.width = `${pct}%`;
    // Rebuild only when something a tap depends on changed (never on the clock alone).
    const key = `${this.wordIndex}:${this.audio.status}:${this.audio.plays}:${muted}:${msLeft === null}`;
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

  private paintBoxes(): void {
    const key = `${this.wordIndex}:${this.charIndex}`;
    if (this.boxes.dataset.key === key) return;
    this.boxes.dataset.key = key;
    this.boxes.replaceChildren(
      ...this.word.map((ch, i) =>
        h('span', { class: `box${i < this.charIndex ? ' done' : i === this.charIndex ? ' now' : ''}`, 'aria-label': i < this.charIndex ? `written ${ch}` : i === this.charIndex ? 'writing now' : 'still to write' }, [
          i < this.charIndex ? ch : '',
        ])
      )
    );
  }

  private problem(): HTMLElement {
    const retry = h('button', { class: 'btn btn-primary', text: '🔊 Try again' });
    retry.addEventListener('click', () => this.hear());
    const skip = h('button', { class: 'btn btn-secondary', text: '⏭ Skip this word' });
    skip.addEventListener('click', () => this.skip('Skipped. Here comes the next word!'));
    return h('div', { class: 'problem', role: 'status' }, [
      h('p', { text: 'The word did not play. Check the sound, then try again, or skip this word.' }),
      h('div', { class: 'row' }, [retry, skip]),
    ]);
  }

  private hear(): void {
    if (!canRequest(this.audio, GAME.replaysPerWord) || userMuted()) {
      this.paintListen();
      return;
    }
    const index = this.wordIndex;
    this.audio = requested(this.audio, GAME.replaysPerWord);
    delete this.stage.dataset.show;
    this.paintListen();
    sayWord(this.ctx.code, this.ctx.seat, this.round, index, () => {
      if (this.wordIndex === index) {
        this.audio = ended(this.audio);
        this.paintListen();
      }
    }).then(
      (result) => {
        if (this.wordIndex !== index) return;
        this.audio = result === 'started' ? started(this.audio, Date.now()) : cancelled(this.audio);
        this.tick();
      },
      (err: unknown) => {
        if (this.wordIndex !== index) return;
        this.audio = failed(this.audio);
        console.warn('word did not play', err);
        this.tick();
      }
    );
  }

  private showStatus(): void {
    let text = '';
    if (this.errorText && !this.beforeGo) text = this.errorText;
    else if (Date.now() < this.hiccupUntil) text = HICCUP_TEXT;
    else if (!this.beforeGo && this.wordIndex < this.total && canWrite(this.audio))
      text = this.state.options.level === 'easy' ? 'Write it stroke by stroke. The faint outline helps you.' : 'Write it from memory, stroke by stroke.';
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private mount(): void {
    const char = this.word[this.charIndex];
    if (!char) return;
    const wordIndex = this.wordIndex;
    const charIndex = this.charIndex;
    this.strokesDone = this.startStroke;
    this.errorText = null;
    const handle = startWrite(char, { size: this.size(), level: this.state.options.level, startStroke: this.startStroke }, {
      onCorrect: (i) => {
        if (this.writer !== handle) return;
        this.strokesDone = i + 1;
        this.sendStroke(wordIndex, charIndex, i, 'correct');
      },
      onMistake: (i) => this.writer === handle && this.sendStroke(wordIndex, charIndex, i, 'mistake'),
      onComplete: () => this.writer === handle && this.charDone(),
      onError: (msg) => {
        this.errorText = msg;
        this.showStatus();
      },
    });
    this.writer = handle;
    this.stage.dataset.show = 'pad';
    this.stage.replaceChildren(handle.root);
  }

  private readonly sender = new Sender<Envelope>({
    send: (msg: SendMsg) => send(this.ctx.code, this.ctx.seat, msg),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: GAME.sendRetryBackoffMs,
    isRetryable: (err) => !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500,
    onSent: (env) => {
      this.ctx.state = env.state;
      this.minVersion = Math.max(this.minVersion, env.state.version);
    },
    onDrained: (gaveUp) => {
      if (gaveUp) this.ctx.forceFull = true;
      this.ctx.refresh();
    },
  });

  private sendStroke(wordIndex: number, charIndex: number, strokeIndex: number, result: StrokeResult): void {
    void this.sender.enqueue({ kind: 'stroke', race: this.round, seq: ++this.seq, wordIndex, charIndex, strokeIndex, result });
  }

  /** One character written. The next character of the word, or the word is done. */
  private charDone(): void {
    const last = this.charIndex + 1 >= this.word.length;
    if (!last) {
      // Let the kid see the finished character for a moment, then the next box.
      this.busy = true;
      setTimeout(() => {
        this.writer?.destroy();
        this.writer = null;
        this.charIndex += 1;
        this.startStroke = 0;
        this.strokesDone = 0;
        this.busy = false;
        this.update();
      }, 450);
      return;
    }
    const solo = this.state.mode === 'solo';
    this.written += 1;
    this.celebrate(
      [momo(), h('p', { class: 'big', text: '好棒!' }), h('p', { text: solo ? 'Word done!' : 'Your bean jumps ahead!' })],
      !solo,
      true
    );
  }

  /** Moves on without writing this word. No score, no other penalty. */
  private skip(message: string): void {
    if (this.busy || this.wordIndex >= this.total) return;
    newScreen(); // the old word must never play over the next one
    void this.sender.enqueue({ kind: 'skip', race: this.round, seq: ++this.seq, wordIndex: this.wordIndex });
    this.celebrate([momo('tilt'), h('p', { text: message })], false, false);
  }

  private celebrate(children: HTMLElement[], withBoard: boolean, jump: boolean): void {
    this.busy = true;
    this.writer?.destroy();
    this.writer = null;
    // The board as the pad knows it: this kid's bean already one word ahead,
    // even if the room has not answered yet.
    const s: PublicState = {
      ...this.state,
      standings: this.state.standings.map((r) => (r.playerId === this.state.you ? { ...r, wordsDone: Math.max(r.wordsDone, this.written) } : r)),
    };
    const overlay = h('div', { class: 'cheer' }, [
      h("div", {}, withBoard ? [...children, board(s, { compact: true, jumpFor: jump ? s.you : undefined })] : children),
    ]);
    document.body.append(overlay);
    setTimeout(() => {
      overlay.remove();
      this.wordIndex += 1;
      this.charIndex = 0;
      this.startStroke = 0;
      this.strokesDone = 0;
      this.audio = freshAudio(this.wordIndex);
      delete this.stage.dataset.asked;
      delete this.stage.dataset.show;
      this.listen.dataset.key = '';
      this.boxes.dataset.key = '';
      this.busy = false;
      this.update();
    }, GAME.cheerMs);
  }

  destroy(): void {
    this.writer?.destroy();
    this.writer = null;
    this.stopMute();
    document.querySelectorAll('.cheer').forEach((n) => n.remove());
  }
}
