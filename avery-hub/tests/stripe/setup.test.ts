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

  private byActive(items: StripeObject[], q: URLSearchParams) {
    const a = q.get('active');
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
    if (p === '/v1/tax/settings') return { status: 200, body: { object: 'tax.settings', status: this.taxStatus, livemode: this.livemode } };
    if (p === '/v1/products') return { status: 200, body: this.list(this.byActive(this.store.products, q)) };
    if ((m = p.match(/^\/v1\/products\/(.+)$/))) return this.found(byId(this.store.products, m[1]!));
    if (p === '/v1/prices') {
      const keys = [...q.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v);
      return { status: 200, body: this.list(this.byActive(this.store.prices, q).filter((o) => keys.includes(String(o.lookup_key)))) };
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
      return Object.assign(o!, form, { updated: ++this.n });
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
      return Object.assign(o!, form, { updated: ++this.n });
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
      Object.assign(o, rest);
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
const GATES_OK: Gates = { inventory: { ok: true, reason: 'inventory_completed 2026-09-29' } };

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
  ] as const) {
    it(`refuses an existing price whose ${what} does not match, with a remediation`, async () => {
      const fake = new FakeStripe();
      await setup(fake);
      edit(fake.store.prices.find((p) => p.lookup_key === 'avery_yearly_v1')!);
      await refusal(setup(fake), what === 'livemode' ? /live mode, run is test/ : /does not match: .*Fix: archive it and bump the lookup key/);
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

  it('webhook creation needs a completed inventory receipt; nothing is written without it', async () => {
    const fake = new FakeStripe();
    await refusal(setup(fake, { gates: { inventory: { ok: false, reason: 'the inventory still contains TODO' } } }), /inventory receipt.*TODO/);
    expect(fake.posts).toHaveLength(0);
  });

  it('an existing webhook endpoint does not need the inventory receipt again', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const { rb } = await setup(fake, { gates: { inventory: { ok: false, reason: '--inventory-receipt not given' } } });
    expect(rb.counts.unchanged).toBe(5);
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

  it('tax receipt needs a real approved date not in the future', () => {
    const today = '2026-09-29';
    expect(checkTaxReceipt('approved: 2026-09-20\n', today).ok).toBe(true);
    expect(checkTaxReceipt('approved: YYYY-MM-DD\n', today).ok).toBe(false);
    expect(checkTaxReceipt('approved: 2026-02-30\n', today).reason).toMatch(/not a real date/);
    expect(checkTaxReceipt('approved: 2026-10-01\n', today).reason).toMatch(/future/);
    expect(checkTaxReceipt('I have read it\n', today).ok).toBe(false);
  });

  it('inventory receipt needs a completed date and no TODO', () => {
    const today = '2026-09-29';
    expect(checkInventoryReceipt('inventory_completed: 2026-09-29\nall rows filled\n', today).ok).toBe(true);
    expect(checkInventoryReceipt('inventory_completed: 2026-09-29\n| TODO |\n', today).reason).toMatch(/TODO/);
    expect(checkInventoryReceipt('inventory_completed: TODO\n', today).ok).toBe(false);
  });

  it('the shipped templates do NOT pass their own gates', () => {
    // Guards against someone "completing" a gate by committing the template.
    expect(inventoryTemplate).toContain('inventory_completed:');
    expect(taxReceiptTemplate).toContain('approved:');
    expect(checkInventoryReceipt(inventoryTemplate as string, '2026-09-29').ok).toBe(false);
    expect(checkTaxReceipt(taxReceiptTemplate as string, '2026-09-29').ok).toBe(false);
  });
});
