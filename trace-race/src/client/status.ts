// The one-line help under the kid's tracing pad. Pure, so it is unit-tested.
export const HICCUP_TEXT = 'Oops, the internet hiccuped. Keep going from here!';

/**
 * `stage`: 'countdown' before GO, 'tracing' while a character is on the pad,
 * 'finished' after the last one. The page calls this on EVERY tick, whatever
 * the stage, so the hiccup notice always clears on time (even when a kid
 * resyncs on the last character and finishes inside the notice window).
 */
export function kidStatusText(o: {
  hints: boolean;
  hiccupUntil: number;
  now: number;
  error: string | null;
  stage?: 'countdown' | 'tracing' | 'finished';
}): string {
  const stage = o.stage ?? 'tracing';
  if (o.error && stage === 'tracing') return o.error;
  if (o.now < o.hiccupUntil) return HICCUP_TEXT;
  if (stage !== 'tracing') return '';
  return o.hints ? 'Trace the strokes in order. Stuck? Try once, the hint will show you.' : 'Trace the strokes in order.';
}
