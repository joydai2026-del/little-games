// Fake payloads for each handled event type. Customer and charge ids are
// synthetic test fixtures, not real Stripe objects.
import { describe, expect, it } from 'vitest';
import type { StripeClient, StripeObject } from '../../src/stripe/client';
import { HANDLED_EVENTS, isHandledEvent, resolveCustomer, type StripeEventLike } from '../../src/stripe/events';

const AVERY = 'cus_avery_teacher';
const OTHER = 'cus_agent_company';
const isAvery = async (id: string) => id === AVERY;

function fakeClient(charges: Record<string, StripeObject>) {
  const gets: string[] = [];
  const client: StripeClient = {
    async get(path) {
      gets.push(path);
      const id = path.split('/').pop()!;
      const c = charges[id];
      if (!c) throw new Error(`no fake charge ${id}`);
      return c;
    },
    async post() { throw new Error('events must not write to Stripe'); },
    async listAll() { throw new Error('not used'); },
  };
  return { client, gets };
}

const ev = (type: string, object: StripeObject): StripeEventLike => ({ id: `evt_${type}`, type, data: { object } });

const byCustomer: Array<[string, StripeObject]> = [
  ['checkout.session.completed', { object: 'checkout.session', id: 'cs_1', customer: AVERY }],
  ['customer.subscription.created', { object: 'subscription', id: 'sub_1', customer: AVERY }],
  ['customer.subscription.updated', { object: 'subscription', id: 'sub_1', customer: AVERY }],
  ['customer.subscription.deleted', { object: 'subscription', id: 'sub_1', customer: AVERY }],
  ['customer.subscription.paused', { object: 'subscription', id: 'sub_1', customer: AVERY }],
  ['customer.subscription.resumed', { object: 'subscription', id: 'sub_1', customer: AVERY }],
  ['invoice.paid', { object: 'invoice', id: 'in_1', customer: AVERY }],
  ['invoice.payment_failed', { object: 'invoice', id: 'in_1', customer: AVERY }],
  ['charge.refunded', { object: 'charge', id: 'ch_1', customer: AVERY, refunded: true }],
];

describe('event allow-list', () => {
  it('is exactly the plan list of eleven events', () => {
    expect(HANDLED_EVENTS).toHaveLength(11);
    for (const [type] of byCustomer) expect(isHandledEvent(type)).toBe(true);
    expect(isHandledEvent('charge.dispute.created')).toBe(true);
    expect(isHandledEvent('charge.dispute.closed')).toBe(true);
  });

  it('an unhandled type is reported as such (the route acknowledges it with 200, CRM behaviour)', async () => {
    const { client, gets } = fakeClient({});
    expect(isHandledEvent('invoice.created')).toBe(false);
    expect(await resolveCustomer(ev('invoice.created', { customer: AVERY }), client, isAvery)).toEqual({ kind: 'unhandled_type' });
    expect(gets).toHaveLength(0);
  });
});

describe('resolveCustomer', () => {
  for (const [type, object] of byCustomer) {
    it(`${type}: Avery by the object's customer, no extra fetch`, async () => {
      const { client, gets } = fakeClient({});
      expect(await resolveCustomer(ev(type, object), client, isAvery)).toEqual({ kind: 'avery', customerId: AVERY });
      expect(gets).toHaveLength(0);
    });
  }

  it('expanded customer object works too', async () => {
    const { client } = fakeClient({});
    const r = await resolveCustomer(ev('invoice.paid', { customer: { id: AVERY, object: 'customer' } }), client, isAvery);
    expect(r).toEqual({ kind: 'avery', customerId: AVERY });
  });

  for (const type of ['charge.dispute.created', 'charge.dispute.closed']) {
    it(`${type}: fetches the dispute's charge and uses the charge's customer`, async () => {
      const { client, gets } = fakeClient({ ch_disputed: { object: 'charge', id: 'ch_disputed', customer: AVERY } });
      const r = await resolveCustomer(ev(type, { object: 'dispute', id: 'dp_1', charge: 'ch_disputed', status: 'needs_response' }), client, isAvery);
      expect(r).toEqual({ kind: 'avery', customerId: AVERY });
      expect(gets).toEqual(['/v1/charges/ch_disputed']);
    });
  }

  it('a refund on a non-Avery customer on the shared account is not_avery', async () => {
    const { client } = fakeClient({});
    const r = await resolveCustomer(ev('charge.refunded', { object: 'charge', id: 'ch_x', customer: OTHER, refunded: true }), client, isAvery);
    expect(r).toEqual({ kind: 'not_avery', customerId: OTHER });
  });

  it('a dispute on a non-Avery charge is not_avery', async () => {
    const { client } = fakeClient({ ch_other: { object: 'charge', id: 'ch_other', customer: OTHER } });
    const r = await resolveCustomer(ev('charge.dispute.created', { object: 'dispute', id: 'dp_2', charge: 'ch_other' }), client, isAvery);
    expect(r).toEqual({ kind: 'not_avery', customerId: OTHER });
  });

  it('metadata app=avery alone does NOT make an event Avery (customer decides)', async () => {
    const { client } = fakeClient({});
    const r = await resolveCustomer(ev('customer.subscription.updated', { id: 'sub_9', customer: OTHER, metadata: { app: 'avery' } }), client, isAvery);
    expect(r.kind).toBe('not_avery');
  });

  it('no customer at all (guest charge) is not_avery with a null id', async () => {
    const { client } = fakeClient({ ch_guest: { object: 'charge', id: 'ch_guest', customer: null } });
    expect(await resolveCustomer(ev('charge.refunded', { id: 'ch_g', customer: null }), client, isAvery)).toEqual({ kind: 'not_avery', customerId: null });
    expect(await resolveCustomer(ev('charge.dispute.closed', { id: 'dp_3', charge: 'ch_guest' }), client, isAvery)).toEqual({ kind: 'not_avery', customerId: null });
  });
});
