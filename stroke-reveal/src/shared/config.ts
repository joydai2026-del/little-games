// Every game number that may change lives here. Game logic reads these, never
// a literal. Teacher-visible settings are clamped by normalizeOptions so a bad
// value from a phone or an agent can never break a room.

/** Class level. It sets how fast Momo draws and what a wrong guess costs. */
export type Level = 'k2' | 'g35';

export interface LevelRules {
  /** Label on the teacher screen. */
  label: string;
  /** Milliseconds between two strokes of the drawing. */
  strokeMs: number;
  /** A wrong guess locks the kid out of this character (true), or only pauses them (false). */
  lockOnWrong: boolean;
  /** With no lock: how long the cards stay grey after a wrong guess (ms). */
  wrongCooldownMs: number;
}

export const LEVELS: Record<Level, LevelRules> = {
  k2: { label: 'K-2', strokeMs: 1500, lockOnWrong: false, wrongCooldownMs: 2000 },
  g35: { label: 'Grades 3-5', strokeMs: 900, lockOnWrong: true, wrongCooldownMs: 0 },
};

export interface RevealOptions {
  level: Level;
  /** How many characters one round draws, taken in order from the teacher's list. */
  charsPerRound: number;
}

export const DEFAULT_OPTIONS: RevealOptions = {
  level: 'k2',
  charsPerRound: 5,
};

export const OPTION_LIMITS = {
  charsPerRound: { min: 1, max: 20 },
} as const;

export const SCORING = {
  /** Points for a right guess the moment the first stroke appears. */
  maxPoints: 1000,
  /** Points for a right guess after the whole character is drawn. */
  minPoints: 100,
} as const;

export const GAME = {
  /** Ready, set, go before the first drawing starts. */
  countdownSeconds: 3,
  /** Word cards on each kid's phone (the right one plus wrong ones from the list). */
  cardsPerQuestion: 4,
  /** Guessing stays open this long after the last stroke is drawn (ms). */
  holdAfterDrawnMs: 6000,
  /** How long the answer shows before the next character starts (ms). */
  answerShowMs: 4000,
  /** Kids per room. */
  maxKids: 40,
  /** Words kept from one paste. */
  maxListWords: 60,
  /** Longest pasted text accepted, in characters. */
  maxPasteLength: 4000,
  /** A run of Han characters this long or shorter is one word card; longer runs split into single characters. */
  maxWordLen: 4,
  /** Most Chinese characters a colon-ended line can have and still be a heading label. */
  headingLineMax: 8,
  /** Longest display name. */
  maxNameLength: 16,
  /** A room disappears this long after it was made. */
  roomTtlMinutes: 120,
  /** Client polling, in ms. */
  pollMs: { lobby: 1500, playing: 700, done: 2500 },
  /** Largest request body the Worker reads, in bytes. */
  maxBodyBytes: 32_768,
  /** Deadline on every request the phone makes (ms). */
  requestTimeoutMs: 8000,
  /** Largest jump in a player's guess sequence number accepted in one guess. */
  maxSeqJump: 1000,
  /** A kid who has not been seen for this long (ms) is left out of the next round. */
  rosterActiveMs: 45_000,
  /** Room codes tried before giving up on a create. */
  roomCodeAttempts: 5,
  /** How stale a player's lastSeenAt may get on disk before a plain poll writes it. */
  lastSeenWriteMs: 15_000,
  /** Speed of one stroke's animation on the big screen (hanzi-writer strokeAnimationSpeed; 1 = library default). */
  strokeAnimationSpeed: 1.6,
  /** Faster speed used to catch up after a reload mid-drawing. */
  catchUpAnimationSpeed: 6,
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeOptions(input?: Partial<Record<keyof RevealOptions, unknown>> | null): RevealOptions {
  const src = input ?? {};
  return {
    level: src.level === 'k2' || src.level === 'g35' ? src.level : DEFAULT_OPTIONS.level,
    charsPerRound: clampInt(
      src.charsPerRound,
      OPTION_LIMITS.charsPerRound.min,
      OPTION_LIMITS.charsPerRound.max,
      DEFAULT_OPTIONS.charsPerRound
    ),
  };
}
