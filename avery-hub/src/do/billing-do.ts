// TODO(S2b): BillingDO serializes one Stripe customer's webhook events
// (plan section "Webhook processing"). Declared in S1 only so the binding and
// its Durable Object migration exist from the first deploy.
import { DurableObject } from 'cloudflare:workers';

export class BillingDO extends DurableObject {
  async fetch(): Promise<Response> {
    return new Response('Not built yet (S2b).', { status: 501 });
  }
}
