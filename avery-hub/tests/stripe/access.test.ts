// One test per row of the plan's accessFor table, then the extra cases the S2a
// brief asks for. Times are Unix seconds. Payloads use the 2026-08-26.dahlia
// shape (period on subscription items).
import { describe, expect, it } from 'vitest';
import { AccessInputError, accessFor, policyFromEnv, type AccessPolicy, type SubscriptionLike } from '../../src/stripe/access';

const DAY = 86_400;
const NOW = 1_790_000_000;
const POLICY: AccessPolicy = { ACCESS_END_GRACE_DAYS: 7, PAST_DUE_GRACE_DAYS: 7, TRIAL_DAYS: 0, DISPUTE_ACTION: 'pause' };

const START = NOW - 30 * DAY;
const END = NOW + 335 * DAY;

function sub(status: string, extra: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    id: 'sub_1',
    status,
    cancel_at_period_end: false,
    items: { data: [{ current_period_start: START, current_period_end: END }] },
    ...extra,
  };
}
/** The state Stripe emits when a cancel at period end runs out. */
const CANCELED_AT_END: Partial<SubscriptionLike> = {
  cancel_at_period_end: true,
  canceled_at: NOW - 20 * DAY,
  ended_at: END,
  cancellation_details: { reason: 'cancellation_requested' },
};
/** The charge that paid the CURRENT period (created just after the period start). */
const paidCharge = { id: 'ch_1', created: START + 3600, paid: true, refunded: false, amount: 3900, amount_captured: 3900, amount_refunded: 0 };
type DisputeOpt = { id: string; status: string; charge?: string; subscriptionId?: string | null };
interface RunOpts {
  charge?: typeof paidCharge | null;
  /** Defaults to a dispute on this subscription (`subscriptionId: 'sub_1'`). */
  dispute?: DisputeOpt | null;
  now?: number;
  policy?: AccessPolicy;
  ops?: Parameters<typeof accessFor>[3];
  /** Defaults to END: the current period is paid. */
  lastPaid?: number | null;
}
const run = (s: SubscriptionLike | null, opts: RunOpts = {}) =>
  accessFor(
    s,
    opts.charge === undefined ? paidCharge : opts.charge,
    opts.dispute ? { subscriptionId: 'sub_1', ...opts.dispute } : null,
    opts.ops ?? [],
    opts.now ?? NOW,
    opts.policy ?? POLICY,
    opts.lastPaid === undefined ? END : opts.lastPaid,
  );

describe('accessFor: one test per plan table row', () => {
  it('incomplete: free', () => {
    expect(run(sub('incomplete'), { charge: null })).toEqual({ plan: 'free', until: null, reason: 'incomplete' });
  });

  it('incomplete_expired: free', () => {
    expect(run(sub('incomplete_expired'), { charge: null })).toEqual({ plan: 'free', until: null, reason: 'incomplete_expired' });
  });

  it('trialing: paid until trial end, then free', () => {
    const s = sub('trialing', { trial_end: NOW + 5 * DAY });
    expect(run(s, { charge: null })).toEqual({ plan: 'paid', until: NOW + 5 * DAY, reason: 'trialing' });
    expect(run(s, { charge: null, now: NOW + 6 * DAY }).plan).toBe('free');
  });

  it('active: paid until current_period_end + ACCESS_END_GRACE_DAYS', () => {
    expect(run(sub('active'))).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active' });
  });

  it('past_due: paid during PAST_DUE_GRACE_DAYS from the last paid period end, then free', () => {
    // The renewal 2 days ago failed; the last paid period ended then.
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW - 2 * DAY, current_period_end: NOW + 363 * DAY }] } });
    const lastPaid = NOW - 2 * DAY;
    expect(run(s, { lastPaid })).toEqual({ plan: 'paid', until: NOW + 5 * DAY, reason: 'past_due_grace' });
    expect(run(s, { lastPaid, now: NOW + 6 * DAY })).toEqual({ plan: 'free', until: null, reason: 'past_due_grace_ended' });
  });

  it('unpaid: free', () => {
    expect(run(sub('unpaid')).plan).toBe('free');
  });

  it('paused: free', () => {
    expect(run(sub('paused'))).toEqual({ plan: 'free', until: null, reason: 'paused' });
  });

  it('active with cancel_at_period_end: paid until period end + grace, then free', () => {
    // Before the end Stripe reports active + cancel_at_period_end.
    const s = sub('active', { cancel_at_period_end: true, canceled_at: NOW - DAY });
    expect(run(s)).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active_canceling' });
    // At the end Stripe flips it to canceled; canceled_at stays the REQUEST time.
    const ended = sub('canceled', { ...CANCELED_AT_END });
    expect(run(ended, { now: END + DAY })).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'canceled_grace' });
    expect(run(ended, { now: END + 7 * DAY }).plan).toBe('free');
  });

  it('canceled: free', () => {
    expect(run(sub('canceled'))).toEqual({ plan: 'free', until: null, reason: 'canceled' });
  });

  it('latest paid charge fully refunded: free, even while the subscription says active', () => {
    const refunded = { ...paidCharge, refunded: true, amount_refunded: 3900 };
    expect(run(sub('active'), { charge: refunded })).toEqual({ plan: 'free', until: null, reason: 'refunded_full' });
  });

  it('partial refund: no change', () => {
    const partial = { ...paidCharge, amount_refunded: 1000 };
    expect(run(sub('active'), { charge: partial })).toEqual(run(sub('active')));
  });

  it('dispute open: free while open (DISPUTE_ACTION pause)', () => {
    for (const status of ['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review']) {
      expect(run(sub('active'), { dispute: { id: 'dp_1', status, charge: 'ch_1' } })).toEqual({ plan: 'free', until: null, reason: 'dispute_open' });
    }
  });

  it('dispute won: back to what the subscription says', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'won', charge: 'ch_1' } })).toEqual(run(sub('active')));
    expect(run(sub('canceled'), { dispute: { id: 'dp_1', status: 'won', charge: 'ch_1' } }).plan).toBe('free');
  });

  it('dispute lost: free', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'lost', charge: 'ch_1' } })).toEqual({ plan: 'free', until: null, reason: 'dispute_lost' });
  });
});

describe('accessFor: extra cases from the S2a brief', () => {
  it('fully refunded charge with an active subscription gives free (refunded flag missing, amounts equal)', () => {
    const refunded = { id: 'ch_1', paid: true, amount: 3900, amount_captured: 3900, amount_refunded: 3900 };
    expect(run(sub('active'), { charge: refunded as typeof paidCharge }).reason).toBe('refunded_full');
  });

  it('completed refund-then-cancel op keeps free even if a later fetch shows active and an unrefunded charge', () => {
    const ops = [{ kind: 'refund_full' as const, subscription_id: 'sub_1', done: true }];
    expect(run(sub('active'), { ops }).reason).toBe('refunded_full');
  });

  it('a refund op for a DIFFERENT subscription does not affect a new purchase', () => {
    const ops = [{ kind: 'refund_full' as const, subscription_id: 'sub_old', done: true }];
    expect(run(sub('active'), { ops }).plan).toBe('paid');
  });

  it('an unfinished refund op does not yet force free', () => {
    const ops = [{ kind: 'refund_full' as const, subscription_id: 'sub_1', done: false }];
    expect(run(sub('active'), { ops }).plan).toBe('paid');
  });

  it('open dispute gives free; the same subscription returns to paid after the dispute is won', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'needs_response', charge: 'ch_1' } }).plan).toBe('free');
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'won', charge: 'ch_1' } })).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active' });
  });

  it('DISPUTE_ACTION ignore leaves an open dispute without effect', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'needs_response', charge: 'ch_1' }, policy: { ...POLICY, DISPUTE_ACTION: 'ignore' } }).plan).toBe('paid');
  });

  it('cancel at period end (as Stripe emits it: canceled, ended_at = period end) keeps paid to end plus grace, exactly', () => {
    const s = sub('canceled', { ...CANCELED_AT_END });
    expect(run(s, { now: END + 7 * DAY - 1 }).plan).toBe('paid');
    expect(run(s, { now: END + 7 * DAY }).plan).toBe('free');
  });

  it('cancel-now gets no grace: ended before the period end, or another reason', () => {
    const now = NOW + DAY;
    // Refund path or admin cancel: reason cancellation_requested but ended mid-period.
    expect(run(sub('canceled', { ended_at: NOW, canceled_at: NOW, cancellation_details: { reason: 'cancellation_requested' } }), { now }))
      .toEqual({ plan: 'free', until: null, reason: 'canceled' });
    // Lost dispute cancel.
    expect(run(sub('canceled', { ...CANCELED_AT_END, cancellation_details: { reason: 'payment_disputed' } }), { now: END + DAY }).reason).toBe('canceled');
    // Payment failures exhausted.
    expect(run(sub('canceled', { ...CANCELED_AT_END, cancellation_details: { reason: 'payment_failed' } }), { now: END + DAY }).reason).toBe('canceled');
    // No ended_at at all.
    expect(run(sub('canceled', { cancellation_details: { reason: 'cancellation_requested' } }), { now }).reason).toBe('canceled');
  });

  it('a refund forces free even on a canceled-at-period-end subscription inside its grace', () => {
    const refunded = { ...paidCharge, refunded: true, amount_refunded: 3900 };
    expect(run(sub('canceled', { ...CANCELED_AT_END }), { now: END + DAY, charge: refunded }).reason).toBe('refunded_full');
  });

  it('cancel_at in the future on an active subscription does not shorten access', () => {
    const s = sub('active', { cancel_at: NOW + 10 * DAY });
    expect(run(s)).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active' });
  });

  it('grace comes from the policy object, not a literal', () => {
    expect(run(sub('active'), { policy: { ...POLICY, ACCESS_END_GRACE_DAYS: 0 } }).until).toBe(END);
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW - 2 * DAY, current_period_end: END }] } });
    expect(run(s, { lastPaid: NOW - 2 * DAY, policy: { ...POLICY, PAST_DUE_GRACE_DAYS: 1 } }).plan).toBe('free');
  });

  it('active but the period long over (stale data): free', () => {
    expect(run(sub('active'), { now: END + 30 * DAY }).plan).toBe('free');
  });

  it('pre-Basil payload with top-level current_period_end still works', () => {
    const s: SubscriptionLike = { id: 'sub_1', status: 'active', current_period_end: END };
    expect(run(s).until).toBe(END + 7 * DAY);
  });

  it('trialing with TRIAL_DAYS 0 still honours a trial Stripe reports; no trial_end means free', () => {
    expect(run(sub('trialing', { trial_end: NOW + DAY }), { charge: null }).plan).toBe('paid');
    expect(run(sub('trialing'), { charge: null }).plan).toBe('free');
  });

  it('no subscription or an unknown status: free', () => {
    expect(run(null).reason).toBe('no_subscription');
    expect(run(sub('something_new')).reason).toBe('unknown_status');
  });
});

describe('accessFor: dispute scoping and unknown statuses', () => {
  const MONTHLY: Partial<SubscriptionLike> = { id: 'sub_m', items: { data: [{ current_period_start: NOW - 5 * DAY, current_period_end: NOW + 25 * DAY }] } };
  const month3 = { ...paidCharge, id: 'ch_month3', created: NOW - 5 * DAY + 3600 };

  it('a dispute on an OLDER monthly charge of the same subscription counts (open and lost)', () => {
    const s = sub('active', MONTHLY);
    const base = { charge: month3, lastPaid: NOW + 25 * DAY };
    expect(run(s, { ...base, dispute: { id: 'dp_m1', status: 'needs_response', charge: 'ch_month1', subscriptionId: 'sub_m' } }).reason).toBe('dispute_open');
    expect(run(s, { ...base, dispute: { id: 'dp_m1', status: 'lost', charge: 'ch_month1', subscriptionId: 'sub_m' } }).reason).toBe('dispute_lost');
  });

  it('a dispute that cannot be tied to a subscription fails closed', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_x', status: 'needs_response', subscriptionId: null } })).toEqual({ plan: 'free', until: null, reason: 'dispute_unresolved' });
    expect(run(sub('active'), { dispute: { id: 'dp_x', status: 'lost', subscriptionId: null } }).reason).toBe('dispute_unresolved');
    expect(run(sub('active'), { dispute: { id: 'dp_x', status: 'won', subscriptionId: null } }).plan).toBe('paid');
  });

  it("a dispute on ANOTHER subscription's charge is ignored (a lost dispute last year does not lock a new subscription)", () => {
    expect(run(sub('active'), { dispute: { id: 'dp_old', status: 'lost', charge: 'ch_last_year', subscriptionId: 'sub_old' } })).toEqual(run(sub('active')));
  });

  it('warning_closed and prevented restore access', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'warning_closed' } }).plan).toBe('paid');
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'prevented' } }).plan).toBe('paid');
  });

  it('an unknown dispute status fails closed with an alertable reason, even with DISPUTE_ACTION ignore', () => {
    const r = run(sub('active'), { dispute: { id: 'dp_1', status: 'new_open_status' } });
    expect(r).toEqual({ plan: 'free', until: null, reason: 'unknown_dispute_status:new_open_status' });
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'new_open_status' }, policy: { ...POLICY, DISPUTE_ACTION: 'ignore' } }).plan).toBe('free');
  });
});

describe('accessFor: paid-through rule (no access for time not paid for)', () => {
  it('pause_collection: access ends at the last PAID period end, no grace, even after two advanced periods', () => {
    // Paid period ended 60 days ago; Stripe has since advanced two monthly periods with voided invoices.
    const lastPaid = NOW - 60 * DAY;
    const s = sub('active', { pause_collection: { behavior: 'void' }, items: { data: [{ current_period_start: NOW - 2 * DAY, current_period_end: NOW + 28 * DAY }] } });
    expect(run(s, { lastPaid, charge: { ...paidCharge, created: lastPaid - 30 * DAY } })).toEqual({ plan: 'free', until: null, reason: 'collection_paused_ended' });
  });

  it('pause_collection inside the paid period: paid to the paid end, then free', () => {
    const s = sub('active', { pause_collection: { behavior: 'void' } });
    expect(run(s)).toEqual({ plan: 'paid', until: END, reason: 'collection_paused' });
    expect(run(s, { now: END }).plan).toBe('free');
  });

  it('current period unproven (latest charge older than the period start): last paid end plus PAST_DUE_GRACE_DAYS, never the new period', () => {
    const s = sub('active', { items: { data: [{ current_period_start: NOW - 3600, current_period_end: NOW + 365 * DAY }] } });
    const oldCharge = { ...paidCharge, created: NOW - 365 * DAY };
    const r = run(s, { charge: oldCharge, lastPaid: NOW - 3600 });
    expect(r).toEqual({ plan: 'paid', until: NOW - 3600 + 7 * DAY, reason: 'renewal_payment_pending' });
    expect(run(s, { charge: oldCharge, lastPaid: NOW - 3600, now: NOW + 8 * DAY }).plan).toBe('free');
  });

  it('a stale lastPaidPeriodEnd alone also makes the period unproven', () => {
    // Paid through yesterday only, although Stripe's current period runs to END.
    expect(run(sub('active'), { lastPaid: NOW - DAY })).toEqual({ plan: 'paid', until: NOW + 6 * DAY, reason: 'renewal_payment_pending' });
    expect(run(sub('active'), { lastPaid: START }).plan).toBe('free');
  });

  it('no paid period known: free', () => {
    expect(run(sub('active'), { lastPaid: null }).reason).toBe('no_paid_period');
  });

  it('normal active, current period paid: period end plus grace', () => {
    expect(run(sub('active'))).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active' });
  });

  it('canceled at period end never grants past the last paid period', () => {
    const s = sub('canceled', { cancel_at_period_end: true, ended_at: END, cancellation_details: { reason: 'cancellation_requested' } });
    expect(run(s, { now: END + DAY, lastPaid: END - 30 * DAY }).plan).toBe('free');
  });

  it('status paused stays free', () => {
    expect(run(sub('paused', { pause_collection: null })).reason).toBe('paused');
  });
});

describe('accessFor: combinations (ported from the coverage review scratch run)', () => {
  it('past_due + cancel_at_period_end: past-due grace applies', () => {
    const s = sub('past_due', { cancel_at_period_end: true, items: { data: [{ current_period_start: NOW - 2 * DAY, current_period_end: NOW + 28 * DAY }] } });
    expect(run(s, { lastPaid: NOW - 2 * DAY }).plan).toBe('paid');
    expect(run(s, { lastPaid: NOW - 2 * DAY, now: NOW + 6 * DAY }).plan).toBe('free');
  });

  it('active + open dispute + full refund: free; with the dispute won it stays free (refunded)', () => {
    const refunded = { ...paidCharge, refunded: true, amount_refunded: 3900 };
    expect(run(sub('active'), { charge: refunded, dispute: { id: 'dp', status: 'needs_response' } }).plan).toBe('free');
    expect(run(sub('active'), { charge: refunded, dispute: { id: 'dp', status: 'won' } }).reason).toBe('refunded_full');
  });

  it('paused then resumed (active with a new paid period): paid', () => {
    expect(run(sub('paused')).plan).toBe('free');
    expect(run(sub('active')).plan).toBe('paid');
  });

  it('partial then full refund: unchanged, then free', () => {
    expect(run(sub('active'), { charge: { ...paidCharge, amount_refunded: 1000 } }).plan).toBe('paid');
    expect(run(sub('active'), { charge: { ...paidCharge, amount_refunded: 3900 } }).reason).toBe('refunded_full');
  });

  it('dispute lost after the period end: free (active-stale and canceled)', () => {
    expect(run(sub('active'), { now: END + DAY, dispute: { id: 'dp', status: 'lost' } }).reason).toBe('dispute_lost');
    expect(run(sub('canceled'), { now: END + DAY, dispute: { id: 'dp', status: 'lost' } }).reason).toBe('dispute_lost');
  });

  it('canceled with a later refund: free', () => {
    expect(run(sub('canceled'), { charge: { ...paidCharge, refunded: true } }).reason).toBe('refunded_full');
  });

  it('period end exactly equal to now with grace 0: free (end is exclusive)', () => {
    expect(run(sub('active'), { now: END, policy: { ...POLICY, ACCESS_END_GRACE_DAYS: 0 } }).plan).toBe('free');
    expect(run(sub('active'), { now: END - 1, policy: { ...POLICY, ACCESS_END_GRACE_DAYS: 0 } }).plan).toBe('paid');
  });

  it('past_due grace boundary at exactly N days', () => {
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW, current_period_end: NOW + 30 * DAY }] } });
    expect(run(s, { lastPaid: NOW, now: NOW + 7 * DAY - 1 }).plan).toBe('paid');
    expect(run(s, { lastPaid: NOW, now: NOW + 7 * DAY }).plan).toBe('free');
  });
});

describe('fix round 3: past_due anchor, dispute id validation, lastPaidPeriodEnd contract', () => {
  it('past_due with no proven paid period fails closed', () => {
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW, current_period_end: NOW + 30 * DAY }] } });
    expect(run(s, { lastPaid: null })).toEqual({ plan: 'free', until: null, reason: 'no_paid_period' });
  });

  it('past_due grace does not come from the (unpaid) new period start', () => {
    // Stale proof: the last paid period ended 40 days ago, the new period started today.
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW, current_period_end: NOW + 30 * DAY }] } });
    expect(run(s, { lastPaid: NOW - 40 * DAY }).plan).toBe('free');
  });

  const badIds: Array<[string, Record<string, unknown>]> = [
    ['omitted key', {}],
    ['undefined', { subscriptionId: undefined }],
    ['explicit null', { subscriptionId: null }],
    ['empty string', { subscriptionId: '' }],
    ['expanded object', { subscriptionId: { id: 'sub_1' } }],
  ];
  for (const [name, extra] of badIds) {
    it(`dispute subscription id ${name}: unresolved, fails closed (open and lost)`, () => {
      for (const status of ['needs_response', 'lost']) {
        const dispute = { id: 'dp_x', status, charge: 'ch_old', ...extra } as unknown as Parameters<typeof accessFor>[2];
        const r = accessFor(sub('active'), paidCharge, dispute, [], NOW, POLICY, END);
        expect(r, `${name} ${status}`).toEqual({ plan: 'free', until: null, reason: 'dispute_unresolved' });
      }
    });
  }

  it('lastPaidPeriodEnd: null gives free for active; negative or fractional throws', () => {
    expect(run(sub('active'), { lastPaid: null }).reason).toBe('no_paid_period');
    expect(() => run(sub('active'), { lastPaid: -1 })).toThrow(AccessInputError);
    expect(() => run(sub('active'), { lastPaid: END + 0.5 })).toThrow(AccessInputError);
    expect(() => run(sub('active'), { lastPaid: Number.NaN })).toThrow(AccessInputError);
  });
});

describe('accessFor: input guards', () => {
  it('throws when now looks like milliseconds', () => {
    expect(() => run(sub('active'), { now: NOW * 1000 })).toThrow(AccessInputError);
  });

  it('throws on a non-finite or negative now', () => {
    expect(() => run(sub('active'), { now: Number.NaN })).toThrow(AccessInputError);
    expect(() => run(sub('active'), { now: -1 })).toThrow(AccessInputError);
  });

  for (const k of ['ACCESS_END_GRACE_DAYS', 'PAST_DUE_GRACE_DAYS', 'TRIAL_DAYS'] as const) {
    it(`throws when policy ${k} is NaN, negative, infinite, fractional or above its maximum`, () => {
      for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, 1.5, k === 'TRIAL_DAYS' ? 91 : 31]) {
        expect(() => run(sub('active'), { policy: { ...POLICY, [k]: bad } })).toThrow(AccessInputError);
      }
    });
  }

  it('throws on an unknown DISPUTE_ACTION', () => {
    expect(() => run(sub('active'), { policy: { ...POLICY, DISPUTE_ACTION: 'refund' as 'pause' } })).toThrow(AccessInputError);
  });
});

describe('policyFromEnv', () => {
  it('parses the string vars', () => {
    expect(
      policyFromEnv({ ACCESS_END_GRACE_DAYS: '3', PAST_DUE_GRACE_DAYS: '5', TRIAL_DAYS: '0', DISPUTE_ACTION: 'ignore', STRIPE_SIGNATURE_TOLERANCE_SECONDS: '600' }),
    ).toEqual({ policy: { ACCESS_END_GRACE_DAYS: 3, PAST_DUE_GRACE_DAYS: 5, TRIAL_DAYS: 0, DISPUTE_ACTION: 'ignore' }, toleranceSeconds: 600 });
  });

  it('uses the plan defaults when a var is missing', () => {
    expect(policyFromEnv({})).toEqual({ policy: POLICY, toleranceSeconds: 300 });
  });

  it('refuses bad values instead of turning them into NaN', () => {
    for (const env of [
      { ACCESS_END_GRACE_DAYS: 'seven' },
      { PAST_DUE_GRACE_DAYS: '-1' },
      { TRIAL_DAYS: '1e3x' },
      { DISPUTE_ACTION: 'Pause' },
      { STRIPE_SIGNATURE_TOLERANCE_SECONDS: '0' },
      { ACCESS_END_GRACE_DAYS: '31' },
      { PAST_DUE_GRACE_DAYS: '999999999' },
      { TRIAL_DAYS: '91' },
      { STRIPE_SIGNATURE_TOLERANCE_SECONDS: '3601' },
      { STRIPE_SIGNATURE_TOLERANCE_SECONDS: '315360000' },
      { ACCESS_END_GRACE_DAYS: '7.5' },
    ]) {
      expect(() => policyFromEnv(env), JSON.stringify(env)).toThrow(AccessInputError);
    }
  });
});

describe('policy maxima', () => {
  it('accepts exactly the maxima', () => {
    expect(policyFromEnv({ ACCESS_END_GRACE_DAYS: '30', PAST_DUE_GRACE_DAYS: '30', TRIAL_DAYS: '90', STRIPE_SIGNATURE_TOLERANCE_SECONDS: '3600' }).toleranceSeconds).toBe(3600);
  });

  it('lastPaidPeriodEnd in milliseconds is refused', () => {
    expect(() => run(sub('active'), { lastPaid: END * 1000 })).toThrow(AccessInputError);
  });
});
