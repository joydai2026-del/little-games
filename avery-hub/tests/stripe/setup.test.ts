// End-to-end test of scripts/stripe-setup.ts against an in-memory fake Stripe
// (a fake `fetch` that stores objects, honours idempotency keys and holds a few
// non-Avery objects, like the shared Ownly account does). No network.
//
// The fake enforces the Stripe rules the script depends on (grade C: taken
// from the Stripe API reference and reviewer knowledge, not proven against the
// live API): event names must be real, statement descriptor at most 22
// characters, one active price per lookup key, and archived objects are only
// listed when `active` is not `true`.
import { describe, expect, it } from 'vitest';
// Vite `?raw` imports of the shipped templates (tsc has no module type for them).
// @ts-expect-error raw markdown import
import inventoryTemplate from '../../docs/ops/stripe-webhook-inventory.md?raw';
// @ts-expect-error raw markdown import
import taxReceiptTemplate from '../../docs/ops/tax-gate-receipt.template.md?raw';
import { STRIPE_API_VERSION, createStripeClient, type StripeObject } from '../../src/stripe/client';
import { HANDLED_EVENTS } from '../../src/stripe/events';
import {
  AVERY_STRIPE_SETUP,
  SetupRefused,
  checkInventoryReceipt,
  checkKeyMode,
  checkTaxReceipt,
  descriptorProblem,
  inventoryDigest,
  loadGates,
  reviewRowProblem,
  type ReceiptFs,
  isUnderOpsDir,
  keyFromEnv,
  parseArgs,
  readWranglerTarget,
  runSetup,
  stripJsonc,
  type ExpectedTarget,
  type Gates,
  type SetupArgs,
} from '../../scripts/stripe-setup';

/** Decode Stripe bracket form encoding back into nested objects and arrays. */
function decodeForm(body: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const path = rawKey.replace(/\]/g, '').split('[');
    let node: Record<string, unknown> | unknown[] = root;
    path.forEach((seg, i) => {
      const last = i === path.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(path[i + 1]!);
      const k = Array.isArray(node) ? Number(seg) : seg;
      const container = node as Record<string | number, unknown>;
      if (last) container[k] = value;
      else {
        container[k] ??= nextIsIndex ? [] : {};
        node = container[k] as Record<string, unknown>;
      }
    });
  }
  return root;
}

const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
function deepTyped(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(deepTyped);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepTyped(v)]));
  return o === 'true' ? true : o === 'false' ? false : o;
}

/** Real Stripe event names (subset of the webhook_endpoints create enum, read 2026-09-29). */
const STRIPE_EVENT_NAMES = new Set<string>([
  ...HANDLED_EVENTS,
  'charge.succeeded', 'charge.failed', 'charge.updated', 'charge.dispute.updated', 'customer.created', 'customer.updated',
  'invoice.created', 'invoice.finalized', 'invoice.payment_succeeded', 'payment_intent.succeeded', 'refund.created', '*',
]);

const ACCOUNT = 'acct_ownlytest123';
const ORIGIN = 'https://hub-staging.averystudio.org';

class FakeStripe {
  store = { products: [] as StripeObject[], prices: [] as StripeObject[], portals: [] as StripeObject[], webhooks: [] as StripeObject[] };
  posts: Array<{ path: string; key: string | undefined; applied: boolean }> = [];
  idem = new Map<string, StripeObject>();
  accountId = ACCOUNT;
  taxStatus = 'active';
  registrations: StripeObject[] = [{ id: 'taxreg_1', object: 'tax.registration', status: 'active', country: 'US' }];
  livemode = false;
  /** Fail the next POST whose path matches, with a 500, WITHOUT applying it. */
  failNextPost: RegExp | null = null;
  private n = 0;

  constructor() {
    // Objects that belong to another product on the shared account.
    this.store.products.push({ id: 'prod_agentco', object: 'product', active: true, livemode: false, name: 'Agent Company Pro', metadata: { app: 'agent-company' } });
    this.store.portals.push({ id: 'bpc_default', object: 'billing_portal.configuration', active: true, is_default: true, livemode: false, metadata: {}, features: {} });
    this.store.webhooks.push({ id: 'we_agentco', object: 'webhook_endpoint', url: 'https://api.ownlyagent.com/stripe', enabled_events: ['*'], status: 'enabled', livemode: false, metadata: {} });
  }

  private id(prefix: string) {
    return `${prefix}_fake${++this.n}`;
  }

  private list(items: StripeObject[]) {
    return { object: 'list', data: items, has_more: false };
  }

  /** Stripe: `active` filters; when absent, prices list ONLY active ones (API reference, read 2026-09-29). */
  private byActive(items: StripeObject[], q: URLSearchParams, defaultActiveOnly = false) {
    const a = q.get('active') ?? (defaultActiveOnly ? 'true' : null);
    return a === null ? items : items.filter((o) => (a === 'true') === (o.active !== false));
  }

  handle(method: string, url: URL, body: string, key: string | undefined): { status: number; body: unknown } {
    const p = url.pathname;
    if (method === 'POST') {
      if (this.failNextPost?.test(p)) {
        this.failNextPost = null;
        this.posts.push({ path: p, key, applied: false });
        return { status: 500, body: { error: { type: 'api_error', message: 'test fake: transient' } } };
      }
      this.posts.push({ path: p, key, applied: true });
      if (!key) return { status: 400, body: { error: { message: 'test fake: idempotency key missing' } } };
      const cached = this.idem.get(key);
      if (cached) return { status: 200, body: cached };
      const res = this.mutate(p, deepTyped(decodeForm(body)) as Record<string, unknown>);
      if ('error' in res) return { status: 400, body: res };
      this.idem.set(key, res);
      return { status: 200, body: res };
    }
    const q = url.searchParams;
    const byId = (items: StripeObject[], id: string) => items.find((o) => o.id === id);
    let m: RegExpMatchArray | null;
    if (p === '/v1/account') return { status: 200, body: { id: this.accountId, object: 'account' } };
    if (p === '/v1/tax/registrations') return { status: 200, body: this.list(this.registrations.filter((r) => q.get('status') === null || r.status === q.get('status'))) };
    if (p === '/v1/tax/settings') return { status: 200, body: { object: 'tax.settings', status: this.taxStatus, livemode: this.livemode } };
    if (p === '/v1/products') return { status: 200, body: this.list(this.byActive(this.store.products, q)) };
    if ((m = p.match(/^\/v1\/products\/(.+)$/))) return this.found(byId(this.store.products, m[1]!));
    if (p === '/v1/prices') {
      const keys = [...q.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v);
      return { status: 200, body: this.list(this.byActive(this.store.prices, q, true).filter((o) => keys.includes(String(o.lookup_key)))) };
    }
    if ((m = p.match(/^\/v1\/prices\/(.+)$/))) return this.found(byId(this.store.prices, m[1]!));
    if (p === '/v1/billing_portal/configurations') return { status: 200, body: this.list(this.byActive(this.store.portals, q)) };
    if ((m = p.match(/^\/v1\/billing_portal\/configurations\/(.+)$/))) return this.found(byId(this.store.portals, m[1]!));
    if (p === '/v1/webhook_endpoints') return { status: 200, body: this.list(this.store.webhooks.map(({ secret: _s, ...w }) => w)) };
    if ((m = p.match(/^\/v1\/webhook_endpoints\/(.+)$/))) {
      const w = byId(this.store.webhooks, m[1]!);
      if (!w) return this.found(undefined);
      const { secret: _s, ...rest } = w;
      return { status: 200, body: rest };
    }
    return { status: 404, body: { error: { message: `test fake: no route ${method} ${p}` } } };
  }

  private found(o: StripeObject | undefined) {
    return o ? { status: 200, body: o } : { status: 404, body: { error: { type: 'invalid_request_error', message: 'No such object' } } };
  }

  /** Stripe merges metadata keys on update; other fields are replaced. */
  private merge(o: StripeObject, form: Record<string, unknown>): StripeObject {
    const { metadata, ...rest } = form;
    Object.assign(o, rest, { updated: ++this.n });
    if (metadata) o.metadata = { ...(o.metadata as object), ...(metadata as object) };
    return o;
  }

  private err(message: string): StripeObject {
    return { error: { type: 'invalid_request_error', message } };
  }

  private mutate(p: string, form: Record<string, unknown>): StripeObject {
    let m: RegExpMatchArray | null;
    const desc = form.statement_descriptor;
    if (typeof desc === 'string' && desc.length > 22) return this.err('statement_descriptor too long');
    if (p === '/v1/products') {
      const o = { id: this.id('prod'), object: 'product', active: true, livemode: this.livemode, updated: this.n, ...form };
      this.store.products.push(o);
      return o;
    }
    if ((m = p.match(/^\/v1\/products\/(.+)$/))) {
      const o = this.store.products.find((x) => x.id === m![1]);
      return this.merge(o!, form);
    }
    if (p === '/v1/prices') {
      if (this.store.prices.some((x) => x.active !== false && x.lookup_key === form.lookup_key)) {
        return this.err(`A price (${String(form.lookup_key)}) already uses that lookup key.`);
      }
      const rec = form.recurring as Record<string, unknown>;
      const o = {
        id: this.id('price'), object: 'price', active: true, livemode: this.livemode, ...form,
        unit_amount: num(form.unit_amount), recurring: { ...rec, interval_count: num(rec.interval_count ?? '1') },
      };
      this.store.prices.push(o);
      return o;
    }
    if (p === '/v1/billing_portal/configurations') {
      const o = { id: this.id('bpc'), object: 'billing_portal.configuration', active: true, is_default: false, livemode: this.livemode, updated: this.n, ...form };
      this.store.portals.push(o);
      return o;
    }
    if ((m = p.match(/^\/v1\/billing_portal\/configurations\/(.+)$/))) {
      const o = this.store.portals.find((x) => x.id === m![1]);
      return this.merge(o!, form);
    }
    const badEvent = ((form.enabled_events ?? []) as string[]).find((e) => !STRIPE_EVENT_NAMES.has(e));
    if (badEvent) return this.err(`Invalid event: ${badEvent}`);
    if (p === '/v1/webhook_endpoints') {
      const o = { id: this.id('we'), object: 'webhook_endpoint', status: 'enabled', livemode: this.livemode, secret: 'whsec_FAKE_SIGNING_SECRET_must_not_print', ...form };
      this.store.webhooks.push(o);
      return o;
    }
    if ((m = p.match(/^\/v1\/webhook_endpoints\/(.+)$/))) {
      const o = this.store.webhooks.find((x) => x.id === m![1])!;
      const { disabled, ...rest } = form;
      this.merge(o, rest);
      if (disabled === false) o.status = 'enabled';
      if (disabled === true) o.status = 'disabled';
      return o;
    }
    return this.err(`test fake: no route POST ${p}`);
  }

  fetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const r = this.handle(init?.method ?? 'GET', url, typeof init?.body === 'string' ? init.body : '', headers['Idempotency-Key']);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;

  avery(kind: 'products' | 'portals' | 'webhooks') {
    return this.store[kind].find((o) => (o.metadata as Record<string, string>)?.app === 'avery')!;
  }
}

const ARGS: SetupArgs = { env: 'staging', live: false, hubOrigin: ORIGIN };
const EXPECTED: ExpectedTarget = { hubOrigin: ORIGIN, accountId: ACCOUNT };
/** The fake starts with ONE non-Avery endpoint (Agent Company); this is its reviewed digest. */
const AGENTCO_DIGEST = await inventoryDigest([new FakeStripe().store.webhooks[0]!]);
/** The review row matching the fake's Agent Company endpoint exactly. */
const AGENTCO_ROW = { id: 'we_agentco', url: 'https://api.ownlyagent.com/stripe', status: 'enabled', events: ['*'] };
const GATES_OK: Gates = { inventory: { ok: true, reason: 'test_mode_completed 2026-09-29', accountId: ACCOUNT, digest: AGENTCO_DIGEST, reviewedRows: [AGENTCO_ROW] }, tax: { taxable: true } };

async function setup(fake: FakeStripe, o: { args?: SetupArgs; expected?: ExpectedTarget; gates?: Gates } = {}) {
  const lines: string[] = [];
  const client = createStripeClient({ secretKey: 'rk_test_fake', fetch: fake.fetch, sleep: async () => {} });
  const rb = await runSetup({
    client,
    args: o.args ?? ARGS,
    expected: o.expected ?? EXPECTED,
    gates: o.gates ?? GATES_OK,
    apiVersion: STRIPE_API_VERSION,
    webhookEvents: HANDLED_EVENTS,
    out: (l) => lines.push(l),
  });
  return { rb, output: lines.join('\n') };
}

const refusal = async (p: Promise<unknown>, re: RegExp) => {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(SetupRefused);
  expect((e as Error).message).toMatch(re);
};

describe('stripe-setup against a fake Stripe', () => {
  it('first run creates product, two prices, portal and webhook with the plan values', async () => {
    const fake = new FakeStripe();
    const { rb } = await setup(fake);
    expect(rb.counts).toEqual({ created: 5, updated: 0, unchanged: 0 });

    const product = fake.avery('products');
    expect(product.name).toBe('Avery Classroom Games');
    expect(product.statement_descriptor).toBe('AVERY STUDIO');

    const byKey = Object.fromEntries(fake.store.prices.map((p) => [p.lookup_key, p]));
    expect(byKey.avery_yearly_v1).toMatchObject({ unit_amount: 3900, currency: 'usd', recurring: { interval: 'year', interval_count: 1 }, product: product.id });
    expect(byKey.avery_monthly_v1).toMatchObject({ unit_amount: 699, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, product: product.id });

    const portal = fake.avery('portals');
    expect(portal.features).toEqual({
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: { enabled: false },
    });

    const hook = fake.store.webhooks.find((w) => w.url === `${ORIGIN}/stripe/webhook`)!;
    expect([...(hook.enabled_events as string[])].sort()).toEqual([...HANDLED_EVENTS].sort());
    expect(hook.api_version).toBe(STRIPE_API_VERSION);

    expect(rb.config).toEqual({
      STRIPE_PRODUCT_ID: product.id,
      STRIPE_PRICE_YEARLY: byKey.avery_yearly_v1!.id,
      STRIPE_PRICE_MONTHLY: byKey.avery_monthly_v1!.id,
      STRIPE_PORTAL_CONFIG_ID: portal.id,
    });
  });

  it('every POST carries an idempotency key naming env and mode', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    expect(fake.posts).toHaveLength(5);
    for (const p of fake.posts) expect(p.key).toMatch(/^setup:staging:test:/);
  });

  it('running twice creates nothing new and sends no POST the second time', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const sizes = Object.fromEntries(Object.entries(fake.store).map(([k, v]) => [k, v.length]));
    const postsAfterFirst = fake.posts.length;
    const { rb } = await setup(fake);
    expect(rb.counts).toEqual({ created: 0, updated: 0, unchanged: 5 });
    expect(Object.fromEntries(Object.entries(fake.store).map(([k, v]) => [k, v.length]))).toEqual(sizes);
    expect(fake.posts.length).toBe(postsAfterFirst);
  });

  it('never touches the other product, the default portal or the other webhook on the shared account', async () => {
    const fake = new FakeStripe();
    const before = JSON.stringify([fake.store.products[0], fake.store.portals[0], fake.store.webhooks[0]]);
    await setup(fake);
    await setup(fake);
    expect(JSON.stringify([fake.store.products[0], fake.store.portals[0], fake.store.webhooks[0]])).toBe(before);
    expect(fake.posts.every((p) => !/agentco|bpc_default/.test(p.path))).toBe(true);
  });

  it('never prints the webhook signing secret, and says JJ must set it', async () => {
    const fake = new FakeStripe();
    const { output, rb } = await setup(fake);
    expect(fake.store.webhooks.some((w) => String(w.secret).startsWith('whsec_'))).toBe(true); // the fake did hand one out
    expect(output).not.toContain('whsec_');
    expect(JSON.stringify(rb)).not.toContain('whsec_');
    expect(output).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('prints a readback table with descriptor, both prices, portal features and ALL events', async () => {
    const { output } = await setup(new FakeStripe());
    expect(output).toContain('descriptor=AVERY STUDIO');
    expect(output).toContain('39.00 USD per year (count 1)');
    expect(output).toContain('6.99 USD per month (count 1)');
    expect(output).toContain('cancel=on(at_period_end)');
    expect(output).toContain('plan switch=off');
    const eventsLine = output.split('\n').find((l) => l.startsWith('webhook events'))!;
    expect(eventsLine.split('|')[1]!.trim().split(', ').sort()).toEqual([...HANDLED_EVENTS].sort());
    expect(output).toContain(`account ${ACCOUNT}`);
    expect(output).toContain('created 5, updated 0, unchanged 0');
  });

  it('converges drift: webhook events and portal features edited by hand are put back', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.avery('webhooks').enabled_events = ['charge.refunded'];
    (fake.avery('portals').features as Record<string, Record<string, unknown>>).subscription_update = { enabled: true };
    const { rb } = await setup(fake);
    expect(rb.counts).toEqual({ created: 0, updated: 2, unchanged: 3 });
    expect([...(fake.avery('webhooks').enabled_events as string[])].sort()).toEqual([...HANDLED_EVENTS].sort());
  });

  it('two drifts within 24 hours get two different update keys, and both are repaired', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const portalFeatures = () => fake.avery('portals').features as Record<string, Record<string, unknown>>;
    portalFeatures().subscription_update = { enabled: true };
    await setup(fake);
    const firstKey = fake.posts.at(-1)!.key;
    expect(portalFeatures().subscription_update!.enabled).toBe(false);
    portalFeatures().subscription_update = { enabled: true }; // same wrong value again
    await setup(fake);
    const secondKey = fake.posts.at(-1)!.key;
    expect(secondKey).not.toBe(firstKey);
    expect(portalFeatures().subscription_update!.enabled).toBe(false);
  });

  it('a retry of the same repair reuses its key', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.avery('webhooks').enabled_events = ['charge.refunded'];
    fake.failNextPost = /^\/v1\/webhook_endpoints\//;
    await setup(fake);
    const updates = fake.posts.filter((p) => p.path.startsWith('/v1/webhook_endpoints/'));
    expect(updates).toHaveLength(2);
    expect(updates[0]!.applied).toBe(false);
    expect(updates[1]!.key).toBe(updates[0]!.key);
  });

  it('re-enables a disabled Avery webhook endpoint', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.avery('webhooks').status = 'disabled';
    const { rb } = await setup(fake);
    expect(rb.counts.updated).toBe(1);
    expect(fake.avery('webhooks').status).toBe('enabled');
  });

  it('refuses an api_version mismatch on the existing endpoint, before any write', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.avery('webhooks').api_version = '2024-06-20';
    const posts = fake.posts.length;
    await refusal(setup(fake), /API version 2024-06-20/);
    expect(fake.posts.length).toBe(posts);
  });

  it('any readback mismatch is fatal', async () => {
    const fake = new FakeStripe();
    // Stripe "accepts" the portal create but stores cancel mode immediately.
    const realFetch = fake.fetch;
    fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await realFetch(input, init);
      const portal = fake.store.portals.find((c) => (c.metadata as Record<string, string>)?.app === 'avery');
      if (portal) (portal.features as Record<string, Record<string, unknown>>).subscription_cancel!.mode = 'immediately';
      return res;
    }) as typeof fetch;
    await refusal(setup(fake), /readback does not match.*subscription_cancel\.mode/);
  });

  it('an archived avery_yearly_v1 price is reported with a fix, not duplicated', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.store.prices.find((p) => p.lookup_key === 'avery_yearly_v1')!.active = false;
    const prices = fake.store.prices.length;
    await refusal(setup(fake), /avery_yearly_v1 .* is archived\. Fix: reactivate/);
    expect(fake.store.prices.length).toBe(prices);
  });

  it('an archived Avery product and an inactive Avery portal are refused with a fix', async () => {
    const f1 = new FakeStripe();
    await setup(f1);
    f1.avery('products').active = false;
    await refusal(setup(f1), /product .* is archived\. Fix: unarchive/);
    const f2 = new FakeStripe();
    await setup(f2);
    f2.avery('portals').active = false;
    await refusal(setup(f2), /portal configuration .* is inactive\. Fix: reactivate/);
  });

  it('two active prices on one lookup key are refused', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const yearly = fake.store.prices.find((p) => p.lookup_key === 'avery_yearly_v1')!;
    fake.store.prices.push({ ...yearly, id: 'price_dup' });
    await refusal(setup(fake), /2 prices share lookup key avery_yearly_v1/);
  });

  for (const [what, edit] of [
    ['amount', (p: StripeObject) => (p.unit_amount = 4900)],
    ['currency', (p: StripeObject) => (p.currency = 'eur')],
    ['interval_count', (p: StripeObject) => ((p.recurring as Record<string, unknown>).interval_count = 2)],
    ['livemode', (p: StripeObject) => (p.livemode = true)],
    ['interval', (p: StripeObject) => ((p.recurring as Record<string, unknown>).interval = 'month')],
    ['product', (p: StripeObject) => (p.product = 'prod_agentco')],
  ] as const) {
    it(`refuses an existing price whose ${what} does not match, with a remediation`, async () => {
      const fake = new FakeStripe();
      await setup(fake);
      edit(fake.store.prices.find((p) => p.lookup_key === 'avery_yearly_v1')!);
      const re =
        what === 'livemode' ? /live mode, run is test/
        : what === 'product' ? /belongs to a different product.*Fix: archive it/
        : what === 'interval' ? /interval month not year.*Fix: archive it/
        : /does not match: .*Fix: archive it and bump the lookup key/;
      await refusal(setup(fake), re);
    });
  }

  it('the key must belong to the configured Stripe account', async () => {
    const fake = new FakeStripe();
    fake.accountId = 'acct_someoneelse';
    await refusal(setup(fake), /belongs to Stripe account acct_someoneelse/);
    expect(fake.posts).toHaveLength(0);
  });

  it('the hub origin must match the configured origin for the env', async () => {
    const fake = new FakeStripe();
    await refusal(setup(fake, { args: { ...ARGS, hubOrigin: 'https://evil.example' } }), /not the configured HUB_ORIGIN/);
    expect(fake.posts).toHaveLength(0);
  });

  it('live mode refuses unless Stripe Tax is active', async () => {
    const fake = new FakeStripe();
    fake.livemode = true;
    fake.taxStatus = 'pending';
    const live: SetupArgs = { env: 'production', live: true, hubOrigin: ORIGIN, taxGateReceipt: 'docs/ops/tax-gate-receipt.md' };
    await refusal(setup(fake, { args: live }), /Stripe Tax settings status is "pending"/);
    expect(fake.posts).toHaveLength(0);
    fake.taxStatus = 'active';
    const { rb } = await setup(fake, { args: live });
    expect(rb.counts.created).toBe(5);
  });

  it('live mode, taxable per the receipt, refuses with no active Stripe Tax registration', async () => {
    const fake = new FakeStripe();
    fake.livemode = true;
    fake.registrations = [];
    const live: SetupArgs = { env: 'production', live: true, hubOrigin: ORIGIN, taxGateReceipt: 'docs/ops/tax-gate-receipt.md' };
    await refusal(setup(fake, { args: live }), /no active registration/);
    const { rb } = await setup(fake, { args: live, gates: { ...GATES_OK, tax: { taxable: false } } });
    expect(rb.counts.created).toBe(5);
  });

  it('webhook creation needs a completed inventory receipt; nothing is written without it', async () => {
    const fake = new FakeStripe();
    await refusal(setup(fake, { gates: { inventory: { ok: false, reason: 'field "test_mode_completed" is blank' } } }), /inventory receipt.*test_mode_completed/);
    expect(fake.posts).toHaveLength(0);
  });

  it('the inventory receipt must name the verified account', async () => {
    const fake = new FakeStripe();
    await refusal(setup(fake, { gates: { inventory: { ...GATES_OK.inventory, accountId: 'acct_other' } } }), /receipt is for acct_other/);
    expect(fake.posts).toHaveLength(0);
  });

  it('a stale inventory refuses: an endpoint added', async () => {
    const fake = new FakeStripe();
    fake.store.webhooks.push({ id: 'we_new', object: 'webhook_endpoint', url: 'https://other.example/h', enabled_events: ['charge.succeeded'], status: 'enabled', livemode: false, metadata: {} });
    await refusal(setup(fake), /inventory is stale/);
    expect(fake.posts).toHaveLength(0);
  });

  it('a stale inventory refuses: reviewed endpoint replaced by another, SAME count', async () => {
    const fake = new FakeStripe();
    fake.store.webhooks[0] = { id: 'we_unreviewed', object: 'webhook_endpoint', url: 'https://new.example/h', enabled_events: ['*'], status: 'enabled', livemode: false, metadata: {} };
    await refusal(setup(fake), /inventory is stale/);
  });

  it('a stale inventory refuses: events or status of a reviewed endpoint changed', async () => {
    const f1 = new FakeStripe();
    f1.store.webhooks[0]!.enabled_events = ['charge.refunded'];
    await refusal(setup(f1), /inventory is stale/);
    const f2 = new FakeStripe();
    f2.store.webhooks[0]!.status = 'disabled';
    await refusal(setup(f2), /inventory is stale/);
  });

  it('an endpoint with no complete review row is refused even when the digest matches', async () => {
    const fake = new FakeStripe();
    await refusal(setup(fake, { gates: { inventory: { ...GATES_OK.inventory, reviewedRows: [{ ...AGENTCO_ROW, id: 'we_someother' }] } } }), /no review row for we_agentco \(live: url https:\/\/api\.ownlyagent\.com\/stripe/);
    expect(fake.posts).toHaveLength(0);
  });

  const rowCases: Array<[string, typeof AGENTCO_ROW]> = [
    ['url', { ...AGENTCO_ROW, url: 'https://api.ownlyagent.com/old' }],
    ['status', { ...AGENTCO_ROW, status: 'disabled' }],
    ['events', { ...AGENTCO_ROW, events: ['charge.refunded'] }],
  ];
  for (const [what, row] of rowCases) {
    it(`a review row whose ${what} differs from the live endpoint is refused, with the live values printed`, async () => {
      const fake = new FakeStripe();
      await refusal(
        setup(fake, { gates: { inventory: { ...GATES_OK.inventory, reviewedRows: [row] } } }),
        /review row for we_agentco does not match Stripe \(live: url https:\/\/api\.ownlyagent\.com\/stripe, status enabled, events \*\)/,
      );
      expect(fake.posts).toHaveLength(0);
    });
  }

  it('a receipt naming another account also prints the digest hint', async () => {
    const fake = new FakeStripe();
    await refusal(
      setup(fake, { gates: { inventory: { ...GATES_OK.inventory, accountId: 'acct_other' } } }),
      new RegExp(`receipt is for acct_other.*test_mode_endpoints_digest after review: ${AGENTCO_DIGEST}`),
    );
  });

  it('a FOREIGN endpoint carrying app=avery metadata is still part of the digest', async () => {
    const fake = new FakeStripe();
    fake.store.webhooks.push({ id: 'we_stale_avery', object: 'webhook_endpoint', url: 'https://old-hub.example/stripe/webhook', enabled_events: ['charge.refunded'], status: 'enabled', livemode: false, metadata: { app: 'avery', avery_object: 'hub_webhook' } });
    await refusal(setup(fake), /inventory is stale/);
    // OUR hub URL, app=avery, right events, but missing the avery_object tag:
    // not the fully identified Avery endpoint, so it stays in the digest and
    // the tag backfill (a webhook write) is refused as a stale inventory.
    const f2 = new FakeStripe();
    f2.store.webhooks.push({
      id: 'we_untagged', object: 'webhook_endpoint', url: `${ORIGIN}/stripe/webhook`, enabled_events: [...HANDLED_EVENTS], status: 'enabled',
      livemode: false, api_version: STRIPE_API_VERSION, metadata: { app: 'avery' },
    });
    await refusal(setup(f2), /inventory is stale/);
    expect(f2.store.webhooks.find((w) => w.id === 'we_untagged')!.metadata).toEqual({ app: 'avery' });
  });

  it('the account-mismatch refusal also prints the digest hint', async () => {
    const fake = new FakeStripe();
    fake.accountId = 'acct_someoneelse';
    await refusal(setup(fake), new RegExp(`acct_someoneelse.*test_mode_endpoints_digest after review: ${AGENTCO_DIGEST}`));
  });

  for (const kind of ['products', 'portals'] as const) {
    it(`readback: a missing avery_object tag on the ${kind === 'products' ? 'product' : 'portal'} after the writes is fatal`, async () => {
      const fake = new FakeStripe();
      const realFetch = fake.fetch;
      fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await realFetch(input, init);
        const o = fake.store[kind].find((x) => (x.metadata as Record<string, string>)?.app === 'avery');
        if (o) delete (o.metadata as Record<string, string>).avery_object; // Stripe "forgot" the tag
        return res;
      }) as typeof fetch;
      await refusal(setup(fake), new RegExp(`readback does not match.*${kind === 'products' ? 'product' : 'portal'} metadata avery_object`));
    });
  }

  for (const kind of ['products', 'portals', 'webhooks'] as const) {
    it(`an existing Avery ${kind} object in the other Stripe mode is refused before any write`, async () => {
      const fake = new FakeStripe();
      await setup(fake);
      fake.avery(kind).livemode = true;
      const posts = fake.posts.length;
      await refusal(setup(fake), /live mode, run is test/);
      expect(fake.posts.length).toBe(posts);
    });
  }

  it('the refusal prints the current digest so the owner can record it after review', async () => {
    const fake = new FakeStripe();
    await refusal(setup(fake, { gates: { inventory: { ok: false, reason: '--inventory-receipt not given' } } }), new RegExp(`test_mode_endpoints_digest after review: ${AGENTCO_DIGEST}`));
  });

  it('the digest ignores order and the Avery endpoint itself', async () => {
    const a = { id: 'we_a', url: 'https://a', status: 'enabled', enabled_events: ['x', 'y'] };
    const b = { id: 'we_b', url: 'https://b', status: 'enabled', enabled_events: ['z'] };
    expect(await inventoryDigest([a, b])).toBe(await inventoryDigest([b, { ...a, enabled_events: ['y', 'x'] }]));
    const fake = new FakeStripe();
    await setup(fake); // adds the Avery endpoint
    const { output } = await setup(fake);
    expect(output).toContain(`test_mode_endpoints_digest | ${AGENTCO_DIGEST}`);
  });

  it('an existing, correct webhook endpoint does not need the inventory receipt again', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const { rb } = await setup(fake, { gates: { inventory: { ok: false, reason: '--inventory-receipt not given' } } });
    expect(rb.counts.unchanged).toBe(5);
  });

  it('re-enabling a disabled endpoint ALSO needs the inventory receipt', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.avery('webhooks').status = 'disabled';
    await refusal(setup(fake, { gates: { inventory: { ok: false, reason: '--inventory-receipt not given' } } }), /changing the webhook endpoint needs/);
    expect(fake.avery('webhooks').status).toBe('disabled');
  });

  it('a missing STRIPE_ACCOUNT_ID says where to read it and where to put it', () => {
    let message = '';
    try {
      readWranglerTarget('{"vars":{"HUB_ORIGIN":"https://hub.averystudio.org"},"env":{"staging":{"vars":{"HUB_ORIGIN":"https://s.example"}}}}', 'staging');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Settings, Business, Account details');
    expect(message).toContain('acct_');
    expect(message).toContain('"env" > "staging" > "vars" block of avery-hub/wrangler.jsonc');
    expect(() => readWranglerTarget('{"vars":{"HUB_ORIGIN":"https://hub.averystudio.org"}}', 'production')).toThrow(/top-level "vars" block/);
  });

  it('a legacy app=avery product and portal WITHOUT the avery_object tag are found, reused and tagged', async () => {
    const fake = new FakeStripe();
    fake.store.products.push({ id: 'prod_legacy', object: 'product', active: true, livemode: false, name: 'Avery Classroom Games', statement_descriptor: 'AVERY STUDIO', metadata: { app: 'avery' } });
    fake.store.portals.push({
      id: 'bpc_legacy', object: 'billing_portal.configuration', active: true, livemode: false, metadata: { app: 'avery' },
      features: JSON.parse(JSON.stringify({
        customer_update: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false },
      })),
    });
    const { rb } = await setup(fake);
    expect(rb.config.STRIPE_PRODUCT_ID).toBe('prod_legacy');
    expect(rb.config.STRIPE_PORTAL_CONFIG_ID).toBe('bpc_legacy');
    expect(fake.store.products.filter((p) => (p.metadata as Record<string, string>).app === 'avery')).toHaveLength(1);
    expect((fake.store.products.find((p) => p.id === 'prod_legacy')!.metadata as Record<string, string>).avery_object).toBe('classroom_product');
    expect((fake.store.portals.find((p) => p.id === 'bpc_legacy')!.metadata as Record<string, string>).avery_object).toBe('portal');
    // The second run sees tagged objects and changes nothing.
    expect((await setup(fake)).rb.counts).toEqual({ created: 0, updated: 0, unchanged: 5 });
  });

  it('two ambiguous legacy candidates are refused with a remediation, nothing written', async () => {
    const fake = new FakeStripe();
    for (const id of ['prod_legacy_a', 'prod_legacy_b']) {
      fake.store.products.push({ id, object: 'product', active: true, livemode: false, name: 'Avery Classroom Games', statement_descriptor: 'AVERY STUDIO', metadata: { app: 'avery' } });
    }
    await refusal(setup(fake), /2 untagged app=avery products .* Fix: archive the wrong ones/);
    expect(fake.posts).toHaveLength(0);
  });

  it('an INACTIVE legacy Avery product is reported with a fix, not duplicated', async () => {
    const fake = new FakeStripe();
    fake.store.products.push({ id: 'prod_legacy_old', object: 'product', active: false, livemode: false, name: 'Avery Classroom Games', statement_descriptor: 'AVERY STUDIO', metadata: { app: 'avery' } });
    await refusal(setup(fake), /untagged Avery product prod_legacy_old is archived\. Fix: unarchive/);
    expect(fake.posts).toHaveLength(0);
  });

  it('an INACTIVE legacy portal with the Avery features is reported, not duplicated', async () => {
    const fake = new FakeStripe();
    fake.store.portals.push({
      id: 'bpc_legacy_old', object: 'billing_portal.configuration', active: false, livemode: false, metadata: { app: 'avery' },
      features: {
        customer_update: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false },
      },
    });
    await refusal(setup(fake), /bpc_legacy_old is inactive\. Fix: reactivate/);
  });

  it('an active legacy product with the Avery name but a different descriptor is refused, not claimed', async () => {
    const fake = new FakeStripe();
    fake.store.products.push({ id: 'prod_namesake', object: 'product', active: true, livemode: false, name: 'Avery Classroom Games', statement_descriptor: 'OWNLY', metadata: { app: 'avery' } });
    await refusal(setup(fake), /prod_namesake has the Avery name but not the full identity/);
    expect(fake.posts).toHaveLength(0);
  });

  it('an active legacy portal WITHOUT the Avery features is refused', async () => {
    const fake = new FakeStripe();
    fake.store.portals.push({ id: 'bpc_odd', object: 'billing_portal.configuration', active: true, livemode: false, metadata: { app: 'avery' }, features: { subscription_update: { enabled: true } } });
    await refusal(setup(fake), /bpc_odd does not have the Avery features/);
  });

  it('a legacy (untagged) Avery webhook at our URL with different events is refused', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const hook = fake.avery('webhooks');
    hook.metadata = { app: 'avery' };
    hook.enabled_events = ['charge.refunded'];
    await refusal(setup(fake), /untagged app=avery webhook .* has different events/);
  });

  it('readback: a missing avery_object tag after the writes is fatal', async () => {
    const fake = new FakeStripe();
    const realFetch = fake.fetch;
    fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await realFetch(input, init);
      const w = fake.store.webhooks.find((x) => (x.metadata as Record<string, string>)?.app === 'avery');
      if (w) delete (w.metadata as Record<string, string>).avery_object; // Stripe "forgot" the tag
      return res;
    }) as typeof fetch;
    await refusal(setup(fake), /readback does not match.*webhook metadata avery_object/);
  });

  it('the fake itself rejects what Stripe rejects (bad event, long descriptor, duplicate lookup key)', async () => {
    const fake = new FakeStripe();
    const c = createStripeClient({ secretKey: 'rk_test_fake', fetch: fake.fetch, sleep: async () => {} });
    await expect(c.post('/v1/webhook_endpoints', { url: 'https://x.example/h', enabled_events: ['charge.not_a_real_event'] }, { idempotencyKey: 'a' })).rejects.toThrow(/Invalid event/);
    await expect(c.post('/v1/products', { name: 'x', statement_descriptor: 'X'.repeat(23) }, { idempotencyKey: 'b' })).rejects.toThrow(/too long/);
    await c.post('/v1/prices', { lookup_key: 'k', unit_amount: 1, currency: 'usd', recurring: { interval: 'year' } }, { idempotencyKey: 'c' });
    await expect(c.post('/v1/prices', { lookup_key: 'k', unit_amount: 1, currency: 'usd', recurring: { interval: 'year' } }, { idempotencyKey: 'd' })).rejects.toThrow(/lookup key/);
  });
});

describe('stripe-setup key, flag and config checks', () => {
  const base = ['--hub-origin', 'https://hub.averystudio.org'];

  it('staging accepts test keys only', () => {
    const a = parseArgs(['--env', 'staging', ...base]);
    expect(() => checkKeyMode(a, 'rk_test_abc')).not.toThrow();
    expect(() => checkKeyMode(a, 'sk_test_abc')).not.toThrow();
    for (const k of ['rk_live_abc', 'sk_live_abc', 'pk_test_abc', 'whatever', undefined]) {
      expect(() => checkKeyMode(a, k), String(k)).toThrow(SetupRefused);
    }
  });

  it('staging with --live is refused', () => {
    const a = parseArgs(['--env', 'staging', '--live', '--tax-gate-receipt', 'docs/ops/t.md', ...base]);
    expect(() => checkKeyMode(a, 'rk_live_abc')).toThrow(/only allowed with --env production/);
  });

  it('production without --live is test-mode provisioning and refuses a live key', () => {
    const a = parseArgs(['--env', 'production', ...base]);
    expect(() => checkKeyMode(a, 'rk_test_abc')).not.toThrow();
    expect(() => checkKeyMode(a, 'rk_live_abc')).toThrow(SetupRefused);
  });

  it('production --live needs a tax-gate receipt and a RESTRICTED live key (sk_live_ refused)', () => {
    const noReceipt = parseArgs(['--env', 'production', '--live', ...base]);
    expect(() => checkKeyMode(noReceipt, 'rk_live_abc')).toThrow(/--tax-gate-receipt/);
    const ok = parseArgs(['--env', 'production', '--live', '--tax-gate-receipt', 'docs/ops/tax-gate-receipt.md', ...base]);
    expect(() => checkKeyMode(ok, 'rk_live_abc')).not.toThrow();
    expect(() => checkKeyMode(ok, 'sk_live_abc')).toThrow(/sk_live_\) are refused/);
    expect(() => checkKeyMode(ok, 'rk_test_abc')).toThrow(/restricted live key/);
  });

  it('a refusal message never contains the key', () => {
    const a = parseArgs(['--env', 'staging', ...base]);
    let message = '';
    try {
      checkKeyMode(a, 'rk_live_SECRETVALUE');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/needs a test key/); // it DID refuse
    expect(message).not.toContain('SECRETVALUE');
  });

  it('bad arguments are refused', () => {
    expect(() => parseArgs(['--env', 'prod', ...base])).toThrow(SetupRefused);
    expect(() => parseArgs(['--env', 'staging'])).toThrow(/hub-origin/);
    expect(() => parseArgs(['--env', 'staging', '--hub-origin', 'http://hub.averystudio.org'])).toThrow(/https/);
    expect(() => parseArgs(['--env', 'staging', '--hub-origin', 'https://hub.averystudio.org/x'])).toThrow(/no path/);
    expect(() => parseArgs(['--env', 'staging', '--i-have-read-the-tax-gate', ...base])).toThrow(/unknown argument/);
  });

  it('reads the key from AVERY_STRIPE_KEY and nothing else', () => {
    expect(keyFromEnv({ AVERY_STRIPE_KEY: 'rk_test_a', STRIPE_SECRET_KEY: 'rk_test_b' })).toBe('rk_test_a');
    expect(keyFromEnv({ STRIPE_SECRET_KEY: 'rk_test_b' })).toBeUndefined();
    expect(AVERY_STRIPE_SETUP.keyEnvVar).toBe('AVERY_STRIPE_KEY');
  });

  it('statement descriptor rules', () => {
    expect(descriptorProblem('AVERY STUDIO')).toBeNull();
    expect(descriptorProblem('AVE')).toMatch(/5 to 22/);
    expect(descriptorProblem('X'.repeat(23))).toMatch(/5 to 22/);
    expect(descriptorProblem('AVERY *STUDIO')).toMatch(/character/);
  });

  it('reads HUB_ORIGIN and STRIPE_ACCOUNT_ID per env from JSONC with comments and trailing commas', () => {
    const jsonc = `{
      // top comment with "quotes"
      "vars": { "HUB_ORIGIN": "https://hub.averystudio.org", /* block */ "STRIPE_ACCOUNT_ID": "acct_prod1", },
      "env": { "staging": { "vars": { "HUB_ORIGIN": "https://s.example//not-a-comment", "STRIPE_ACCOUNT_ID": "acct_prod1" } } },
    }`;
    expect(readWranglerTarget(jsonc, 'production')).toEqual({ hubOrigin: 'https://hub.averystudio.org', accountId: 'acct_prod1' });
    expect(readWranglerTarget(jsonc, 'staging').hubOrigin).toBe('https://s.example//not-a-comment');
    expect(() => readWranglerTarget('{"vars":{"HUB_ORIGIN":"https://x"}}', 'production')).toThrow(/STRIPE_ACCOUNT_ID/);
    expect(JSON.parse(stripJsonc('{"a":"x // y",}'))).toEqual({ a: 'x // y' });
  });

  it('receipt paths must sit under docs/ops', () => {
    expect(isUnderOpsDir('/r/avery-hub/docs/ops/tax-gate-receipt.md', '/r/avery-hub/docs/ops')).toBe(true);
    expect(isUnderOpsDir('/r/avery-hub/docs/opsx/t.md', '/r/avery-hub/docs/ops')).toBe(false);
    expect(isUnderOpsDir('/tmp/t.md', '/r/avery-hub/docs/ops')).toBe(false);
  });

  const TAX_OK = 'approved: 2026-09-20\napproved_by: JJ and accountant\nhome_state: NY\ntaxable: yes\nproduct_tax_code: txcd_10000000\nregistrations: NY\n';

  it('tax receipt needs every field filled, a real approved date not in the future', () => {
    const today = '2026-09-29';
    expect(checkTaxReceipt(TAX_OK, today)).toEqual({ ok: true, reason: 'approved 2026-09-20', taxable: true });
    expect(checkTaxReceipt(TAX_OK.replace('2026-09-20', 'YYYY-MM-DD'), today).ok).toBe(false);
    expect(checkTaxReceipt(TAX_OK.replace('2026-09-20', '2026-02-30'), today).reason).toMatch(/not a real date/);
    expect(checkTaxReceipt(TAX_OK.replace('2026-09-20', '2026-10-01'), today).reason).toMatch(/future/);
    expect(checkTaxReceipt(TAX_OK.replace('JJ and accountant', ''), today).reason).toMatch(/approved_by/);
    expect(checkTaxReceipt(TAX_OK.replace('home_state: NY', 'home_state: TODO'), today).reason).toMatch(/home_state/);
    expect(checkTaxReceipt(TAX_OK.replace('taxable: yes', 'taxable: maybe'), today).reason).toMatch(/yes or no/);
    expect(checkTaxReceipt(TAX_OK.replace('txcd_10000000', 'digital'), today).reason).toMatch(/txcd_/);
    expect(checkTaxReceipt(TAX_OK.replace('registrations: NY', 'registrations: none'), today).reason).toMatch(/taxable is yes/);
    expect(checkTaxReceipt(TAX_OK.replace('taxable: yes', 'taxable: no').replace('registrations: NY', 'registrations: none'), today)).toMatchObject({ ok: true, taxable: false });
    expect(checkTaxReceipt('I have read it\n', today).ok).toBe(false);
  });

  const INV =
    `test_mode_completed: 2026-09-29\ntest_mode_account_id: acct_ownlytest123\ntest_mode_endpoints_digest: ${AGENTCO_DIGEST}\n` +
    'live_mode_completed: TODO\nlive_mode_account_id: TODO\nlive_mode_endpoints_digest: TODO\n\n' +
    '| Mode | Endpoint id | URL | Status | Events | Owner | Touches charge / subscription events? | Ignores Avery? | Action |\n|---|---|---|---|---|---|---|---|---|\n' +
    '| test | we_agentco | https://api.ownlyagent.com/stripe | enabled | * | Agent Company | yes | ignores avery | none, it decides by its own customer ids |\n' +
    '| live | TODO | | | | | | | |\n';
  const ROW = '| test | we_agentco | https://api.ownlyagent.com/stripe | enabled | * | Agent Company | yes | ignores avery | none |';

  it('inventory receipt: per-mode fields; the other mode being unfinished does not block', () => {
    const today = '2026-09-29';
    expect(checkInventoryReceipt(INV, 'test', today)).toEqual({ ok: true, reason: 'test_mode_completed 2026-09-29', accountId: 'acct_ownlytest123', digest: AGENTCO_DIGEST, reviewedRows: [AGENTCO_ROW] });
    expect(checkInventoryReceipt(INV.replace('acct_ownlytest123', ''), 'test', today).reason).toMatch(/account_id/);
    expect(checkInventoryReceipt(INV.replace(AGENTCO_DIGEST, 'TODO'), 'test', today).reason).toMatch(/endpoints_digest/);
    expect(checkInventoryReceipt(INV.replace(AGENTCO_DIGEST, 'abc'), 'test', today).reason).toMatch(/64-hex/);
  });

  it('inventory receipt: a TODO in a review row of this mode, or no row at all, refuses', () => {
    const today = '2026-09-29';
    expect(checkInventoryReceipt(INV.replace('| test | we_agentco |', '| test | TODO |'), 'test', today).reason).toMatch(/blank or unknown/);
    expect(checkInventoryReceipt(INV.replace(/\| test \|.*\n/, ''), 'test', today).reason).toMatch(/no reviewed/);
  });

  it('a test-mode inventory receipt never authorises live', () => {
    expect(checkInventoryReceipt(INV, 'live', '2026-09-29').ok).toBe(false);
  });

  it('review rows: every column parsed; incomplete, unknown or unsafe verdicts refused', () => {
    expect(reviewRowProblem(ROW)).toBeNull();
    expect(reviewRowProblem(ROW.replace('| Agent Company |', '|  |'))).toMatch(/column 6 is blank/);
    expect(reviewRowProblem(ROW.replace('| enabled |', '| unknown |'))).toMatch(/column 4 is blank or unknown/);
    expect(reviewRowProblem('| test | we_agentco | ignores avery |')).toMatch(/needs 9 columns, has 3/);
    expect(reviewRowProblem(ROW.replace('| yes |', '| maybe |'))).toMatch(/yes or no/);
    expect(reviewRowProblem(ROW.replace('ignores avery', 'no'))).toMatch(/Ignores Avery\?/);
    expect(reviewRowProblem(ROW.replace('ignores avery', 'reviewed'))).toMatch(/Ignores Avery\?/);
    expect(reviewRowProblem(ROW.replace('ignores avery', 'Avery endpoint'))).toBeNull();
    expect(reviewRowProblem(ROW.replace('we_agentco', 'agentco'))).toMatch(/we_\.\.\. or none/);
    expect(reviewRowProblem('| test | none | none | none | none | none | no | ignores avery | none |')).toBeNull();
    expect(reviewRowProblem('| test | none | - | - | - | - | no | ignores avery | none |')).toMatch(/column 3 is blank or unknown/);
    expect(reviewRowProblem(ROW.replace('| Agent Company |', '| - |'))).toMatch(/column 6 is blank or unknown/);
  });

  // An in-memory file system for the receipt wiring main() uses.
  function memFs(files: Record<string, string>, links: Record<string, string> = {}): ReceiptFs {
    const real = (p: string) => links[p] ?? p;
    return {
      existsSync: (p) => real(p) in files,
      realpathSync: (p) => real(p),
      readFileSync: (p) => files[p]!,
      resolve: (...parts) => parts.reduce((acc, part) => (part.startsWith('/') ? part : `${acc}/${part}`)),
    };
  }
  const OPS = '/r/avery-hub/docs/ops';
  const CWD = '/r/avery-hub';
  const today = '2026-09-29';

  it('loadGates: an inventory receipt under docs/ops with the right name passes', () => {
    const fsx = memFs({ [`${OPS}/stripe-webhook-inventory.md`]: INV });
    const g = loadGates(fsx, { env: 'staging', live: false, hubOrigin: ORIGIN, inventoryReceipt: 'docs/ops/stripe-webhook-inventory.md' }, { cwd: CWD, opsDir: OPS, today });
    expect(g.inventory.ok).toBe(true);
  });

  it('loadGates: a symlink that escapes docs/ops is refused', () => {
    const fsx = memFs({ '/tmp/fake-inventory.md': INV }, { [`${OPS}/stripe-webhook-inventory.md`]: '/tmp/fake-inventory.md' });
    expect(() =>
      loadGates(fsx, { env: 'staging', live: false, hubOrigin: ORIGIN, inventoryReceipt: 'docs/ops/stripe-webhook-inventory.md' }, { cwd: CWD, opsDir: OPS, today }),
    ).toThrow(/must be a file under avery-hub\/docs\/ops/);
  });

  it('loadGates: a nested archive copy with the canonical name does not count', () => {
    const fsx = memFs({ [`${OPS}/archive/stripe-webhook-inventory.md`]: INV });
    const g = loadGates(fsx, { env: 'staging', live: false, hubOrigin: ORIGIN, inventoryReceipt: 'docs/ops/archive/stripe-webhook-inventory.md' }, { cwd: CWD, opsDir: OPS, today });
    expect(g.inventory).toEqual({ ok: false, reason: 'the receipt must be docs/ops/stripe-webhook-inventory.md' });
  });

  it('loadGates: a receipt with the wrong file name does not open the webhook gate', () => {
    const fsx = memFs({ [`${OPS}/notes.md`]: INV });
    const g = loadGates(fsx, { env: 'staging', live: false, hubOrigin: ORIGIN, inventoryReceipt: 'docs/ops/notes.md' }, { cwd: CWD, opsDir: OPS, today });
    expect(g.inventory).toEqual({ ok: false, reason: 'the receipt must be docs/ops/stripe-webhook-inventory.md' });
  });

  it('loadGates: live needs a filled tax receipt; a missing file is refused', () => {
    const live: SetupArgs = { env: 'production', live: true, hubOrigin: ORIGIN, taxGateReceipt: 'docs/ops/tax-gate-receipt.md' };
    expect(() => loadGates(memFs({}), live, { cwd: CWD, opsDir: OPS, today })).toThrow(/does not exist/);
    const g = loadGates(memFs({ [`${OPS}/tax-gate-receipt.md`]: TAX_OK }), live, { cwd: CWD, opsDir: OPS, today });
    expect(g.tax).toEqual({ taxable: true });
    expect(() => loadGates(memFs({ [`${OPS}/tax-gate-receipt.md`]: 'approved: 2026-09-20\n' }), live, { cwd: CWD, opsDir: OPS, today })).toThrow(/approved_by/);
  });

  it('the shipped templates do NOT pass their own gates', () => {
    // Guards against someone "completing" a gate by committing the template.
    expect(inventoryTemplate).toContain('test_mode_completed:');
    expect(taxReceiptTemplate).toContain('approved:');
    expect(checkInventoryReceipt(inventoryTemplate as string, 'test', '2026-09-29').ok).toBe(false);
    expect(checkInventoryReceipt(inventoryTemplate as string, 'live', '2026-09-29').ok).toBe(false);
    expect(checkTaxReceipt(taxReceiptTemplate as string, '2026-09-29').ok).toBe(false);
  });
});
