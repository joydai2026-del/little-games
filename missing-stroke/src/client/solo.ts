// Solo mode: one kid, one phone, no room code. The same pure reducer the
// Worker runs (src/shared/race.ts) runs here on the phone, behind the same
// Backend shape, so solo and class play can never drift apart. Nothing is
// stored: a reload goes back home.
import { ApiError, type Backend, type Envelope } from './api';
import { GAME, normalizeOptions } from '../shared/config';
import { parseCharList } from '../shared/parse';
import { advanceIfDue, createRoom, join, publicView, setOptions, startRace, submitStroke, touch, type Result } from '../shared/race';
import type { CharList, RoomState } from '../shared/types';
import { charData } from './tracer';

const HOST = 'solo-host';
const KID = 'solo-kid';
export const SOLO_CODE = 'SOLO';

let room: RoomState | null = null;

function seed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Looks up stroke data for each pasted character (through the same proxy), keeping the ones we can play. */
export async function soloList(text: string): Promise<CharList> {
  // Same order as the class room (src/worker/strokes.ts resolveList): drop characters with no
  // stroke data FIRST, then keep the first GAME.maxListChars playable ones. Lookups are bounded.
  const parsed = parseCharList(text, Number.MAX_SAFE_INTEGER);
  const wanted = parsed.chars.slice(0, GAME.maxListChars * GAME.soloLookupFactor);
  const found = await Promise.all(wanted.map((c) => charData(c).then((d) => d.strokes.length, () => 0)));
  const playable: string[] = [];
  const missing: string[] = [];
  const counts: Record<string, number> = {};
  wanted.forEach((c, i) => {
    if (found[i] > 0) {
      playable.push(c);
      counts[c] = found[i];
    } else missing.push(c);
  });
  const chars = playable.slice(0, GAME.maxListChars);
  const strokeCounts: Record<string, number> = {};
  for (const c of chars) strokeCounts[c] = counts[c];
  const overflow = [...playable.slice(GAME.maxListChars), ...parsed.chars.slice(wanted.length)];
  return { chars, missing, strokeCounts, repeats: parsed.repeats, overflow };
}

/** Makes the solo game and starts it right away (3, 2, 1...). */
export function startSolo(list: CharList, options: Record<string, unknown>): void {
  const now = Date.now();
  let s = createRoom(SOLO_CODE, { id: HOST, name: 'Momo' }, normalizeOptions(options), list, now);
  s = join(s, { id: KID, name: GAME.soloName }, now).state;
  room = startRace(s, HOST, now, seed()).state;
}

export function hasSolo(): boolean {
  return room !== null;
}

function view(): Envelope {
  const now = Date.now();
  return { state: publicView(room!, KID, now), serverTime: now };
}

function settle(): void {
  const now = Date.now();
  room = advanceIfDue(touch(room!, KID, now), now);
}

function apply(result: Result): Envelope {
  if (result.error) throw new ApiError(result.error, result.status ?? 409);
  room = result.state;
  return view();
}

export function soloBackend(): Backend {
  if (!room) throw new Error('no solo game');
  return {
    code: SOLO_CODE,
    solo: true,
    poll: async () => {
      settle();
      return { ...view(), nextPollMs: GAME.pollMs[room!.phase] };
    },
    send: async (msg) => {
      settle();
      return apply(submitStroke(room!, KID, msg, Date.now()));
    },
    // In solo the kid is also the host: "Play again" starts the next characters.
    act: async () => {
      settle();
      return apply(startRace(touch(room!, KID, Date.now()), HOST, Date.now(), seed()));
    },
    setList: async () => view(),
    setOptions: async (options) => apply(setOptions(room!, HOST, options)),
  };
}
