// What each word card on a kid's phone looks like right now, and the one-line
// message under them. Pure, so it is unit-tested.
import type { Attempt, PublicQuestion } from '../shared/types';

export type CardLook = 'open' | 'tried' | 'right' | 'off';

export interface CardsView {
  looks: CardLook[];
  /** Plain-English line under the cards. */
  message: string;
  /** True when any card can be tapped now. */
  canTap: boolean;
}

export function cardsView(q: PublicQuestion, mine: Attempt | null, now: number, sending: boolean): CardsView {
  const tried = new Set(mine?.tried ?? []);
  const closed = q.closedAt != null;
  const cooling = mine?.coolUntil != null && now < mine.coolUntil;
  const got = mine?.correctAt != null;
  const out = Boolean(mine?.locked);
  const looks = q.cards.map((_, i): CardLook => {
    if ((closed && q.answer === i) || (got && mine!.rightCard === i)) return 'right';
    if (tried.has(i)) return 'tried';
    if (closed || got || out || cooling || sending || now < q.startAt) return 'off';
    return 'open';
  });
  let message = 'Look at the big screen! Which word is Momo drawing?';
  if (now < q.startAt && !closed) message = 'Get ready, Momo is picking up the brush...';
  else if (closed && q.answer != null) message = got ? `You got it! +${mine!.points}` : `It was ${q.cards[q.answer]}. Next time!`;
  else if (got) message = `好棒! +${mine!.points}. Wait for the others.`;
  else if (out) message = 'Oops, not that one. Wait for the next word.';
  else if (cooling) message = 'Not that one. Try again in a moment!';
  else if (sending) message = 'Sending...';
  return { looks, message, canTap: looks.includes('open') };
}
