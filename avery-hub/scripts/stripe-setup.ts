// Idempotent Stripe provisioning for the Avery hub (plan: "Stripe > Objects").
//
//   AVERY_STRIPE_KEY=<key> node scripts/stripe-setup.ts --env staging \
//       --hub-origin <staging HUB_ORIGIN> --inventory-receipt docs/ops/stripe-webhook-inventory.md
//   AVERY_STRIPE_KEY=<key> node scripts/stripe-setup.ts --env production \
//       --hub-origin https://hub.averystudio.org --inventory-receipt docs/ops/stripe-webhook-inventory.md
//   AVERY_STRIPE_KEY=<key> node scripts/stripe-setup.ts --env production --live \
//       --hub-origin https://hub.averystudio.org --inventory-receipt docs/ops/stripe-webhook-inventory.md \
//       --tax-gate-receipt docs/ops/tax-gate-receipt.md
//
// Guards, all checked BEFORE any write to Stripe:
//   key      staging and production-test: rk_test_ / sk_test_. --live: rk_live_ ONLY
//            (a restricted key; sk_live_ is refused). Read only from AVERY_STRIPE_KEY.
//   account  GET /v1/account must return STRIPE_ACCOUNT_ID from wrangler.jsonc (both modes).
//   origin   --hub-origin must equal HUB_ORIGIN for that environment in wrangler.jsonc.
//   tax      --live needs --tax-gate-receipt: a file under avery-hub/docs/ops/ with a line
//            `approved: YYYY-MM-DD` (a real date, not in the future), AND Stripe Tax
//            settings `status: active`.
//   webhook  creating the endpoint needs --inventory-receipt: the completed
//            docs/ops/stripe-webhook-inventory.md with `inventory_completed: YYYY-MM-DD`
//            and no `TODO` left.
//   objects  discovery includes archived / inactive objects; an archived Avery
//            price, product or portal is reported with a fix, never duplicated.
// After the writes, every object is read back; ANY mismatch exits non-zero.
//
// The Stripe account is Ownly Network LLC's, shared with Agent Company. The
// script only touches objects it can prove are Avery's (metadata app=avery, the
// Avery lookup keys, or the exact hub webhook URL). It never prints the webhook
// signing secret: JJ reveals it in the Dashboard and sets it herself.
//
// Runs on plain Node 22 (type stripping). Imports of repo modules and Node
// built-ins are dynamic (see main) because the repo's tsconfig does not allow
// `.ts` import paths and has no Node type package.
import type { FormParams, StripeClient, StripeObject } from '../src/stripe/client';

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  cwd(): string;
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
  inventoryFile: 'stripe-webhook-inventory.md',
} as const;

export type SetupEnv = 'staging' | 'production';
export interface SetupArgs {
  env: SetupEnv;
  live: boolean;
  hubOrigin: string;
  taxGateReceipt?: string;
  inventoryReceipt?: string;
}

/** Values the script checks against, read from wrangler.jsonc for the chosen env. */
export interface ExpectedTarget {
  hubOrigin: string;
  accountId: string;
}

/** Results of the file checks main() does before calling runSetup. */
export interface Gates {
  inventory: { ok: boolean; reason: string };
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
  let taxGateReceipt: string | undefined;
  let inventoryReceipt: string | undefined;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a === '--hub-origin') hubOrigin = argv[++i];
    else if (a === '--tax-gate-receipt') taxGateReceipt = argv[++i];
    else if (a === '--inventory-receipt') inventoryReceipt = argv[++i];
    else if (a === '--live') live = true;
    else throw new SetupRefused(`unknown argument: ${a}`);
  }
  if (env !== 'staging' && env !== 'production') throw new SetupRefused('--env must be staging or production');
  if (!hubOrigin || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(hubOrigin)) {
    throw new SetupRefused('--hub-origin must be an https origin with no path, for example https://hub.averystudio.org');
  }
  return { env, live, hubOrigin, ...(taxGateReceipt ? { taxGateReceipt } : {}), ...(inventoryReceipt ? { inventoryReceipt } : {}) };
}

/** The key is read from this one variable and nowhere else. */
export const keyFromEnv = (env: Record<string, string | undefined>): string | undefined => env[AVERY_STRIPE_SETUP.keyEnvVar];

/** Refuses the wrong key for the chosen path. Never echoes the key. */
export function checkKeyMode(args: SetupArgs, key: string | undefined): void {
  const envVar = AVERY_STRIPE_SETUP.keyEnvVar;
  if (!key) throw new SetupRefused(`${envVar} is not set`);
  if (args.live) {
    if (args.env !== 'production') throw new SetupRefused('--live is only allowed with --env production');
    if (!args.taxGateReceipt) throw new SetupRefused('--live needs --tax-gate-receipt <file under docs/ops/> (plan: "Tax gate before live mode")');
    if (!key.startsWith('rk_live_')) throw new SetupRefused(`--live needs a restricted live key (rk_live_) in ${envVar}; secret keys (sk_live_) are refused`);
    return;
  }
  if (!key.startsWith('rk_test_') && !key.startsWith('sk_test_')) {
    throw new SetupRefused(`--env ${args.env} without --live needs a test key (rk_test_ or sk_test_) in ${envVar}`);
  }
}

// ---------- config and receipt checks (pure, tested) ----------

/** Strips // and /* comments and trailing commas outside strings, so JSON.parse can read JSONC. */
export function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] !== '}' && text[j] !== ']') out += c;
    } else out += c;
  }
  return out;
}

/** HUB_ORIGIN and STRIPE_ACCOUNT_ID for one environment of wrangler.jsonc. */
export function readWranglerTarget(jsoncText: string, env: SetupEnv): ExpectedTarget {
  const cfg = JSON.parse(stripJsonc(jsoncText)) as { vars?: Record<string, unknown>; env?: Record<string, { vars?: Record<string, unknown> }> };
  const vars = env === 'production' ? cfg.vars : cfg.env?.[env]?.vars;
  const hubOrigin = vars?.HUB_ORIGIN;
  const accountId = vars?.STRIPE_ACCOUNT_ID;
  if (typeof hubOrigin !== 'string' || !hubOrigin) throw new SetupRefused(`wrangler.jsonc has no HUB_ORIGIN for ${env}`);
  if (typeof accountId !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new SetupRefused(`wrangler.jsonc has no valid STRIPE_ACCOUNT_ID for ${env} (the Ownly Network LLC account id, acct_...)`);
  }
  return { hubOrigin, accountId };
}

/** True when `absPath` (already resolved, symlinks followed) sits inside `opsDir`. */
export function isUnderOpsDir(absPath: string, opsDir: string): boolean {
  const dir = opsDir.endsWith('/') ? opsDir : `${opsDir}/`;
  return absPath.startsWith(dir) && !absPath.slice(dir.length).includes('..');
}

function datedLine(text: string, label: string, today: string): { ok: boolean; reason: string } {
  const m = text.match(new RegExp(`^${label}:\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$`, 'm'));
  if (!m) return { ok: false, reason: `no line "${label}: YYYY-MM-DD"` };
  const d = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1]) return { ok: false, reason: `"${m[1]}" is not a real date` };
  if (m[1]! > today) return { ok: false, reason: `"${m[1]}" is in the future` };
  return { ok: true, reason: `${label} ${m[1]}` };
}

export function checkTaxReceipt(text: string, today: string): { ok: boolean; reason: string } {
  return datedLine(text, 'approved', today);
}

export function checkInventoryReceipt(text: string, today: string): { ok: boolean; reason: string } {
  const dated = datedLine(text, 'inventory_completed', today);
  if (!dated.ok) return dated;
  if (/TODO/.test(text)) return { ok: false, reason: 'the inventory still contains TODO' };
  return dated;
}

// ---------- provisioning ----------

/** Short stable hash so a changed request or state gets a new idempotency key. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const meta = (o: StripeObject) => (o.metadata ?? {}) as Record<string, string>;
const productIdOf = (p: StripeObject) => (typeof p.product === 'string' ? p.product : String((p.product as StripeObject | null)?.id));

export const PORTAL_FEATURES = {
  customer_update: { enabled: false },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
  subscription_update: { enabled: false },
} as const;

/** Stripe statement descriptor rules (5 to 22 chars, none of < > \ ' " *). */
export function descriptorProblem(d: string): string | null {
  if (d.length < 5 || d.length > 22) return 'statement descriptor must be 5 to 22 characters';
  if (/[<>\\'"*]/.test(d)) return 'statement descriptor contains a character Stripe refuses';
  return null;
}

export interface Readback {
  counts: { created: number; updated: number; unchanged: number };
  config: Record<string, string>;
  warnings: string[];
  lines: string[];
}

export async function runSetup(opts: {
  client: StripeClient;
  args: SetupArgs;
  expected: ExpectedTarget;
  gates: Gates;
  apiVersion: string;
  webhookEvents: readonly string[];
  out?: (line: string) => void;
}): Promise<Readback> {
  const { client, args, expected } = opts;
  const S = AVERY_STRIPE_SETUP;
  const out = opts.out ?? (() => {});
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const warnings: string[] = [];
  const mode = args.live ? 'live' : 'test';
  const createKey = (object: string, params: FormParams) => `setup:${args.env}:${mode}:${object}:create:${fnv1a(JSON.stringify(params))}`;
  // Update keys hash the OBSERVED state plus the change: a new drift gets a new
  // key, while a retry of the same repair (same observed state) reuses it.
  const updateKey = (object: string, id: string, observed: unknown, change: FormParams) =>
    `setup:${args.env}:${mode}:${object}:update-${id}:${fnv1a(JSON.stringify({ observed, change }))}`;

  // ---- Phase 1: read-only checks. Every refusal happens here, before any write. ----
  if (args.hubOrigin !== expected.hubOrigin) {
    throw new SetupRefused(`--hub-origin ${args.hubOrigin} is not the configured HUB_ORIGIN for ${args.env} (${expected.hubOrigin})`);
  }
  const descProblem = descriptorProblem(S.product.statementDescriptor);
  if (descProblem) throw new SetupRefused(descProblem);

  const account = await client.get('/v1/account');
  if (account.id !== expected.accountId) {
    throw new SetupRefused(`this key belongs to Stripe account ${String(account.id)}, not the configured STRIPE_ACCOUNT_ID ${expected.accountId}`);
  }
  if (args.live) {
    const tax = await client.get('/v1/tax/settings');
    if (tax.status !== 'active') throw new SetupRefused(`Stripe Tax settings status is "${String(tax.status)}", not active. Finish the tax gate first.`);
  }
  const wrongMode = (o: StripeObject, what: string) => {
    if (typeof o.livemode === 'boolean' && o.livemode !== args.live) throw new SetupRefused(`${what} ${String(o.id)} is ${o.livemode ? 'live' : 'test'} mode, run is ${mode}`);
  };

  // Product (all, archived included).
  const avProducts = (await client.listAll('/v1/products')).filter((p) => meta(p).app === S.app && meta(p).avery_object === S.product.tag);
  const activeProducts = avProducts.filter((p) => p.active !== false);
  if (activeProducts.length > 1) throw new SetupRefused(`found ${activeProducts.length} active Avery products; archive the extras in the Dashboard first`);
  if (activeProducts.length === 0 && avProducts.length > 0) {
    throw new SetupRefused(`the Avery product ${String(avProducts[0]!.id)} is archived. Fix: unarchive it in the Stripe Dashboard, then re-run.`);
  }
  const existingProduct = activeProducts[0];
  if (existingProduct) wrongMode(existingProduct, 'product');

  // Prices (active and inactive, by lookup key).
  const allPrices = (await client.get('/v1/prices', { lookup_keys: S.prices.map((p) => p.lookupKey), limit: 100 })).data as StripeObject[];
  const foundPrices = new Map<string, StripeObject>();
  for (const want of S.prices) {
    const matches = allPrices.filter((p) => p.lookup_key === want.lookupKey);
    if (matches.length > 1) throw new SetupRefused(`${matches.length} prices share lookup key ${want.lookupKey}; archive the extras and clear their lookup keys`);
    const have = matches[0];
    if (!have) continue;
    if (have.active === false) {
      throw new SetupRefused(`price ${want.lookupKey} (${String(have.id)}) is archived. Fix: reactivate it in the Stripe Dashboard if it is right, or remove its lookup key, then re-run.`);
    }
    wrongMode(have, 'price');
    const rec = (have.recurring ?? {}) as { interval?: string; interval_count?: number };
    const problems: string[] = [];
    if (have.unit_amount !== want.unitAmount) problems.push(`amount ${String(have.unit_amount)} not ${want.unitAmount}`);
    if (have.currency !== want.currency) problems.push(`currency ${String(have.currency)} not ${want.currency}`);
    if (rec.interval !== want.interval) problems.push(`interval ${String(rec.interval)} not ${want.interval}`);
    if (rec.interval_count !== 1) problems.push(`interval_count ${String(rec.interval_count)} not 1`);
    if (!existingProduct || productIdOf(have) !== String(existingProduct.id)) problems.push('belongs to a different product');
    if (problems.length) {
      throw new SetupRefused(
        `price ${want.lookupKey} (${String(have.id)}) does not match: ${problems.join(', ')}. Prices cannot change. Fix: archive it and bump the lookup key version (for example _v2) in AVERY_STRIPE_SETUP.`,
      );
    }
    foundPrices.set(want.lookupKey, have);
  }

  // Portal configuration (inactive included). The account's default portal is never touched.
  const avPortals = (await client.listAll('/v1/billing_portal/configurations')).filter((c) => meta(c).app === S.app && meta(c).avery_object === S.portal.tag);
  const activePortals = avPortals.filter((c) => c.active !== false);
  if (activePortals.length > 1) throw new SetupRefused(`found ${activePortals.length} active Avery portal configurations; deactivate the extras first`);
  if (activePortals.length === 0 && avPortals.length > 0) {
    throw new SetupRefused(`the Avery portal configuration ${String(avPortals[0]!.id)} is inactive. Fix: reactivate it in the Stripe Dashboard, then re-run.`);
  }
  const existingPortal = activePortals[0];
  if (existingPortal) wrongMode(existingPortal, 'portal configuration');

  // Webhook endpoint (exact URL).
  const url = `${args.hubOrigin}${S.webhook.path}`;
  const wantEvents = [...opts.webhookEvents].sort();
  const endpoints = (await client.listAll('/v1/webhook_endpoints')).filter((w) => w.url === url);
  if (endpoints.length > 1) throw new SetupRefused(`found ${endpoints.length} webhook endpoints for ${url}; remove the extras first`);
  const existingHook = endpoints[0];
  if (existingHook) {
    if (meta(existingHook).app !== S.app) throw new SetupRefused(`a webhook endpoint for ${url} exists but is not tagged app=${S.app}; check it by hand`);
    wrongMode(existingHook, 'webhook endpoint');
    if (existingHook.api_version !== opts.apiVersion) {
      throw new SetupRefused(
        `webhook ${String(existingHook.id)} sends API version ${String(existingHook.api_version)}, code expects ${opts.apiVersion}. Stripe cannot change it in place. Fix (JJ approves): delete the endpoint, re-run, set the new signing secret.`,
      );
    }
  } else if (!opts.gates.inventory.ok) {
    throw new SetupRefused(
      `creating the webhook endpoint needs a completed inventory receipt (--inventory-receipt docs/ops/${S.inventoryFile}): ${opts.gates.inventory.reason}`,
    );
  }

  // ---- Phase 2: writes. ----
  let product: StripeObject;
  const productParams: FormParams = { name: S.product.name, statement_descriptor: S.product.statementDescriptor };
  if (!existingProduct) {
    const params = { ...productParams, metadata: { app: S.app, avery_object: S.product.tag } };
    product = await client.post('/v1/products', params, { idempotencyKey: createKey('product', params) });
    counts.created++;
  } else if (existingProduct.name !== S.product.name || existingProduct.statement_descriptor !== S.product.statementDescriptor) {
    const observed = { name: existingProduct.name, statement_descriptor: existingProduct.statement_descriptor, updated: existingProduct.updated };
    product = await client.post(`/v1/products/${String(existingProduct.id)}`, productParams, {
      idempotencyKey: updateKey('product', String(existingProduct.id), observed, productParams),
    });
    counts.updated++;
  } else {
    product = existingProduct;
    counts.unchanged++;
  }
  const productId = String(product.id);

  const priceIds: Record<string, string> = {};
  for (const want of S.prices) {
    const have = foundPrices.get(want.lookupKey);
    if (have) {
      priceIds[want.configKey] = String(have.id);
      counts.unchanged++;
      continue;
    }
    const params: FormParams = {
      product: productId,
      unit_amount: want.unitAmount,
      currency: want.currency,
      recurring: { interval: want.interval, interval_count: 1 },
      lookup_key: want.lookupKey,
      metadata: { app: S.app },
    };
    const created = await client.post('/v1/prices', params, { idempotencyKey: createKey(`price-${want.lookupKey}`, params) });
    priceIds[want.configKey] = String(created.id);
    counts.created++;
  }

  let portalId: string;
  if (!existingPortal) {
    const params: FormParams = { name: S.portal.name, features: PORTAL_FEATURES, metadata: { app: S.app, avery_object: S.portal.tag } };
    portalId = String((await client.post('/v1/billing_portal/configurations', params, { idempotencyKey: createKey('portal', params) })).id);
    counts.created++;
  } else if (portalDrift(existingPortal).length) {
    portalId = String(existingPortal.id);
    const params: FormParams = { features: PORTAL_FEATURES };
    await client.post(`/v1/billing_portal/configurations/${portalId}`, params, {
      idempotencyKey: updateKey('portal', portalId, { features: existingPortal.features, updated: existingPortal.updated }, params),
    });
    counts.updated++;
  } else {
    portalId = String(existingPortal.id);
    counts.unchanged++;
  }

  let hookId: string;
  if (!existingHook) {
    const params: FormParams = {
      url,
      enabled_events: wantEvents,
      api_version: opts.apiVersion,
      description: S.webhook.description,
      metadata: { app: S.app, avery_object: S.webhook.tag },
    };
    // Keep only the id: the create response carries the signing secret, which must never reach stdout or logs.
    hookId = String((await client.post('/v1/webhook_endpoints', params, { idempotencyKey: createKey('webhook', params) })).id);
    counts.created++;
    warnings.push('New webhook endpoint: reveal its signing secret in the Stripe Dashboard and set STRIPE_WEBHOOK_SECRET with wrangler (JJ step).');
  } else {
    hookId = String(existingHook.id);
    const haveEvents = [...((existingHook.enabled_events ?? []) as string[])].sort();
    const change: FormParams = {};
    if (haveEvents.join(',') !== wantEvents.join(',')) change.enabled_events = wantEvents;
    if (existingHook.status !== 'enabled') change.disabled = false;
    if (Object.keys(change).length) {
      await client.post(`/v1/webhook_endpoints/${hookId}`, change, {
        idempotencyKey: updateKey('webhook', hookId, { enabled_events: haveEvents, status: existingHook.status }, change),
      });
      counts.updated++;
    } else counts.unchanged++;
  }

  // ---- Phase 3: readback. Every object fetched again; any mismatch is fatal. ----
  const rb = {
    product: await client.get(`/v1/products/${productId}`),
    prices: await Promise.all(S.prices.map((p) => client.get(`/v1/prices/${priceIds[p.configKey]!}`))),
    portal: await client.get(`/v1/billing_portal/configurations/${portalId}`),
    webhook: await client.get(`/v1/webhook_endpoints/${hookId}`),
  };
  delete rb.webhook.secret;

  const mismatches: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) mismatches.push(what);
  };
  check(rb.product.name === S.product.name, 'product name');
  check(rb.product.statement_descriptor === S.product.statementDescriptor, 'product statement descriptor');
  check(meta(rb.product).app === S.app, 'product metadata app');
  check(rb.product.livemode === args.live, 'product livemode');
  S.prices.forEach((want, i) => {
    const p = rb.prices[i]!;
    const rec = (p.recurring ?? {}) as { interval?: string; interval_count?: number };
    check(
      p.lookup_key === want.lookupKey && p.unit_amount === want.unitAmount && p.currency === want.currency &&
        rec.interval === want.interval && rec.interval_count === 1 && p.active === true && p.livemode === args.live && productIdOf(p) === productId,
      `price ${want.lookupKey}`,
    );
  });
  for (const d of portalDrift(rb.portal)) mismatches.push(`portal ${d}`);
  check(rb.portal.active === true, 'portal active');
  check(rb.webhook.url === url, 'webhook url');
  check(rb.webhook.status === 'enabled', 'webhook status enabled');
  check(rb.webhook.api_version === opts.apiVersion, 'webhook api_version');
  check([...((rb.webhook.enabled_events ?? []) as string[])].sort().join(',') === wantEvents.join(','), 'webhook events');

  const rows: Array<[string, string]> = [
    ['mode', `${args.env} / ${args.live ? 'LIVE' : 'test'} / account ${String(account.id)}`],
    ['product', `${String(rb.product.id)}  "${String(rb.product.name)}"  descriptor=${String(rb.product.statement_descriptor)}  app=${meta(rb.product).app ?? ''}`],
    ...rb.prices.map((p): [string, string] => {
      const rec = (p.recurring ?? {}) as { interval?: string; interval_count?: number };
      return [`price ${String(p.lookup_key)}`, `${String(p.id)}  ${(Number(p.unit_amount) / 100).toFixed(2)} ${String(p.currency).toUpperCase()} per ${String(rec.interval)} (count ${String(rec.interval_count)})`];
    }),
    ['portal', `${String(rb.portal.id)}  ${describePortal(rb.portal)}`],
    ['webhook', `${String(rb.webhook.id)}  ${String(rb.webhook.url)}  status=${String(rb.webhook.status)}  api=${String(rb.webhook.api_version)}`],
    ['webhook events', ((rb.webhook.enabled_events ?? []) as string[]).join(', ')],
    ['result', `created ${counts.created}, updated ${counts.updated}, unchanged ${counts.unchanged}`],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${k.padEnd(width)} | ${v}`);
  const config: Record<string, string> = { STRIPE_PRODUCT_ID: productId, ...priceIds, STRIPE_PORTAL_CONFIG_ID: portalId };
  lines.push('', 'Config values for wrangler.jsonc vars (not secrets):');
  for (const [k, v] of Object.entries(config)) lines.push(`  "${k}": "${v}"`);
  if (warnings.length) lines.push('', 'Warnings:', ...warnings.map((w) => `  - ${w}`));
  if (mismatches.length) lines.push('', 'READBACK MISMATCH:', ...mismatches.map((m) => `  - ${m}`));
  for (const l of lines) out(l);
  if (mismatches.length) throw new SetupRefused(`readback does not match the plan: ${mismatches.join('; ')}`);
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

interface NodeFs {
  readFileSync(p: string, enc: 'utf8'): string;
  realpathSync(p: string): string;
  existsSync(p: string): boolean;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const secretKey = keyFromEnv(process.env);
    checkKeyMode(args, secretKey);

    const nodeBuiltin = (name: string): Promise<unknown> => import(`node:${name}`);
    const fs = (await nodeBuiltin('fs')) as NodeFs;
    const path = (await nodeBuiltin('path')) as { resolve(...p: string[]): string };
    const { fileURLToPath } = (await nodeBuiltin('url')) as { fileURLToPath(u: string): string };
    const hubDir = fileURLToPath(new URL('..', HERE).href);
    const opsDir = fs.realpathSync(path.resolve(hubDir, 'docs/ops'));
    const today = new Date().toISOString().slice(0, 10);

    const readReceipt = (p: string, label: string): { real: string; text: string } => {
      const abs = path.resolve(process.cwd(), p);
      if (!fs.existsSync(abs)) throw new SetupRefused(`${label} ${p} does not exist`);
      const real = fs.realpathSync(abs);
      if (!isUnderOpsDir(real, opsDir)) throw new SetupRefused(`${label} must be a file under avery-hub/docs/ops/`);
      return { real, text: fs.readFileSync(real, 'utf8') };
    };

    if (args.live) {
      const tax = checkTaxReceipt(readReceipt(args.taxGateReceipt!, '--tax-gate-receipt').text, today);
      if (!tax.ok) throw new SetupRefused(`tax gate receipt: ${tax.reason}`);
    }
    let inventory = { ok: false, reason: '--inventory-receipt not given' };
    if (args.inventoryReceipt) {
      const r = readReceipt(args.inventoryReceipt, '--inventory-receipt');
      inventory = r.real.endsWith(`/${AVERY_STRIPE_SETUP.inventoryFile}`)
        ? checkInventoryReceipt(r.text, today)
        : { ok: false, reason: `the receipt must be docs/ops/${AVERY_STRIPE_SETUP.inventoryFile}` };
    }

    const expected = readWranglerTarget(fs.readFileSync(path.resolve(hubDir, 'wrangler.jsonc'), 'utf8'), args.env);
    const clientMod = (await import(new URL('../src/stripe/client.ts', HERE).href)) as typeof import('../src/stripe/client');
    const eventsMod = (await import(new URL('../src/stripe/events.ts', HERE).href)) as typeof import('../src/stripe/events');
    const client = clientMod.createStripeClient({ secretKey: secretKey!, ...clientMod.clientConfigFromEnv(process.env) });
    await runSetup({
      client,
      args,
      expected,
      gates: { inventory },
      apiVersion: clientMod.STRIPE_API_VERSION,
      webhookEvents: eventsMod.HANDLED_EVENTS,
      out: (l) => console.log(l),
    });
  } catch (e) {
    console.error(e instanceof SetupRefused ? `Refused: ${e.message}` : `Failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

if (typeof process !== 'undefined' && process.argv[1] && HERE.endsWith('/scripts/stripe-setup.ts') && process.argv[1].endsWith('stripe-setup.ts')) {
  void main();
}
