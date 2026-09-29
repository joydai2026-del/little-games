// Which Stripe events the hub handles, and step 2 of the plan's "Webhook
// processing": decide whether an event is Avery's BY CUSTOMER. Metadata and
// price are not used, because Stripe does not copy metadata to related
// objects, a Charge has no price, and a Dispute has no customer field. The
// Ownly Network LLC account is shared with Agent Company, so anything whose
// customer is not a known teacher is `not_avery` (the route answers 200 and
// records it).
import type { StripeClient, StripeObject } from './client';

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

const HANDLED = new Set<string>(HANDLED_EVENTS);
export const isHandledEvent = (type: string): type is HandledEvent => HANDLED.has(type);

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: StripeObject };
}

export type Resolution =
  | { kind: 'avery'; customerId: string }
  | { kind: 'not_avery'; customerId: string | null }
  | { kind: 'unhandled_type' };

/** `customer` may be an id or an expanded object. */
function idOf(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id;
  return null;
}

/** The customer id the event belongs to, fetching the charge for disputes. */
export async function customerOf(event: StripeEventLike, client: StripeClient): Promise<string | null> {
  const obj = event.data.object;
  if (event.type.startsWith('charge.dispute.')) {
    const charge = obj.charge;
    if (charge && typeof charge === 'object' && 'customer' in charge) return idOf((charge as StripeObject).customer);
    const chargeId = idOf(charge);
    if (!chargeId) return null;
    const fetched = await client.get(`/v1/charges/${encodeURIComponent(chargeId)}`);
    return idOf(fetched.customer);
  }
  return idOf(obj.customer);
}

/**
 * Step 2 of webhook processing. `isAveryCustomer` looks the id up in
 * `teachers.stripe_customer_id` (tombstones included); it is passed in so this
 * module does not depend on the database layer.
 */
export async function resolveCustomer(
  event: StripeEventLike,
  client: StripeClient,
  isAveryCustomer: (customerId: string) => Promise<boolean>,
): Promise<Resolution> {
  if (!isHandledEvent(event.type)) return { kind: 'unhandled_type' };
  const customerId = await customerOf(event, client);
  if (!customerId) return { kind: 'not_avery', customerId: null };
  return (await isAveryCustomer(customerId)) ? { kind: 'avery', customerId } : { kind: 'not_avery', customerId };
}
