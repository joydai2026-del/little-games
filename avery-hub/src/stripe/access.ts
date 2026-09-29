// accessFor: the one place that turns Stripe state into free or paid.
// It follows the plan's state table (docs/plans/2026-09-28-avery-accounts-and-
// pay-plan.md, "State model: accessFor") row by row, and it never reads access
// from the subscription alone: a full refund, an open or lost dispute, or a
// completed refund-then-cancel op all force free even while Stripe still says
// `active`.
//
// Units: every time is Unix SECONDS, like Stripe. `until` is Unix seconds.
// Policy numbers arrive in `policy`; there are no literals for them here.
//
// API version 2026-08-26.dahlia (see client.ts): since Basil,
// `current_period_start` / `current_period_end` live on subscription items,
// so the period is read from the items (latest end), with the old top-level
// fields as a fallback for older payloads.

export type Plan = 'free' | 'paid';

export interface Access {
  plan: Plan;
  /** Unix seconds when paid access ends; null for free. */
  until: number | null;
  /** Machine-readable cause, stable enough to test and log. */
  reason: string;
}

export interface AccessPolicy {
  ACCESS_END_GRACE_DAYS: number;
  PAST_DUE_GRACE_DAYS: number;
  /** Used by Checkout (S2b). A `trialing` subscription is honoured to its own
   * `trial_end` whatever this says, because Stripe only reports `trialing`
   * when someone granted a trial on purpose (Dashboard or API). */
  TRIAL_DAYS: number;
  /** `pause`: an open dispute means free until it closes. `ignore`: no effect. */
  DISPUTE_ACTION: 'pause' | 'ignore';
}

/** The fields accessFor reads. Stripe objects carry many more. */
export interface SubscriptionLike {
  id: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  trial_end?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_start?: number | null; current_period_end?: number | null }> } | null;
}

export interface ChargeLike {
  id: string;
  paid?: boolean | null;
  refunded?: boolean | null;
  amount?: number | null;
  amount_captured?: number | null;
  amount_refunded?: number | null;
}

export interface DisputeLike {
  id: string;
  status: string;
}

/** Rows from billing_ops (S2b). Only completed full-refund ops matter here. */
export interface RefundOpLike {
  kind: 'refund_full';
  subscription_id: string;
  done: boolean;
}

const DAY = 86_400;

/** Stripe dispute statuses that mean "still open". `warning_*` are inquiries. */
const OPEN_DISPUTE = new Set(['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review']);

function periodEnd(sub: SubscriptionLike): number | null {
  const fromItems = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n): n is number => typeof n === 'number');
  if (fromItems.length) return Math.max(...fromItems);
  return typeof sub.current_period_end === 'number' ? sub.current_period_end : null;
}

function periodStart(sub: SubscriptionLike): number | null {
  const fromItems = (sub.items?.data ?? []).map((i) => i.current_period_start).filter((n): n is number => typeof n === 'number');
  if (fromItems.length) return Math.max(...fromItems);
  return typeof sub.current_period_start === 'number' ? sub.current_period_start : null;
}

export function isFullyRefunded(charge: ChargeLike | null | undefined): boolean {
  if (!charge) return false;
  if (charge.refunded === true) return true;
  const captured = charge.amount_captured ?? charge.amount ?? 0;
  return captured > 0 && (charge.amount_refunded ?? 0) >= captured;
}

const free = (reason: string): Access => ({ plan: 'free', until: null, reason });

/** Paid until `end`, unless `now` is already past it. */
function paidUntil(end: number | null, now: number, reason: string): Access {
  if (end === null) return free(`${reason}_no_period`);
  return now < end ? { plan: 'paid', until: end, reason } : free(`${reason}_ended`);
}

export function accessFor(
  subscription: SubscriptionLike | null,
  latestCharge: ChargeLike | null,
  dispute: DisputeLike | null,
  refundOps: readonly RefundOpLike[],
  now: number,
  policy: AccessPolicy,
): Access {
  if (!subscription) return free('no_subscription');

  // Money taken back wins over whatever the subscription says.
  if (dispute) {
    if (dispute.status === 'lost') return free('dispute_lost');
    if (OPEN_DISPUTE.has(dispute.status) && policy.DISPUTE_ACTION === 'pause') return free('dispute_open');
    // won, warning_closed (inquiry closed), prevented: back to the subscription.
  }
  if (isFullyRefunded(latestCharge)) return free('refunded_full');
  if (refundOps.some((op) => op.kind === 'refund_full' && op.done && op.subscription_id === subscription.id)) {
    return free('refunded_full');
  }
  // A partial refund changes nothing, so it falls through.

  const graceEnd = (end: number | null) => (end === null ? null : end + policy.ACCESS_END_GRACE_DAYS * DAY);

  switch (subscription.status) {
    case 'trialing':
      return paidUntil(typeof subscription.trial_end === 'number' ? subscription.trial_end : null, now, 'trialing');
    case 'active': {
      let end = periodEnd(subscription);
      if (typeof subscription.cancel_at === 'number' && (end === null || subscription.cancel_at < end)) end = subscription.cancel_at;
      const canceling = subscription.cancel_at_period_end === true || typeof subscription.cancel_at === 'number';
      return paidUntil(graceEnd(end), now, canceling ? 'active_canceling' : 'active');
    }
    case 'past_due': {
      // Payment became due at the start of the current period (the renewal).
      const start = periodStart(subscription);
      return paidUntil(start === null ? null : start + policy.PAST_DUE_GRACE_DAYS * DAY, now, 'past_due_grace');
    }
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
    case 'paused':
    case 'canceled':
      return free(subscription.status);
    default:
      return free('unknown_status');
  }
}
