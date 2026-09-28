// The one-line help under the kid's tracing pad. Pure, so it is unit-tested.
export const HICCUP_TEXT = 'Oops, the internet hiccuped. Keep going from here!';

export function kidStatusText(o: { hints: boolean; hiccupUntil: number; now: number; error: string | null }): string {
  if (o.error) return o.error;
  if (o.now < o.hiccupUntil) return HICCUP_TEXT;
  return o.hints ? 'Trace the strokes in order. Stuck? Try once, the hint will show you.' : 'Trace the strokes in order.';
}
