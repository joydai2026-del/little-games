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
  /** How forgiving stroke matching is (hanzi-writer leniency; 1 = library default, higher = easier for small hands). */
  leniency: 1.3,
  /** Pen width while a kid draws, in grid units of the tracer. */
  drawingWidth: 34,
  /** Waits between the phone's retries of one stroke send (ms). After the last one it resyncs with the room. */
  strokeRetryBackoffMs: [300, 800, 1500],
  /**
   * Pace floor, in ms per correct stroke, checked on the server: the n-th
   * correct stroke of a race may not land before GO + n x this. Far below what
   * a finger needs, it stops a script from finishing instantly while letting a
   * burst through after a slow network (a cumulative floor, not a per-gap one).
   */
  minStrokeMs: 250,
  /** Largest request body the Worker reads, in bytes. */
  maxBodyBytes: 32_768,
  /** Deadline on every request the phone makes (ms). A hung send then fails, and the back-off and resync take over. */
  requestTimeoutMs: 8000,
  /** How long "the internet hiccuped" stays on the kid's screen after a resync (ms). */
  hiccupNoticeMs: 3500,
  /** Largest jump in a racer's stroke sequence number accepted in one stroke. */
  maxSeqJump: 1000,
  /** A kid who has not been seen for this long (ms) is left out of the next race (they rejoin the one after by coming back). */
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
