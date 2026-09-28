// Every game number that may change lives here. Game logic reads these, never
// a literal. Teacher-visible settings are clamped by normalizeOptions so a bad
// value from a phone or an agent can never break a room.

export type Level = 'easy' | 'hard';
export const LEVELS: readonly Level[] = ['easy', 'hard'];

export interface DashOptions {
  /** Easy = a faint outline of the character shows in the box. Hard = a blank box, write from memory. */
  level: Level;
  /** Seconds each word gets once it has been heard. The round clock is built from this too. */
  secondsPerWord: number;
  /** Words in one round, taken in order from the teacher's list. */
  wordsPerRound: number;
}

export const DEFAULT_OPTIONS: DashOptions = {
  level: 'easy',
  secondsPerWord: 40,
  wordsPerRound: 5,
};

export const OPTION_LIMITS = {
  secondsPerWord: { min: 15, max: 120 },
  wordsPerRound: { min: 1, max: 15 },
} as const;

/** What each level does to the writing box. Both levels grade strokes the same way. */
export const LEVEL_RULES: Record<Level, { showOutline: boolean; label: string; blurb: string }> = {
  // The room sends the outline ONLY on Easy, and only after the word was heard.
  easy: { showOutline: true, label: 'Easy', blurb: 'A faint outline shows in the box' },
  hard: { showOutline: false, label: 'Hard', blurb: 'Blank box. Write it from memory' },
};

/** Product flags. No paywall code reads these yet. */
export const PRODUCT = {
  /** Paid tier later, because every new word costs a speech call (Workers AI). */
  paidLater: true,
} as const;

export const GAME = {
  /** Ready, set, go before strokes count. */
  countdownSeconds: 3,
  /** Kids per class room. */
  maxKids: 40,
  /** Words kept from one paste. */
  maxListWords: 40,
  /** Longest word (in characters) that fits the boxes. Longer runs are reported and left out. */
  maxWordChars: 4,
  /** Longest pasted text accepted, in characters. */
  maxPasteLength: 4000,
  /** Longest display name. */
  maxNameLength: 16,
  /** A room disappears this long after it was made. */
  roomTtlMinutes: 120,
  /** "Hear it again" taps allowed per word, after the first play. */
  replaysPerWord: 2,
  /** A word that has not STARTED playing by now shows Try again / Skip (ms). */
  speakTimeoutMs: 8000,
  /** Extra seconds per word on the round clock, for loading and hearing the word. */
  hearSlackSeconds: 6,
  /** Misses on one stroke before the room shows that stroke as a hint (so nobody is stuck for good). */
  hintAfterMisses: 4,
  /**
   * What one correct stroke scores. On Hard, a stroke that was only right after
   * the hint showed counts as "helped" and scores less (Claude review ruling,
   * 2026-09-28); on Easy the outline is there anyway, so full credit.
   */
  strokeScore: { easy: { plain: 1, helped: 1 }, hard: { plain: 1, helped: 0.5 } },
  /** Joins one room accepts per minute (a script cannot flood a class list). */
  joinsPerMinute: 60,
  /** Client polling, in ms. */
  pollMs: { lobby: 1500, racing: 800, done: 2500 },
  /** How long the "your bean jumps" cheer shows between words, in ms. */
  cheerMs: 1600,
  /** How forgiving the ROOM's stroke matcher is (src/shared/matcher.ts; 1 = Hanzi Writer's default). */
  leniency: 1.3,
  /** Pen width while a kid draws, in stroke-data units (1024 = the box). */
  drawingWidth: 34,
  /** Most points one drawn stroke may carry (the pad thins longer drags). Same as Missing Stroke. */
  maxStrokePoints: 256,
  /** A short line ending in a colon with this many Chinese characters or fewer, over more Chinese lines, is a label (Tianzige's rule). */
  headingLineMax: 8,
  /** Waits between the phone's retries of one send (ms). After the last one it resyncs with the room. */
  sendRetryBackoffMs: [300, 800, 1500],
  /**
   * Pace floor, in ms per correct stroke, checked on the server: the n-th
   * correct stroke of a round may not land before GO + n x this.
   */
  minStrokeMs: 250,
  /** Largest request body the Worker reads, in bytes. */
  maxBodyBytes: 32_768,
  /** Deadline on every request the phone makes (ms). */
  requestTimeoutMs: 8000,
  /** How long "the internet hiccuped" stays on the kid's screen after a resync (ms). */
  hiccupNoticeMs: 3500,
  /** Largest jump in a player's send sequence number accepted at once. */
  maxSeqJump: 1000,
  /** A kid not seen for this long (ms) is left out of the next round. */
  rosterActiveMs: 45_000,
  /** Room codes tried before giving up on a create. */
  roomCodeAttempts: 5,
  /** How stale a player's lastSeenAt may get on disk before a plain poll writes it. */
  lastSeenWriteMs: 15_000,
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Clamps every setting; a missing or junk value keeps `base` (the room's current setting, or the default). */
export function normalizeOptions(input?: Partial<Record<keyof DashOptions, unknown>> | null, base: DashOptions = DEFAULT_OPTIONS): DashOptions {
  const src = input ?? {};
  return {
    level: LEVELS.includes(src.level as Level) ? (src.level as Level) : base.level,
    secondsPerWord: clampInt(src.secondsPerWord, OPTION_LIMITS.secondsPerWord.min, OPTION_LIMITS.secondsPerWord.max, base.secondsPerWord),
    wordsPerRound: clampInt(src.wordsPerRound, OPTION_LIMITS.wordsPerRound.min, OPTION_LIMITS.wordsPerRound.max, base.wordsPerRound),
  };
}
