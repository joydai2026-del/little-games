// Idempotent Stripe provisioning for the Avery hub (plan: "Stripe > Objects").
//
//   AVERY_STRIPE_KEY=<key> node scripts/stripe-setup.ts --env staging --hub-origin https://<staging hub>
//   AVERY_STRIPE_KEY=<key> node scripts/stripe-setup.ts --env production --hub-origin https://hub.averystudio.org
//   AVERY_STRIPE_KEY=<key> node scripts/stripe-setup.ts --env production --live --i-have-read-the-tax-gate --hub-origin https://hub.averystudio.org
//
// Key rules (checked before any network call):
//   staging                  test key only (rk_test_ / sk_test_), --live refused
//   production (no --live)   test key only: production's TEST-mode objects (S1 to S4)
//   production --live        live key only (rk_live_ / sk_live_) AND --i-have-read-the-tax-gate
// The key is read ONLY from the environment variable AVERY_STRIPE_KEY.
//
// The Stripe account is Ownly Network LLC's, shared with Agent Company. The
// script only ever touches objects it can prove are Avery's (metadata
// app=avery, the Avery lookup keys, or the exact hub webhook URL). It finds
// before it creates, so a second run creates nothing. It never prints the
// webhook signing secret: JJ reveals it in the Dashboard and sets it herself.
//
// Runs on plain Node 22 (type stripping). Imports of repo modules are dynamic
// (see main) because the repo's tsconfig does not allow `.ts` import paths.
import type { FormParams, StripeClient, StripeObject } from '../src/stripe/client';

// Node globals, declared locally because the project has no Node type package.
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

/** What to provision. Data, not logic: change here, re-run, read the readback. */
export const AVERY_STRIPE_SETUP = {
  app: 'avery',
  product: { name: 'Avery Classroom Games', statementDescriptor: 'AVERY STUDIO', tag: 'classroom_product' },
  prices: [
    { configKey: 'STRIPE_PRICE_YEARLY', lookupKey: 'avery_yearly_v1', unitAmount: 3900, currency: 'usd', interval: 'year' },
    { configKey: 'STRIPE_PRICE_MONTHLY', lookupKey: 'avery_monthly_v1', unitAmount: 699, currency: 'usd', interval: 'month' },
  ],
  portal: { name: 'Avery Classroom Games', tag: 'portal' },
  webhook: { path: '/stripe/webhook', description: 'Avery hub (app=avery)', tag: 'hub_webhook' },
  keyEnvVar: 'AVERY_STRIPE_KEY',
} as const;

export type SetupEnv = 'staging' | 'production';
export interface SetupArgs {
  env: SetupEnv;
  live: boolean;
  ackTaxGate: boolean;
  hubOrigin: string;
}

export class SetupRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupRefused';
  }
}

export function parseArgs(argv: string[]): SetupArgs {
  let env: string | undefined;
  let hubOrigin: string | undefined;
  let live = false;
  let ackTaxGate = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a === '--hub-origin') hubOrigin = argv[++i];
    else if (a === '--live') live = true;
    else if (a === '--i-have-read-the-tax-gate') ackTaxGate = true;
    else throw new SetupRefused(`unknown argument: ${a}`);
  }
  if (env !== 'staging' && env !== 'production') throw new SetupRefused('--env must be staging or production');
  if (!hubOrigin || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(hubOrigin)) {
    throw new SetupRefused('--hub-origin must be an https origin with no path, for example https://hub.averystudio.org');
  }
  return { env, live, ackTaxGate, hubOrigin };
}

/** Refuses the wrong key for the chosen path. Never echoes the key. */
export function checkKeyMode(args: SetupArgs, key: string | undefined): void {
  const envVar = AVERY_STRIPE_SETUP.keyEnvVar;
  if (!key) throw new SetupRefused(`${envVar} is not set`);
  const isTest = key.startsWith('rk_test_') || key.startsWith('sk_test_');
  const isLive = key.startsWith('rk_live_') || key.startsWith('sk_live_');
  if (args.live) {
    if (args.env !== 'production') throw new SetupRefused('--live is only allowed with --env production');
    if (!args.ackTaxGate) {
      throw new SetupRefused('--live needs --i-have-read-the-tax-gate (plan: "Tax gate before live mode"; JJ and her accountant sign off first)');
    }
    if (!isLive) throw new SetupRefused(`--live needs a live key (rk_live_ or sk_live_) in ${envVar}`);
    return;
  }
  if (!isTest) throw new SetupRefused(`--env ${args.env} without --live needs a test key (rk_test_ or sk_test_) in ${envVar}`);
}

/** Short stable hash so a changed request gets a new idempotency key. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const setupKey = (env: SetupEnv, live: boolean, object: string, action: string, params: FormParams) =>
  `setup:${env}:${live ? 'live' : 'test'}:${object}:${action}:${fnv1a(JSON.stringify(params))}`;

const meta = (o: StripeObject) => (o.metadata ?? {}) as Record<string, string>;

export const PORTAL_FEATURES = {
  customer_update: { enabled: false },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
  subscription_update: { enabled: false },
} as const;

export interface Readback {
  counts: { created: number; updated: number; unchanged: number };
  config: Record<string, string>;
  warnings: string[];
  lines: string[];
}

export async function runSetup(opts: {
  client: StripeClient;
  args: SetupArgs;
  apiVersion: string;
  webhookEvents: readonly string[];
  out?: (line: string) => void;
}): Promise<Readback> {
  const { client, args } = opts;
  const S = AVERY_STRIPE_SETUP;
  const out = opts.out ?? (() => {});
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const warnings: string[] = [];
  const key = (object: string, action: string, params: FormParams) => setupKey(args.env, args.live, object, action, params);

  // 1. Product, found by metadata.
  const products = (await client.listAll('/v1/products', { active: true })).filter(
    (p) => meta(p).app === S.app && meta(p).avery_object === S.product.tag,
  );
  if (products.length > 1) throw new SetupRefused(`found ${products.length} active Avery products; archive the extras in the Dashboard first`);
  const productParams: FormParams = { name: S.product.name, statement_descriptor: S.product.statementDescriptor };
  let product = products[0];
  if (!product) {
    const params = { ...productParams, metadata: { app: S.app, avery_object: S.product.tag } };
    product = await client.post('/v1/products', params, { idempotencyKey: key('product', 'create', params) });
    counts.created++;
  } else if (product.name !== S.product.name || product.statement_descriptor !== S.product.statementDescriptor) {
    product = await client.post(`/v1/products/${product.id}`, productParams, { idempotencyKey: key('product', `update-${product.id}`, productParams) });
    counts.updated++;
  } else counts.unchanged++;
  const productId = String(product.id);

  // 2. Prices, found by lookup key. Amounts are immutable: a mismatch is refused.
  const priceIds: Record<string, string> = {};
  const found = (await client.get('/v1/prices', { lookup_keys: S.prices.map((p) => p.lookupKey), active: true, limit: 10 })).data as StripeObject[];
  for (const want of S.prices) {
    const have = found.find((p) => p.lookup_key === want.lookupKey);
    if (have) {
      const rec = (have.recurring ?? {}) as { interval?: string };
      const prod = typeof have.product === 'string' ? have.product : String((have.product as StripeObject | null)?.id);
      if (have.unit_amount !== want.unitAmount || have.currency !== want.currency || rec.interval !== want.interval || prod !== productId) {
        throw new SetupRefused(
          `price ${want.lookupKey} exists but does not match (amount, currency, interval or product). Prices cannot change; add a new lookup key version instead.`,
        );
      }
      priceIds[want.configKey] = String(have.id);
      counts.unchanged++;
    } else {
      const params: FormParams = {
        product: productId,
        unit_amount: want.unitAmount,
        currency: want.currency,
        recurring: { interval: want.interval },
        lookup_key: want.lookupKey,
        metadata: { app: S.app },
      };
      const created = await client.post('/v1/prices', params, { idempotencyKey: key('price', `create-${want.lookupKey}`, params) });
      priceIds[want.configKey] = String(created.id);
      counts.created++;
    }
  }

  // 3. Portal configuration, found by metadata (the account's default portal is never touched).
  const portals = (await client.listAll('/v1/billing_portal/configurations', { active: true })).filter(
    (c) => meta(c).app === S.app && meta(c).avery_object === S.portal.tag,
  );
  if (portals.length > 1) throw new SetupRefused(`found ${portals.length} active Avery portal configurations; deactivate the extras first`);
  let portal = portals[0];
  if (!portal) {
    const params: FormParams = { name: S.portal.name, features: PORTAL_FEATURES, metadata: { app: S.app, avery_object: S.portal.tag } };
    portal = await client.post('/v1/billing_portal/configurations', params, { idempotencyKey: key('portal', 'create', params) });
    counts.created++;
  } else if (portalDrift(portal).length) {
    const params: FormParams = { features: PORTAL_FEATURES };
    portal = await client.post(`/v1/billing_portal/configurations/${portal.id}`, params, {
      idempotencyKey: key('portal', `update-${portal.id}`, params),
    });
    counts.updated++;
  } else counts.unchanged++;

  // 4. Webhook endpoint, found by exact URL. Only the listed events.
  const url = `${args.hubOrigin}${S.webhook.path}`;
  const wantEvents = [...opts.webhookEvents].sort();
  const endpoints = (await client.listAll('/v1/webhook_endpoints')).filter((w) => w.url === url);
  if (endpoints.length > 1) throw new SetupRefused(`found ${endpoints.length} webhook endpoints for ${url}; remove the extras first`);
  let endpoint = endpoints[0];
  if (!endpoint) {
    const params: FormParams = {
      url,
      enabled_events: wantEvents,
      api_version: opts.apiVersion,
      description: S.webhook.description,
      metadata: { app: S.app, avery_object: S.webhook.tag },
    };
    const created = await client.post('/v1/webhook_endpoints', params, { idempotencyKey: key('webhook', 'create', params) });
    // Drop the signing secret on the floor: it must never reach stdout or logs.
    const { secret: _secret, ...rest } = created;
    endpoint = rest;
    counts.created++;
    warnings.push('New webhook endpoint: reveal its signing secret in the Stripe Dashboard and set STRIPE_WEBHOOK_SECRET with wrangler (JJ step).');
  } else {
    if (meta(endpoint).app !== S.app) throw new SetupRefused(`a webhook endpoint for ${url} exists but is not tagged app=${S.app}; check it by hand`);
    const haveEvents = [...((endpoint.enabled_events ?? []) as string[])].sort();
    if (haveEvents.join(',') !== wantEvents.join(',')) {
      const params: FormParams = { enabled_events: wantEvents };
      endpoint = await client.post(`/v1/webhook_endpoints/${endpoint.id}`, params, {
        idempotencyKey: key('webhook', `update-${endpoint.id}`, params),
      });
      delete endpoint.secret;
      counts.updated++;
    } else counts.unchanged++;
  }

  // 5. Readback: fetch every object again and print what Stripe now holds.
  const rb = {
    product: await client.get(`/v1/products/${productId}`),
    prices: await Promise.all(Object.values(priceIds).map((id) => client.get(`/v1/prices/${id}`))),
    portal: await client.get(`/v1/billing_portal/configurations/${portal.id}`),
    webhook: await client.get(`/v1/webhook_endpoints/${endpoint.id}`),
  };
  delete rb.webhook.secret;

  if (rb.webhook.status !== 'enabled') warnings.push(`Webhook endpoint status is "${String(rb.webhook.status)}", not enabled. Left as is.`);
  if (rb.webhook.api_version !== opts.apiVersion) {
    warnings.push(`Webhook api_version is ${String(rb.webhook.api_version)}, code expects ${opts.apiVersion}. Stripe cannot change it in place; recreate the endpoint by hand.`);
  }
  for (const d of portalDrift(rb.portal)) warnings.push(`Portal readback differs: ${d}`);
  if (rb.product.statement_descriptor !== S.product.statementDescriptor) warnings.push('Product statement descriptor readback differs.');

  const rows: Array<[string, string]> = [
    ['mode', `${args.env} / ${args.live ? 'LIVE' : 'test'}`],
    ['product', `${String(rb.product.id)}  "${String(rb.product.name)}"  descriptor=${String(rb.product.statement_descriptor)}  app=${meta(rb.product).app ?? ''}`],
    ...rb.prices.map((p): [string, string] => {
      const rec = (p.recurring ?? {}) as { interval?: string };
      return [`price ${String(p.lookup_key)}`, `${String(p.id)}  ${(Number(p.unit_amount) / 100).toFixed(2)} ${String(p.currency).toUpperCase()} per ${String(rec.interval)}`];
    }),
    ['portal', `${String(rb.portal.id)}  ${describePortal(rb.portal)}`],
    ['webhook', `${String(rb.webhook.id)}  ${String(rb.webhook.url)}  status=${String(rb.webhook.status)}  api=${String(rb.webhook.api_version)}`],
    ['webhook events', ((rb.webhook.enabled_events ?? []) as string[]).join(', ')],
    ['result', `created ${counts.created}, updated ${counts.updated}, unchanged ${counts.unchanged}`],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${k.padEnd(width)} | ${v}`);
  const config: Record<string, string> = {
    STRIPE_PRODUCT_ID: productId,
    ...priceIds,
    STRIPE_PORTAL_CONFIG_ID: String(rb.portal.id),
  };
  lines.push('', 'Config values for wrangler.jsonc vars (not secrets):');
  for (const [k, v] of Object.entries(config)) lines.push(`  "${k}": "${v}"`);
  if (warnings.length) lines.push('', 'Warnings:', ...warnings.map((w) => `  - ${w}`));
  for (const l of lines) out(l);
  return { counts, config, warnings, lines };
}

function portalDrift(portal: StripeObject): string[] {
  const f = (portal.features ?? {}) as Record<string, Record<string, unknown>>;
  const drift: string[] = [];
  for (const [name, want] of Object.entries(PORTAL_FEATURES)) {
    for (const [k, v] of Object.entries(want)) {
      if (f[name]?.[k] !== v) drift.push(`${name}.${k} is ${String(f[name]?.[k])}, want ${String(v)}`);
    }
  }
  return drift;
}

function describePortal(portal: StripeObject): string {
  const f = (portal.features ?? {}) as Record<string, Record<string, unknown>>;
  const on = (n: string) => (f[n]?.enabled ? 'on' : 'off');
  return `cancel=${on('subscription_cancel')}(${String(f.subscription_cancel?.mode)})  card update=${on('payment_method_update')}  invoice history=${on('invoice_history')}  plan switch=${on('subscription_update')}  profile edit=${on('customer_update')}`;
}

// `import.meta.url` exists on Node ESM; the Workers type set does not declare it.
const HERE = (import.meta as unknown as { url?: string }).url ?? '';

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const secretKey = process.env[AVERY_STRIPE_SETUP.keyEnvVar];
    checkKeyMode(args, secretKey);
    const clientMod = (await import(new URL('../src/stripe/client.ts', HERE).href)) as typeof import('../src/stripe/client');
    const eventsMod = (await import(new URL('../src/stripe/events.ts', HERE).href)) as typeof import('../src/stripe/events');
    const client = clientMod.createStripeClient({ secretKey: secretKey! });
    await runSetup({ client, args, apiVersion: clientMod.STRIPE_API_VERSION, webhookEvents: eventsMod.HANDLED_EVENTS, out: (l) => console.log(l) });
  } catch (e) {
    console.error(e instanceof SetupRefused ? `Refused: ${e.message}` : `Failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

if (typeof process !== 'undefined' && process.argv[1] && HERE.endsWith('/scripts/stripe-setup.ts') && process.argv[1].endsWith('stripe-setup.ts')) {
  void main();
}
