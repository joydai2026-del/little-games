// Hearing the word. The rules are the Bilingual Vocab Game's
// src/client/tts.ts, re-built small for this game (the pattern, not the code):
//
//   1. ONE request per word. A second tap while it downloads joins it; a clip
//      already downloaded is reused, so "Hear it again" costs nothing.
//   2. An 8 s START deadline (GAME.speakTimeoutMs): if the word has not
//      started playing by then, the download is aborted and the pad offers
//      Try again / Skip. A hung request never leaves a kid stuck.
//   3. SILENCE WINS on a late play(). The browser may fulfil play() long after
//      it was asked. If by then the game is muted or the screen changed, the
//      element is paused and rewound whoever owns it. If a newer word owns the
//      element, it is left alone. If this call is simply no longer wanted (its
//      deadline fired), it is paused. Do not flip these.
//   4. Nothing plays before the first tap on the page (iOS unlocks one shared
//      <audio> element inside that tap; every clip reuses it).
//   5. Mute: a button on the pad. Memory first, then this device's storage, so
//      a browser that blocks storage still mutes this page. Muting cancels the
//      word that is playing AND the one still downloading.
//   6. Silent mode (?silent=1, for every automated run): the clip is still
//      downloaded (so the run proves real audio bytes came back) but play() is
//      never called. The page carries on as if the word was heard.

import { GAME } from '../shared/config';
import { seatHeaders, type Seat } from './api';

export type SpeakResult = 'started' | 'silenced' | 'cancelled';

export class SpeakTimeout extends Error {
  constructor() {
    super('The word took too long to start.');
    this.name = 'SpeakTimeout';
  }
}
class Cancelled extends Error {}

const MUTE_KEY = 'dictation-dash:mute';
const SILENT_KEY = 'dictation-dash:silent';
// One frame of silence, played inside the first tap to unlock the element.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

let shared: HTMLAudioElement | null = null;
let gestured = false;
let generation = 0;
let owner = 0;
let epoch = 0;
let mutedInMemory: boolean | null = null;
const clips = new Map<string, string>();
let inflight: { key: string; controller: AbortController; promise: Promise<string> } | null = null;
const muteListeners = new Set<() => void>();

export function silentMode(): boolean {
  try {
    if (/[?&]silent=1/.test(location.search) || /[?&]silent=1/.test(location.hash)) {
      localStorage.setItem(SILENT_KEY, '1');
      return true;
    }
    return localStorage.getItem(SILENT_KEY) === '1';
  } catch {
    return /[?&]silent=1/.test(typeof location === 'undefined' ? '' : location.search);
  }
}

export function userMuted(): boolean {
  if (mutedInMemory !== null) return mutedInMemory;
  try {
    mutedInMemory = localStorage.getItem(MUTE_KEY) === 'on';
  } catch {
    mutedInMemory = false;
  }
  return mutedInMemory;
}

export function setUserMuted(on: boolean): void {
  mutedInMemory = on;
  try {
    localStorage.setItem(MUTE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (on) cancelSpeech();
  for (const l of muteListeners) l();
}

export function onMuteChange(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

/** The one question every sound asks before it starts. */
export function soundOff(): boolean {
  return silentMode() || userMuted();
}

function element(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!shared) shared = new Audio();
  return shared;
}

/** Called on the first tap or key press anywhere: unlocks the shared element. */
export function noteUserGesture(): void {
  if (gestured) return;
  gestured = true;
  if (silentMode()) return; // an automated run must never call play()
  const audio = element();
  if (!audio) return;
  try {
    audio.src = SILENCE;
    const p = audio.play();
    if (p && typeof p.then === 'function') void p.then(() => audio.pause()).catch(() => undefined);
    else audio.pause();
  } catch {
    // The first speaker tap will try again.
  }
}

/** Stops the word that is playing and the one downloading. */
export function cancelSpeech(): void {
  generation++;
  try {
    inflight?.controller.abort();
  } catch {
    // nothing to abort
  }
  inflight = null;
  try {
    if (shared) {
      shared.pause();
      shared.currentTime = 0;
    }
  } catch {
    // nothing to pause
  }
}

/** Every screen change: stop everything, and silence anything the browser starts late. */
export function newScreen(): void {
  epoch++;
  cancelSpeech();
}

function download(key: string, url: string, seat: Seat): Promise<string> {
  const cached = clips.get(key);
  if (cached) return Promise.resolve(cached);
  if (inflight && inflight.key === key) return inflight.promise;
  try {
    inflight?.controller.abort();
  } catch {
    // ignore
  }
  const controller = new AbortController();
  const promise = (async () => {
    const res = await fetch(url, { headers: seatHeaders(seat), signal: controller.signal });
    if (!res.ok) throw new Error(`speech failed with status ${res.status}`);
    const type = res.headers.get('content-type') ?? 'audio/mpeg';
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) throw new Error('speech came back empty');
    const objectUrl = URL.createObjectURL(new Blob([buf], { type }));
    clips.set(key, objectUrl);
    if (silentMode()) {
      const said = ((window as unknown as { __ddSaid?: unknown[] }).__ddSaid ??= []);
      said.push({ key, bytes: buf.byteLength, type });
    }
    return objectUrl;
  })();
  const entry = { key, controller, promise };
  inflight = entry;
  const clear = () => {
    if (inflight === entry) inflight = null;
  };
  promise.then(clear, clear);
  return promise;
}

/** Drops every downloaded clip (a new round, or leaving the room). */
export function releaseClips(): void {
  for (const u of clips.values()) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      // already gone
    }
  }
  clips.clear();
}

async function speakNow(key: string, url: string, seat: Seat, onEnded: () => void): Promise<SpeakResult> {
  const mine = ++generation;
  const myEpoch = epoch;
  if (silentMode()) {
    // A test hook, live ONLY in silent mode: rehearse a word that fails or hangs.
    const rehearse = (window as unknown as { __ddSilentSpeak?: string }).__ddSilentSpeak;
    if (rehearse === 'reject') throw new Error('No sound came back.');
    if (rehearse === 'hang') return new Promise<SpeakResult>(() => undefined);
    await download(key, url, seat);
    if (mine !== generation || myEpoch !== epoch) return 'cancelled';
    setTimeout(() => mine === generation && onEnded(), 700);
    return 'started';
  }
  if (userMuted()) return 'silenced';
  const src = await download(key, url, seat);
  if (mine !== generation || soundOff()) return soundOff() ? 'silenced' : 'cancelled';
  const audio = element();
  if (!audio) throw new Error('This browser cannot play sound.');
  audio.pause();
  audio.src = src;
  audio.currentTime = 0;
  audio.onended = () => owner === mine && onEnded();
  owner = mine;
  await audio.play();
  // RULE: SILENCE WINS (see the top of this file). Do not flip.
  if (soundOff() || epoch !== myEpoch) {
    audio.pause();
    audio.currentTime = 0;
    throw new Cancelled();
  }
  if (owner !== mine) {
    if (mine !== generation) throw new Cancelled();
    return 'started';
  }
  if (mine !== generation) {
    audio.pause();
    audio.currentTime = 0;
    throw new Cancelled();
  }
  return 'started';
}

/**
 * Says word `index` of round `round` in room `code`. Resolves once playback
 * STARTED; rejects with SpeakTimeout if it has not started within
 * GAME.speakTimeoutMs, or with an Error if nothing could play.
 */
export async function sayWord(code: string, seat: Seat, round: number, index: number, onEnded: () => void): Promise<SpeakResult> {
  const key = `${code}:${round}:${index}`;
  const url = `/api/rooms/${code}/say?w=${index}`;
  const attempt = speakNow(key, url, seat, onEnded).catch((err: unknown) => {
    if (err instanceof Cancelled) return soundOff() ? ('silenced' as const) : ('cancelled' as const);
    // A pause() from a mute or a newer word interrupts play() with AbortError.
    if ((err as { name?: string })?.name === 'AbortError') return soundOff() ? ('silenced' as const) : ('cancelled' as const);
    throw err;
  });
  const mine = generation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Only cancel if no newer word took over: cancelling then would silence IT.
      if (generation === mine) cancelSpeech();
      reject(new SpeakTimeout());
    }, GAME.speakTimeoutMs);
  });
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
