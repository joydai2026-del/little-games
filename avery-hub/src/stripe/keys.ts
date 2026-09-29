// Outgoing Stripe idempotency keys, per the plan's "Customer mapping" table.
// A key must be the same on every retry of one logical action and different
// for different actions, so each part is validated: no empty parts and no
// separator characters that could make two different inputs collide.
// Stripe allows keys up to 255 characters.

const PART = /^[A-Za-z0-9_-]+$/;
const MAX_KEY_LENGTH = 255;

function part(name: string, value: string): string {
  if (!PART.test(value)) throw new Error(`idempotency key part "${name}" must be letters, digits, _ or -`);
  return value;
}

function build(...parts: string[]): string {
  const key = parts.join(':');
  if (key.length > MAX_KEY_LENGTH) throw new Error('idempotency key longer than 255 characters');
  return key;
}

/** One Stripe customer per teacher. */
export const customerKey = (teacherId: string) => build('customer', part('teacherId', teacherId));

/** Checkout; `seq` is the open-checkout sequence number kept in the BillingDO. */
export function checkoutKey(teacherId: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('checkout sequence must be a non-negative integer');
  return build('checkout', part('teacherId', teacherId), String(seq));
}

export const refundKey = (chargeId: string, opId: string) => build('refund', part('chargeId', chargeId), part('opId', opId));

export type CancelReason = 'refund' | 'dispute_lost' | 'duplicate' | 'admin';

export const cancelKey = (subscriptionId: string, reason: CancelReason, opId: string) =>
  build('cancel', part('subscriptionId', subscriptionId), part('reason', reason), part('opId', opId));
