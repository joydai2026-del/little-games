// Every game number that may change lives here. Game logic reads these, never
// a literal. Teacher-visible settings are clamped by normalizeOptions so a bad
// value from a phone or an agent can never break a room.

export interface RaceOptions {
  /** Seconds each character gets. The race clock is this times the characters in the race. */
  secondsPerChar: number;
  /** How many characters one race uses, taken in order from the teacher's list. */
  charsPerRound: number;
  /** Stroke hints: the next stroke flashes after a miss (best for K-2). Off = only after several misses. */
  hints: boolean;
}

export const DEFAULT_OPTIONS: RaceOptions = {
  secondsPerChar: 30,
  charsPerRound: 5,
  hints: true,
};

export const OPTION_LIMITS = {
  secondsPerChar: { min: 10, max: 120 },
  charsPerRound: { min: 1, max: 20 },
} as const;

export const GAME = {
  /** Ready, set, go before strokes count. */
  countdownSeconds: 3,
  /** Kids per room. */
  maxKids: 40,
  /** Traceable characters kept from one paste. */
  maxListChars: 60,
  /** Longest pasted text accepted, in characters. */
  maxPasteLength: 4000,
  /** Longest display name. */
  maxNameLength: 16,
  /** A room disappears this long after it was made. */
  roomTtlMinutes: 120,
  /** Misses before the stroke hint shows, with hints on / off. */
  hintAfterMisses: { on: 1, off: 3 },
  /** Misses before a stroke is filled in for the kid, so nobody gets stuck. */
  giveStrokeAfterMisses: 5,
  /** Client polling, in ms. */
  pollMs: { lobby: 1500, racing: 800, done: 2500 },
  /** How long the Momo cheer shows between characters, in ms. */
  cheerMs: 900,
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeOptions(input?: Partial<Record<keyof RaceOptions, unknown>> | null): RaceOptions {
  const src = input ?? {};
  return {
    secondsPerChar: clampInt(
      src.secondsPerChar,
      OPTION_LIMITS.secondsPerChar.min,
      OPTION_LIMITS.secondsPerChar.max,
      DEFAULT_OPTIONS.secondsPerChar
    ),
    charsPerRound: clampInt(
      src.charsPerRound,
      OPTION_LIMITS.charsPerRound.min,
      OPTION_LIMITS.charsPerRound.max,
      DEFAULT_OPTIONS.charsPerRound
    ),
    hints: typeof src.hints === 'boolean' ? src.hints : DEFAULT_OPTIONS.hints,
  };
}
