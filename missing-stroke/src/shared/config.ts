// Every game number that may change lives here. Game logic reads these, never
// a literal. Teacher-visible settings are clamped by normalizeOptions so a bad
// value from a phone or an agent can never break a room.

/** The teacher picks a level; the level sets the time per character and when the hint shows. */
export type Level = 'little' | 'middle' | 'big';

export interface LevelRule {
  /** What the teacher sees on the button. */
  label: string;
  /** Seconds each character stays open. */
  secondsPerChar: number;
  /** Wrong tries before the missing stroke flashes as a hint. */
  hintAfterMisses: number;
}

export const LEVELS: Record<Level, LevelRule> = {
  little: { label: 'K-1', secondsPerChar: 30, hintAfterMisses: 1 },
  middle: { label: 'Grades 2-3', secondsPerChar: 20, hintAfterMisses: 2 },
  big: { label: 'Grades 4-5', secondsPerChar: 12, hintAfterMisses: 3 },
};
export const LEVEL_ORDER: Level[] = ['little', 'middle', 'big'];

export interface RaceOptions {
  level: Level;
  /** How many characters one race uses, taken in order from the teacher's list. */
  charsPerRound: number;
}

export const DEFAULT_OPTIONS: RaceOptions = {
  level: 'middle',
  charsPerRound: 5,
};

export const OPTION_LIMITS = {
  charsPerRound: { min: 1, max: 20 },
} as const;

export const GAME = {
  /** Ready, set, go before the first character opens. */
  countdownSeconds: 3,
  /** How long everyone sees the answer and the winner between characters (ms). */
  revealMs: 3500,
  /**
   * After the first right stroke, the others get at most this long to finish
   * the character (ms), so a fast room keeps moving. 0 = wait for the clock.
   */
  graceAfterFirstRightMs: 6000,
  /**
   * Pace floor, checked on the server: a right stroke may not land sooner than
   * this after the character opens (ms). Far below what a finger needs, it
   * stops a script from winning every character instantly.
   */
  minAnswerMs: 700,
  /** Kids per room. */
  maxKids: 40,
  /** Characters kept from one paste. */
  maxListChars: 60,
  /** Longest pasted text accepted, in characters. */
  maxPasteLength: 4000,
  /** Longest display name. */
  maxNameLength: 16,
  /** A room disappears this long after it was made. */
  roomTtlMinutes: 120,
  /** Client polling, in ms. */
  pollMs: { lobby: 1500, racing: 700, done: 2500 },
  /** How long the small "Got it!" cheer shows on the kid's pad (ms). */
  cheerMs: 1200,
  /** How forgiving stroke matching is (hanzi-writer leniency; 1 = library default, higher = easier for small hands). */
  leniency: 1.3,
  /** Pen width while a kid draws, in grid units of the tracer. */
  drawingWidth: 34,
  /** Waits between the phone's retries of one answer send (ms). After the last one it resyncs with the room. */
  strokeRetryBackoffMs: [300, 800, 1500],
  /** Largest request body the Worker reads, in bytes. */
  maxBodyBytes: 32_768,
  /** Deadline on every request the phone makes (ms). */
  requestTimeoutMs: 8000,
  /** How long "the internet hiccuped" stays on the kid's screen after a resync (ms). */
  hiccupNoticeMs: 3500,
  /** Largest jump in a racer's sequence number accepted in one send. */
  maxSeqJump: 1000,
  /** A kid who has not been seen for this long (ms) is left out of the next race. */
  rosterActiveMs: 45_000,
  /** Room codes tried before giving up on a create. */
  roomCodeAttempts: 5,
  /** How stale a player's lastSeenAt may get on disk before a plain poll writes it. */
  lastSeenWriteMs: 15_000,
  /** Solo mode: the player's name on this phone. */
  soloName: 'You',
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, v);
}

export function normalizeOptions(input?: Partial<Record<keyof RaceOptions, unknown>> | null): RaceOptions {
  const src = input ?? {};
  return {
    level: isLevel(src.level) ? src.level : DEFAULT_OPTIONS.level,
    charsPerRound: clampInt(
      src.charsPerRound,
      OPTION_LIMITS.charsPerRound.min,
      OPTION_LIMITS.charsPerRound.max,
      DEFAULT_OPTIONS.charsPerRound
    ),
  };
}
