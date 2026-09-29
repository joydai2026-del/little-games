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
  /** Unix seconds. Used to tell whether the CURRENT period has been paid. */
  created?: number | null;
  paid?: boolean | null;
  refunded?: boolean | null;
  amount?: number | null;
  amount_captured?: number | null;
  amount_refunded?: number | null;
}

export interface DisputeLike {
  id: string;
  status: string;
  /** The disputed charge id (informational). */
  charge?: string | null;
  /**
   * The subscription the disputed charge paid for. S2b resolves it from the
   * charge's invoice (`invoice.parent.subscription_details.subscription` on
   * dahlia). A dispute on ANY charge of this subscription counts, not only the
   * latest one. `null` means it could not be resolved: that fails closed.
   */
  subscriptionId: string | null;
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
/** Closed statuses that give access back to the subscription. `prevented` is
 * "prevented from becoming a formal chargeback" (Stripe dispute object, read
 * 2026-09-29), so the charge stands. */
const RESTORING_DISPUTE = new Set(['won', 'warning_closed', 'prevented']);

/** Hard upper bounds, so a typo cannot grant years of access or accept years-old webhooks. */
export const POLICY_LIMITS = {
  ACCESS_END_GRACE_DAYS: 30,
  PAST_DUE_GRACE_DAYS: 30,
  TRIAL_DAYS: 90,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS: 3600,
} as const;

function assertPolicy(policy: AccessPolicy): void {
  for (const k of ['ACCESS_END_GRACE_DAYS', 'PAST_DUE_GRACE_DAYS', 'TRIAL_DAYS'] as const) {
    const v = policy[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > POLICY_LIMITS[k]) {
      throw new AccessInputError(`policy ${k} must be a whole number from 0 to ${POLICY_LIMITS[k]}`);
    }
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
  /**
   * End (Unix seconds) of the last period Stripe was actually PAID for. S2b
   * derives it from the latest paid invoice's line period end. null = unknown.
   */
  lastPaidPeriodEnd: number | null,
): Access {
  assertNow(now);
  assertPolicy(policy);
  if (lastPaidPeriodEnd !== null && (!Number.isFinite(lastPaidPeriodEnd) || lastPaidPeriodEnd > MAX_SECONDS)) {
    throw new AccessInputError('lastPaidPeriodEnd must be Unix seconds or null');
  }
  if (!subscription) return free('no_subscription');

  const opsForSub = refundOps.filter((op) => op.kind === 'refund_full' && op.subscription_id === subscription.id);

  // A dispute counts when its charge paid for THIS subscription (any of its
  // charges, not only the latest), or when that cannot be resolved (fail
  // closed). It is ignored only when it provably belongs to another subscription.
  if (dispute && (dispute.subscriptionId === subscription.id || dispute.subscriptionId === null)) {
    const unresolved = dispute.subscriptionId === null;
    if (dispute.status === 'lost') return free(unresolved ? 'dispute_unresolved' : 'dispute_lost');
    if (OPEN_DISPUTE.has(dispute.status)) {
      if (policy.DISPUTE_ACTION === 'pause') return free(unresolved ? 'dispute_unresolved' : 'dispute_open');
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
      const start = periodStart(subscription);
      // DECISION (coordinator, fix round 2): nobody keeps access for time that
      // was not paid for. Stripe keeps advancing the period while collection is
      // paused (renewal invoices are voided, status stays active), so with
      // `pause_collection` access ends at the last PAID period end, no grace. A
      // goodwill pause is JJ's manual grant in the hub, not a Stripe pause.
      if (subscription.pause_collection) return paidUntil(lastPaidPeriodEnd, now, 'collection_paused');
      const chargeBeforePeriod =
        typeof latestCharge?.created === 'number' && start !== null && latestCharge.created < start;
      const paidThroughCurrent = lastPaidPeriodEnd !== null && end !== null && lastPaidPeriodEnd >= end;
      if (!paidThroughCurrent || chargeBeforePeriod) {
        // The current period's payment is unproven. This is also the normal
        // state for the hour or so between a renewal and its charge, so the
        // teacher gets PAST_DUE_GRACE_DAYS from the last paid period end (the
        // same grace a failed renewal gets once Stripe marks it past_due),
        // never the current period. With no paid period known at all: free.
        if (lastPaidPeriodEnd === null) return free('no_paid_period');
        return paidUntil(lastPaidPeriodEnd + policy.PAST_DUE_GRACE_DAYS * DAY, now, 'renewal_payment_pending');
      }
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
      const periodEndAt = periodEnd(subscription);
      // Never past the last paid period, even inside the grace.
      const end = periodEndAt === null || lastPaidPeriodEnd === null ? null : Math.min(periodEndAt, lastPaidPeriodEnd);
      const ranToEnd =
        subscription.cancellation_details?.reason === 'cancellation_requested' &&
        end !== null &&
        typeof subscription.ended_at === 'number' &&
        periodEndAt !== null &&
        subscription.ended_at >= periodEndAt;
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

function numVar(env: Record<string, unknown>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new AccessInputError(`config ${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export function policyFromEnv(env: Record<string, unknown>): StripePolicyConfig {
  const disputeRaw = env.DISPUTE_ACTION;
  const dispute = disputeRaw === undefined || disputeRaw === '' ? POLICY_DEFAULTS.DISPUTE_ACTION : disputeRaw;
  if (dispute !== 'pause' && dispute !== 'ignore') throw new AccessInputError('config DISPUTE_ACTION must be pause or ignore');
  const policy: AccessPolicy = {
    ACCESS_END_GRACE_DAYS: numVar(env, 'ACCESS_END_GRACE_DAYS', POLICY_DEFAULTS.ACCESS_END_GRACE_DAYS, 0, POLICY_LIMITS.ACCESS_END_GRACE_DAYS),
    PAST_DUE_GRACE_DAYS: numVar(env, 'PAST_DUE_GRACE_DAYS', POLICY_DEFAULTS.PAST_DUE_GRACE_DAYS, 0, POLICY_LIMITS.PAST_DUE_GRACE_DAYS),
    TRIAL_DAYS: numVar(env, 'TRIAL_DAYS', POLICY_DEFAULTS.TRIAL_DAYS, 0, POLICY_LIMITS.TRIAL_DAYS),
    DISPUTE_ACTION: dispute,
  };
  assertPolicy(policy);
  const toleranceSeconds = numVar(
    env,
    'STRIPE_SIGNATURE_TOLERANCE_SECONDS',
    POLICY_DEFAULTS.STRIPE_SIGNATURE_TOLERANCE_SECONDS,
    1,
    POLICY_LIMITS.STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  );
  return { policy, toleranceSeconds };
}
