// End-to-end test of scripts/stripe-setup.ts against an in-memory fake Stripe
// (a fake `fetch` that stores objects, honours idempotency keys and holds a few
// non-Avery objects, like the shared Ownly account does). No network.
import { describe, expect, it } from 'vitest';
import { STRIPE_API_VERSION, createStripeClient, type StripeObject } from '../../src/stripe/client';
import { HANDLED_EVENTS } from '../../src/stripe/events';
import { AVERY_STRIPE_SETUP, SetupRefused, checkKeyMode, parseArgs, runSetup, type SetupArgs } from '../../scripts/stripe-setup';

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
const bool = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v);
function deepBool(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(deepBool);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepBool(v)]));
  return bool(o);
}

class FakeStripe {
  store = { products: [] as StripeObject[], prices: [] as StripeObject[], portals: [] as StripeObject[], webhooks: [] as StripeObject[] };
  posts: Array<{ path: string; key: string | undefined }> = [];
  idem = new Map<string, StripeObject>();
  private n = 0;
  livemode = false;

  constructor() {
    // Objects that belong to another product on the shared account.
    this.store.products.push({ id: 'prod_agentco', object: 'product', active: true, name: 'Agent Company Pro', metadata: { app: 'agent-company' } });
    this.store.portals.push({ id: 'bpc_default', object: 'billing_portal.configuration', active: true, is_default: true, metadata: {}, features: {} });
    this.store.webhooks.push({ id: 'we_agentco', object: 'webhook_endpoint', url: 'https://api.ownlyagent.com/stripe', enabled_events: ['*'], status: 'enabled', metadata: {} });
  }

  private id(prefix: string) {
    return `${prefix}_fake${++this.n}`;
  }

  private list(items: StripeObject[]) {
    return { object: 'list', data: items, has_more: false };
  }

  handle(method: string, url: URL, body: string, key: string | undefined): { status: number; body: unknown } {
    const p = url.pathname;
    if (method === 'POST') {
      this.posts.push({ path: p, key });
      if (!key) return { status: 400, body: { error: { message: 'test fake: idempotency key missing' } } };
      const cached = this.idem.get(key);
      if (cached) return { status: 200, body: cached };
      const form = deepBool(decodeForm(body)) as Record<string, unknown>;
      const res = this.mutate(p, form);
      if ('error' in res) return { status: 400, body: res };
      this.idem.set(key, res);
      return { status: 200, body: res };
    }
    const q = url.searchParams;
    const byId = (items: StripeObject[], id: string) => items.find((o) => o.id === id);
    let m: RegExpMatchArray | null;
    if (p === '/v1/products') return { status: 200, body: this.list(this.store.products.filter((o) => q.get('active') !== 'true' || o.active)) };
    if ((m = p.match(/^\/v1\/products\/(.+)$/))) return this.found(byId(this.store.products, m[1]!));
    if (p === '/v1/prices') {
      const keys = [...q.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v);
      return { status: 200, body: this.list(this.store.prices.filter((o) => keys.includes(String(o.lookup_key)))) };
    }
    if ((m = p.match(/^\/v1\/prices\/(.+)$/))) return this.found(byId(this.store.prices, m[1]!));
    if (p === '/v1/billing_portal/configurations') return { status: 200, body: this.list(this.store.portals) };
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

  private mutate(p: string, form: Record<string, unknown>): StripeObject {
    let m: RegExpMatchArray | null;
    if (p === '/v1/products') {
      const o = { id: this.id('prod'), object: 'product', active: true, livemode: this.livemode, ...form };
      this.store.products.push(o);
      return o;
    }
    if ((m = p.match(/^\/v1\/products\/(.+)$/))) {
      const o = this.store.products.find((x) => x.id === m![1]);
      return Object.assign(o!, form);
    }
    if (p === '/v1/prices') {
      const o = { id: this.id('price'), object: 'price', active: true, ...form, unit_amount: num(form.unit_amount) };
      this.store.prices.push(o);
      return o;
    }
    if (p === '/v1/billing_portal/configurations') {
      const o = { id: this.id('bpc'), object: 'billing_portal.configuration', active: true, is_default: false, ...form };
      this.store.portals.push(o);
      return o;
    }
    if ((m = p.match(/^\/v1\/billing_portal\/configurations\/(.+)$/))) {
      const o = this.store.portals.find((x) => x.id === m![1]);
      return Object.assign(o!, form);
    }
    if (p === '/v1/webhook_endpoints') {
      const o = { id: this.id('we'), object: 'webhook_endpoint', status: 'enabled', secret: 'whsec_FAKE_SIGNING_SECRET_must_not_print', ...form };
      this.store.webhooks.push(o);
      return o;
    }
    if ((m = p.match(/^\/v1\/webhook_endpoints\/(.+)$/))) {
      const o = this.store.webhooks.find((x) => x.id === m![1]);
      return Object.assign(o!, form);
    }
    return { error: { message: `test fake: no route POST ${p}` } };
  }

  fetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const r = this.handle(init?.method ?? 'GET', url, typeof init?.body === 'string' ? init.body : '', headers['Idempotency-Key']);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
}

const ARGS: SetupArgs = { env: 'staging', live: false, ackTaxGate: false, hubOrigin: 'https://hub-staging.averystudio.org' };

async function setup(fake: FakeStripe, args = ARGS) {
  const lines: string[] = [];
  const client = createStripeClient({ secretKey: 'rk_test_fake', fetch: fake.fetch, sleep: async () => {} });
  const rb = await runSetup({ client, args, apiVersion: STRIPE_API_VERSION, webhookEvents: HANDLED_EVENTS, out: (l) => lines.push(l) });
  return { rb, output: lines.join('\n') };
}

describe('stripe-setup against a fake Stripe', () => {
  it('first run creates product, two prices, portal and webhook with the plan values', async () => {
    const fake = new FakeStripe();
    const { rb } = await setup(fake);
    expect(rb.counts).toEqual({ created: 5, updated: 0, unchanged: 0 });

    const product = fake.store.products.find((p) => (p.metadata as Record<string, string>).app === 'avery')!;
    expect(product.name).toBe('Avery Classroom Games');
    expect(product.statement_descriptor).toBe('AVERY STUDIO');

    const byKey = Object.fromEntries(fake.store.prices.map((p) => [p.lookup_key, p]));
    expect(byKey.avery_yearly_v1).toMatchObject({ unit_amount: 3900, currency: 'usd', recurring: { interval: 'year' }, product: product.id });
    expect(byKey.avery_monthly_v1).toMatchObject({ unit_amount: 699, currency: 'usd', recurring: { interval: 'month' }, product: product.id });

    const portal = fake.store.portals.find((c) => (c.metadata as Record<string, string>).app === 'avery')!;
    expect(portal.features).toEqual({
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: { enabled: false },
    });

    const hook = fake.store.webhooks.find((w) => w.url === 'https://hub-staging.averystudio.org/stripe/webhook')!;
    expect([...(hook.enabled_events as string[])].sort()).toEqual([...HANDLED_EVENTS].sort());
    expect(hook.api_version).toBe(STRIPE_API_VERSION);

    expect(rb.config).toEqual({
      STRIPE_PRODUCT_ID: product.id,
      STRIPE_PRICE_YEARLY: byKey.avery_yearly_v1!.id,
      STRIPE_PRICE_MONTHLY: byKey.avery_monthly_v1!.id,
      STRIPE_PORTAL_CONFIG_ID: portal.id,
    });
  });

  it('every POST carries an idempotency key', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    expect(fake.posts.length).toBeGreaterThan(0);
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
    expect(output).not.toContain('whsec_');
    expect(JSON.stringify(rb)).not.toContain('whsec_');
    expect(output).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('prints a readback table with descriptor, both prices, portal features and events', async () => {
    const { output } = await setup(new FakeStripe());
    expect(output).toContain('descriptor=AVERY STUDIO');
    expect(output).toContain('39.00 USD per year');
    expect(output).toContain('6.99 USD per month');
    expect(output).toContain('cancel=on(at_period_end)');
    expect(output).toContain('plan switch=off');
    expect(output).toContain('charge.dispute.closed');
    expect(output).toContain('created 5, updated 0, unchanged 0');
  });

  it('converges drift: webhook events and portal features edited by hand are put back', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    const hook = fake.store.webhooks.find((w) => (w.metadata as Record<string, string>)?.app === 'avery')!;
    hook.enabled_events = ['charge.refunded'];
    const portal = fake.store.portals.find((c) => (c.metadata as Record<string, string>)?.app === 'avery')!;
    (portal.features as Record<string, Record<string, unknown>>).subscription_update = { enabled: true };
    const { rb } = await setup(fake);
    expect(rb.counts).toEqual({ created: 0, updated: 2, unchanged: 3 });
    expect([...(hook.enabled_events as string[])].sort()).toEqual([...HANDLED_EVENTS].sort());
  });

  it('refuses when an existing price does not match (prices cannot change)', async () => {
    const fake = new FakeStripe();
    await setup(fake);
    fake.store.prices.find((p) => p.lookup_key === 'avery_yearly_v1')!.unit_amount = 4900;
    await expect(setup(fake)).rejects.toBeInstanceOf(SetupRefused);
  });
});

describe('stripe-setup key and flag checks', () => {
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
    const a = parseArgs(['--env', 'staging', '--live', '--i-have-read-the-tax-gate', ...base]);
    expect(() => checkKeyMode(a, 'rk_live_abc')).toThrow(/only allowed with --env production/);
  });

  it('production without --live is test-mode provisioning and refuses a live key', () => {
    const a = parseArgs(['--env', 'production', ...base]);
    expect(() => checkKeyMode(a, 'rk_test_abc')).not.toThrow();
    expect(() => checkKeyMode(a, 'rk_live_abc')).toThrow(SetupRefused);
  });

  it('production --live needs the tax-gate flag and a live key', () => {
    const noAck = parseArgs(['--env', 'production', '--live', ...base]);
    expect(() => checkKeyMode(noAck, 'rk_live_abc')).toThrow(/tax-gate/);
    const ack = parseArgs(['--env', 'production', '--live', '--i-have-read-the-tax-gate', ...base]);
    expect(() => checkKeyMode(ack, 'rk_live_abc')).not.toThrow();
    expect(() => checkKeyMode(ack, 'sk_live_abc')).not.toThrow();
    expect(() => checkKeyMode(ack, 'rk_test_abc')).toThrow(/live key/);
  });

  it('a refusal message never contains the key', () => {
    const a = parseArgs(['--env', 'staging', ...base]);
    try {
      checkKeyMode(a, 'rk_live_SECRETVALUE');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETVALUE');
    }
  });

  it('bad arguments are refused', () => {
    expect(() => parseArgs(['--env', 'prod', ...base])).toThrow(SetupRefused);
    expect(() => parseArgs(['--env', 'staging'])).toThrow(/hub-origin/);
    expect(() => parseArgs(['--env', 'staging', '--hub-origin', 'http://hub.averystudio.org'])).toThrow(/https/);
    expect(() => parseArgs(['--env', 'staging', '--hub-origin', 'https://hub.averystudio.org/x'])).toThrow(/no path/);
    expect(() => parseArgs(['--env', 'staging', '--force', ...base])).toThrow(/unknown argument/);
  });

  it('reads the key from AVERY_STRIPE_KEY', () => {
    expect(AVERY_STRIPE_SETUP.keyEnvVar).toBe('AVERY_STRIPE_KEY');
  });
});
