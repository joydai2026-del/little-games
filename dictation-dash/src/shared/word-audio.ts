// One word's audio, as a pure state machine the kid's pad drives. No DOM, no
// audio element, so every rule is unit-tested:
//
//   waiting  the word has not played yet (the pad is locked: nothing to write)
//   loading  one request is on its way (a second tap never starts another)
//   playing  the word started; the word clock starts the first time this happens
//   heard    it played; "Hear it again" works while replays are left
//   failed   it did not start in time: Try again or Skip
//
// Only a play that STARTED uses up a replay. A failed or cancelled attempt
// never does, so a bad network can never lock a kid out of a word.

export type AudioStatus = 'waiting' | 'loading' | 'playing' | 'heard' | 'failed';

export interface WordAudio {
  wordIndex: number;
  status: AudioStatus;
  /** Plays that started. The first is free; the rest are replays. */
  plays: number;
  /** When the word first started playing (starts the word clock), or null. */
  heardAt: number | null;
}

export function freshAudio(wordIndex: number): WordAudio {
  return { wordIndex, status: 'waiting', plays: 0, heardAt: null };
}

/** Replays left for this word, given the per-word limit. */
export function replaysLeft(a: WordAudio, maxReplays: number): number {
  return Math.max(0, maxReplays - Math.max(0, a.plays - 1));
}

/** Whether a tap on the speaker may start a request now. */
export function canRequest(a: WordAudio, maxReplays: number): boolean {
  if (a.status === 'loading' || a.status === 'playing') return false;
  return a.plays === 0 || replaysLeft(a, maxReplays) > 0;
}

export function requested(a: WordAudio, maxReplays: number): WordAudio {
  return canRequest(a, maxReplays) ? { ...a, status: 'loading' } : a;
}

export function started(a: WordAudio, now: number): WordAudio {
  if (a.status !== 'loading') return a;
  return { ...a, status: 'playing', plays: a.plays + 1, heardAt: a.heardAt ?? now };
}

export function ended(a: WordAudio): WordAudio {
  return a.status === 'playing' ? { ...a, status: 'heard' } : a;
}

export function failed(a: WordAudio): WordAudio {
  return a.status === 'loading' ? { ...a, status: 'failed' } : a;
}

/** Muted, left the screen, or a newer word took over: back to where it was before the tap. */
export function cancelled(a: WordAudio): WordAudio {
  if (a.status !== 'loading' && a.status !== 'playing') return a;
  return { ...a, status: a.plays > 0 ? 'heard' : 'waiting' };
}

/** The kid may write once the word has been heard at least once. */
export function canWrite(a: WordAudio): boolean {
  return a.heardAt != null;
}

/** Ms left on the word clock, or null while it has not started. */
export function wordMsLeft(a: WordAudio, secondsPerWord: number, now: number): number | null {
  if (a.heardAt == null) return null;
  return Math.max(0, secondsPerWord * 1000 - (now - a.heardAt));
}
