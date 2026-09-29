// One test per row of the plan's accessFor table, then the extra cases the S2a
// brief asks for. Times are Unix seconds. Payloads use the 2026-08-26.dahlia
// shape (period on subscription items).
import { describe, expect, it } from 'vitest';
import { accessFor, type AccessPolicy, type SubscriptionLike } from '../../src/stripe/access';

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
const paidCharge = { id: 'ch_1', paid: true, refunded: false, amount: 3900, amount_captured: 3900, amount_refunded: 0 };
const run = (s: SubscriptionLike | null, opts: { charge?: typeof paidCharge | null; dispute?: { id: string; status: string } | null; now?: number; policy?: AccessPolicy; ops?: Parameters<typeof accessFor>[3] } = {}) =>
  accessFor(s, opts.charge === undefined ? paidCharge : opts.charge, opts.dispute ?? null, opts.ops ?? [], opts.now ?? NOW, opts.policy ?? POLICY);

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

  it('past_due: paid during PAST_DUE_GRACE_DAYS from the period start, then free', () => {
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW - 2 * DAY, current_period_end: NOW + 363 * DAY }] } });
    expect(run(s)).toEqual({ plan: 'paid', until: NOW + 5 * DAY, reason: 'past_due_grace' });
    expect(run(s, { now: NOW + 6 * DAY })).toEqual({ plan: 'free', until: null, reason: 'past_due_grace_ended' });
  });

  it('unpaid: free', () => {
    expect(run(sub('unpaid')).plan).toBe('free');
  });

  it('paused: free', () => {
    expect(run(sub('paused'))).toEqual({ plan: 'free', until: null, reason: 'paused' });
  });

  it('active with cancel_at_period_end: paid until period end + grace, then free', () => {
    const s = sub('active', { cancel_at_period_end: true });
    expect(run(s)).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active_canceling' });
    expect(run(s, { now: END + 7 * DAY + 1 }).plan).toBe('free');
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
      expect(run(sub('active'), { dispute: { id: 'dp_1', status } })).toEqual({ plan: 'free', until: null, reason: 'dispute_open' });
    }
  });

  it('dispute won: back to what the subscription says', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'won' } })).toEqual(run(sub('active')));
    expect(run(sub('canceled'), { dispute: { id: 'dp_1', status: 'won' } }).plan).toBe('free');
  });

  it('dispute lost: free', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'lost' } })).toEqual({ plan: 'free', until: null, reason: 'dispute_lost' });
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
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'needs_response' } }).plan).toBe('free');
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'won' } })).toEqual({ plan: 'paid', until: END + 7 * DAY, reason: 'active' });
  });

  it('DISPUTE_ACTION ignore leaves an open dispute without effect', () => {
    expect(run(sub('active'), { dispute: { id: 'dp_1', status: 'needs_response' }, policy: { ...POLICY, DISPUTE_ACTION: 'ignore' } }).plan).toBe('paid');
  });

  it('cancel_at_period_end keeps paid until period end plus grace, exactly', () => {
    const s = sub('active', { cancel_at_period_end: true });
    expect(run(s, { now: END + 7 * DAY - 1 }).plan).toBe('paid');
    expect(run(s, { now: END + 7 * DAY }).plan).toBe('free');
  });

  it('cancel_at earlier than the period end ends access at cancel_at plus grace', () => {
    const s = sub('active', { cancel_at: NOW + 10 * DAY });
    expect(run(s)).toEqual({ plan: 'paid', until: NOW + 17 * DAY, reason: 'active_canceling' });
  });

  it('grace comes from the policy object, not a literal', () => {
    expect(run(sub('active'), { policy: { ...POLICY, ACCESS_END_GRACE_DAYS: 0 } }).until).toBe(END);
    const s = sub('past_due', { items: { data: [{ current_period_start: NOW - 2 * DAY, current_period_end: END }] } });
    expect(run(s, { policy: { ...POLICY, PAST_DUE_GRACE_DAYS: 1 } }).plan).toBe('free');
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
