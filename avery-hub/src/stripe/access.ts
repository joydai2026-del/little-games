// accessFor: the one place that turns Stripe state into free or paid.
// It follows the plan's state table (docs/plans/2026-09-28-avery-accounts-and-
// pay-plan.md, "State model: accessFor") row by row, and it never reads access
// from the subscription alone: a full refund, an open or lost dispute on this
// subscription's charge, or a completed refund-then-cancel op all force free
// even while Stripe still says `active`.
//
// Units: every time here is Unix SECONDS, like Stripe. `until` is Unix seconds.
// (The webhook verifier is the exception: it takes `nowMs`.) A `now` that looks
// like milliseconds throws instead of silently making every teacher free.
// Policy numbers arrive in `policy`; there are no literals for them here.
//
// API version 2026-08-26.dahlia (see client.ts): `current_period_start` and
// `current_period_end` live on subscription items, so the period is read from
// the items (latest end), with the old top-level fields as a fallback.

export type Plan = 'free' | 'paid';

export interface Access {
  plan: Plan;
  /** Unix seconds when paid access ends; null for free. */
  until: number | null;
  /** Machine-readable cause. `unknown_dispute_status:<s>` means: alert. */
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

/** Thrown for inputs that would otherwise flip access silently (wrong units, bad policy). */
export class AccessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessInputError';
  }
}

/** The fields accessFor reads. Stripe objects carry many more. */
export interface SubscriptionLike {
  id: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  /** Read by nothing here on purpose: a scheduled cancel becomes `canceled` later. */
  cancel_at?: number | null;
  /** For a cancel at period end this is the REQUEST time, not the end (Stripe docs). */
  canceled_at?: number | null;
  ended_at?: number | null;
  cancellation_details?: { reason?: string | null } | null;
  pause_collection?: { behavior?: string | null; resumes_at?: number | null } | null;
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
  /** The disputed charge id. A dispute counts only if this is the subscription's charge. */
  charge: string;
}

/** Rows from billing_ops (S2b). Only full-refund ops matter here. */
export interface RefundOpLike {
  kind: 'refund_full';
  subscription_id: string;
  charge_id?: string | null;
  done: boolean;
}

const DAY = 86_400;
/** Anything above this is milliseconds (1e11 seconds is the year 5138). */
const MAX_SECONDS = 1e11;

/** Stripe dispute statuses that mean "still open". `warning_*` are inquiries. */
const OPEN_DISPUTE = new Set(['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review']);
/** Closed statuses that give access back to the subscription. */
const RESTORING_DISPUTE = new Set(['won', 'warning_closed']);

function assertPolicy(policy: AccessPolicy): void {
  for (const k of ['ACCESS_END_GRACE_DAYS', 'PAST_DUE_GRACE_DAYS', 'TRIAL_DAYS'] as const) {
    const v = policy[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new AccessInputError(`policy ${k} must be a finite number >= 0`);
  }
  if (policy.DISPUTE_ACTION !== 'pause' && policy.DISPUTE_ACTION !== 'ignore') {
    throw new AccessInputError('policy DISPUTE_ACTION must be pause or ignore');
  }
}

function assertNow(now: number): void {
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) throw new AccessInputError('now must be Unix seconds');
  if (now > MAX_SECONDS) throw new AccessInputError('now looks like milliseconds; accessFor takes Unix seconds');
}

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
  assertNow(now);
  assertPolicy(policy);
  if (!subscription) return free('no_subscription');

  const opsForSub = refundOps.filter((op) => op.kind === 'refund_full' && op.subscription_id === subscription.id);

  // A dispute counts only when it is on this subscription's charge: the latest
  // paid charge, or a charge a refund op recorded for this subscription. A lost
  // dispute on last year's charge does not touch a new subscription.
  const ownCharges = new Set<string>([
    ...(latestCharge ? [latestCharge.id] : []),
    ...opsForSub.map((op) => op.charge_id).filter((c): c is string => typeof c === 'string'),
  ]);
  if (dispute && ownCharges.has(dispute.charge)) {
    if (dispute.status === 'lost') return free('dispute_lost');
    if (OPEN_DISPUTE.has(dispute.status)) {
      if (policy.DISPUTE_ACTION === 'pause') return free('dispute_open');
    } else if (!RESTORING_DISPUTE.has(dispute.status)) {
      // Fail closed on a status this code does not know; the caller alerts.
      return free(`unknown_dispute_status:${dispute.status}`);
    }
  }
  if (isFullyRefunded(latestCharge)) return free('refunded_full');
  if (opsForSub.some((op) => op.done)) return free('refunded_full');
  // A partial refund changes nothing, so it falls through.

  const grace = policy.ACCESS_END_GRACE_DAYS * DAY;

  switch (subscription.status) {
    case 'trialing':
      return paidUntil(typeof subscription.trial_end === 'number' ? subscription.trial_end : null, now, 'trialing');
    case 'active': {
      const end = periodEnd(subscription);
      // Dashboard "pause payment collection": status stays active, but no money
      // comes in. Paid to the end of the period already paid for, no grace.
      if (subscription.pause_collection) return paidUntil(end, now, 'collection_paused');
      return paidUntil(end === null ? null : end + grace, now, subscription.cancel_at_period_end ? 'active_canceling' : 'active');
    }
    case 'past_due': {
      // Payment became due at the start of the current period (the renewal).
      const start = periodStart(subscription);
      return paidUntil(start === null ? null : start + policy.PAST_DUE_GRACE_DAYS * DAY, now, 'past_due_grace');
    }
    case 'canceled': {
      // A cancel that ran to the period end (portal "cancel at period end") gets
      // the same grace as an active teacher. Stripe sets `canceled_at` to the
      // REQUEST time in that case, so the end is judged by `ended_at`. A
      // cancel-now (refund, lost dispute, account deletion) ends before the
      // period end and gets no grace.
      const end = periodEnd(subscription);
      const ranToEnd =
        subscription.cancellation_details?.reason === 'cancellation_requested' &&
        end !== null &&
        typeof subscription.ended_at === 'number' &&
        subscription.ended_at >= end;
      return ranToEnd ? paidUntil(end + grace, now, 'canceled_grace') : free('canceled');
    }
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
    case 'paused':
      return free(subscription.status);
    default:
      return free('unknown_status');
  }
}

/** Config strings (wrangler vars) to validated numbers. Missing means the default. */
export const POLICY_DEFAULTS = {
  ACCESS_END_GRACE_DAYS: 7,
  PAST_DUE_GRACE_DAYS: 7,
  TRIAL_DAYS: 0,
  DISPUTE_ACTION: 'pause',
  STRIPE_SIGNATURE_TOLERANCE_SECONDS: 300,
} as const;

export interface StripePolicyConfig {
  policy: AccessPolicy;
  /** Webhook signature window, seconds. */
  toleranceSeconds: number;
}

function numVar(env: Record<string, unknown>, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n < min) throw new AccessInputError(`config ${name} must be a number >= ${min}`);
  return n;
}

export function policyFromEnv(env: Record<string, unknown>): StripePolicyConfig {
  const disputeRaw = env.DISPUTE_ACTION;
  const dispute = disputeRaw === undefined || disputeRaw === '' ? POLICY_DEFAULTS.DISPUTE_ACTION : disputeRaw;
  if (dispute !== 'pause' && dispute !== 'ignore') throw new AccessInputError('config DISPUTE_ACTION must be pause or ignore');
  const policy: AccessPolicy = {
    ACCESS_END_GRACE_DAYS: numVar(env, 'ACCESS_END_GRACE_DAYS', POLICY_DEFAULTS.ACCESS_END_GRACE_DAYS, 0),
    PAST_DUE_GRACE_DAYS: numVar(env, 'PAST_DUE_GRACE_DAYS', POLICY_DEFAULTS.PAST_DUE_GRACE_DAYS, 0),
    TRIAL_DAYS: numVar(env, 'TRIAL_DAYS', POLICY_DEFAULTS.TRIAL_DAYS, 0),
    DISPUTE_ACTION: dispute,
  };
  assertPolicy(policy);
  const toleranceSeconds = numVar(env, 'STRIPE_SIGNATURE_TOLERANCE_SECONDS', POLICY_DEFAULTS.STRIPE_SIGNATURE_TOLERANCE_SECONDS, 1);
  return { policy, toleranceSeconds };
}
