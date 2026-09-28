// The one-line help under the kid's pad. Pure, so it is unit-tested.
export const HICCUP_TEXT = 'Oops, the internet hiccuped. Keep going from here!';

export type KidStage = 'countdown' | 'drawing' | 'right' | 'reveal' | 'finished';

/**
 * What the pad says. The page calls this on EVERY tick, whatever the stage,
 * so the hiccup notice always clears on time.
 */
export function kidStatusText(o: {
  stage: KidStage;
  hiccupUntil: number;
  now: number;
  error: string | null;
  missesLeftForHint: number;
  hintShowing: boolean;
  /** The room did not grade the last stroke (another tab used its number): draw it again. */
  again?: boolean;
  /** The last drag went far outside the pad. */
  outside?: boolean;
  rightMs?: number | null;
}): string {
  if (o.error && o.stage === 'drawing') return o.error;
  if (o.now < o.hiccupUntil) return HICCUP_TEXT;
  switch (o.stage) {
    case 'drawing':
      if (o.outside) return 'Draw inside the box!';
      if (o.again) return 'Draw it one more time!';
      if (o.hintShowing) return 'Look! Momo showed you where it goes. Draw it!';
      return o.missesLeftForHint <= 1
        ? 'Draw the one missing stroke. Stuck? Try once, Momo will show you.'
        : 'Draw the one missing stroke.';
    case 'right':
      return o.rightMs != null ? `You got it in ${seconds(o.rightMs)}! Wait for the others.` : 'You got it! Wait for the others.';
    default:
      return '';
  }
}

/** 1834 ms -> "1.8 s". */
export function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** Who was fastest, in words, for the reveal. */
export function winnerLine(winnerNames: string[], youWon: boolean): string {
  if (winnerNames.length === 0) return "Time's up! Here is the missing stroke.";
  if (youWon && winnerNames.length === 1) return 'You were the fastest!';
  if (winnerNames.length === 1) return `${winnerNames[0]} was the fastest!`;
  return `${winnerNames.slice(0, -1).join(', ')} and ${winnerNames.at(-1)} tied for fastest!`;
}

/**
 * What the pad does after the room answered one stroke, read from the ROOM's
 * word only: its verdict, or (for a repeated or colliding send) its state.
 *   right: the room has this player right on this character
 *   wrong: the room graded this stroke as a miss
 *   again: the room did not grade it (its number was already used, e.g. by
 *          another tab, or a retry of a miss): the kid simply draws again
 */
export function strokeOutcome(
  env: { verdict?: 'correct' | 'mistake'; duplicate?: boolean; state: { progress: Record<string, { turn: number; rightAt: number | null } | undefined> } },
  you: string,
  turn: number
): 'right' | 'wrong' | 'again' {
  const mine = env.state.progress[you];
  if (mine && mine.turn === turn && mine.rightAt != null) return 'right';
  if (!env.duplicate && env.verdict === 'mistake') return 'wrong';
  return 'again';
}
