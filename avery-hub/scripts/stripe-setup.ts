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
//   tax      --live needs --tax-gate-receipt: a file under avery-hub/docs/ops/ with every
//            field filled (approved date, approved_by, home_state, taxable, product_tax_code,
//            registrations), Stripe Tax settings `status: active`, and when taxable,
//            at least one active Stripe Tax registration.
//   webhook  ANY write to the webhook endpoint (create, events, re-enable) needs
//            --inventory-receipt: docs/ops/stripe-webhook-inventory.md with the fields for
//            THIS mode (test_mode_* or live_mode_*): a real date, the verified account id,
//            and the sha256 digest of the current non-Avery endpoints (ids, urls, statuses,
//            events; the script prints it), plus reviewed table rows for that mode with no
//            TODO. A test receipt never authorises live.
//   objects  discovery lists active AND inactive objects (Stripe lists only active prices
//            by default); archived Avery objects are reported with a fix, never duplicated.
//            Legacy app=avery objects without the avery_object tag are matched on exact
//            attributes, refused when ambiguous, and tagged on a confirmed match.
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
export interface ReviewedRow {
  id: string;
  url: string;
  status: string;
  /** Sorted event names as written in the row. */
  events: string[];
}

export interface InventoryGate {
  ok: boolean;
  reason: string;
  accountId?: string;
  /** sha256 hex of the reviewed non-Avery endpoints (see inventoryDigest). */
  digest?: string;
  /** Complete review rows for this mode; compared field by field with the live endpoints. */
  reviewedRows?: ReviewedRow[];
}
export interface Gates {
  inventory: InventoryGate;
  /** Live runs only: what the tax receipt says about taxability. */
  tax?: { taxable: boolean };
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
    const block = env === 'production' ? 'the top-level "vars" block' : `the "env" > "${env}" > "vars" block`;
    throw new SetupRefused(
      `wrangler.jsonc has no valid STRIPE_ACCOUNT_ID for ${env}. The owner reads it in the Stripe Dashboard: ` +
        `Settings, Business, Account details (the id that starts with acct_). Add the line ` +
        `"STRIPE_ACCOUNT_ID": "acct_..." to ${block} of avery-hub/wrangler.jsonc, next to HUB_ORIGIN.`,
    );
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

/** The value of a `name: value` line, or null when missing, blank or TODO. */
function field(text: string, name: string): string | null {
  const m = text.match(new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, 'm'));
  const v = m?.[1] ?? '';
  return v === '' || /TODO|YYYY/.test(v) ? null : v;
}

/** Every field of docs/ops/tax-gate-receipt.template.md must be filled. */
export function checkTaxReceipt(text: string, today: string): { ok: boolean; reason: string; taxable?: boolean } {
  const dated = datedLine(text, 'approved', today);
  if (!dated.ok) return dated;
  for (const name of ['approved_by', 'home_state', 'taxable', 'product_tax_code', 'registrations']) {
    if (field(text, name) === null) return { ok: false, reason: `field "${name}" is blank` };
  }
  const taxable = field(text, 'taxable')!.toLowerCase();
  if (taxable !== 'yes' && taxable !== 'no') return { ok: false, reason: 'field "taxable" must be yes or no' };
  if (!/^txcd_\d+$/.test(field(text, 'product_tax_code')!)) return { ok: false, reason: 'field "product_tax_code" must be a Stripe tax code (txcd_...)' };
  if (taxable === 'yes' && field(text, 'registrations')!.toLowerCase() === 'none') {
    return { ok: false, reason: 'taxable is yes but registrations is none' };
  }
  return { ok: true, reason: dated.reason, taxable: taxable === 'yes' };
}

/** Per-mode fields and review rows of docs/ops/stripe-webhook-inventory.md. */
export function checkInventoryReceipt(text: string, mode: 'test' | 'live', today: string): InventoryGate {
  const prefix = `${mode}_mode`;
  const dated = datedLine(text, `${prefix}_completed`, today);
  if (!dated.ok) return dated;
  const accountId = field(text, `${prefix}_account_id`);
  if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) return { ok: false, reason: `field "${prefix}_account_id" must be the acct_ id` };
  const digest = field(text, `${prefix}_endpoints_digest`);
  if (!digest || !/^[0-9a-f]{64}$/.test(digest)) return { ok: false, reason: `field "${prefix}_endpoints_digest" must be the 64-hex digest the script prints` };
  const rows = text.split('\n').filter((l) => new RegExp(`^\\|\\s*${mode}\\s*\\|`).test(l));
  if (rows.length === 0) return { ok: false, reason: `no reviewed "| ${mode} |" rows in the result table` };
  const reviewedRows: ReviewedRow[] = [];
  for (const row of rows) {
    const problem = reviewRowProblem(row);
    if (problem) return { ok: false, reason: `review row "${row.trim()}": ${problem}` };
    const cells = rowCells(row);
    reviewedRows.push({ id: cells[1]!, url: cells[2]!, status: cells[3]!, events: splitEvents(cells[4]!) });
  }
  return { ok: true, reason: dated.reason, accountId, digest, reviewedRows };
}

/** Allowed values for the "Ignores Avery?" column of a reviewed row. */
export const REVIEW_VERDICTS = ['ignores avery', 'avery endpoint'] as const;

/**
 * One row of the result table: | Mode | Endpoint id | URL | Status | Events |
 * Owner | Touches charge / subscription events? | Ignores Avery? | Action |.
 * Every cell filled, no unknowns, touches = yes/no, verdict one of REVIEW_VERDICTS.
 * An account with no other endpoints writes one row with `none` in every
 * column except mode, touches (`no`) and verdict (`ignores avery`). A `-` is
 * never a value. URL, status and events are later compared with the live endpoint.
 */
const rowCells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
/** Events cell: names separated by commas or spaces (`*` for all). */
const splitEvents = (cell: string) => cell.split(/[\s,]+/).filter(Boolean).sort();

export function reviewRowProblem(row: string): string | null {
  const cells = rowCells(row);
  if (cells.length !== 9) return `needs 9 columns, has ${cells.length}`;
  const bad = cells.findIndex((c) => c === '' || /^(todo|unknown|\?|tbd|n\/a|-+)$/i.test(c) || /TODO/.test(c));
  if (bad >= 0) return `column ${bad + 1} is blank or unknown`;
  const [, id, , , , , touches, verdict] = cells;
  if (id !== 'none' && !/^we_[A-Za-z0-9]+$/.test(id!)) return 'endpoint id must be we_... or none';
  if (!/^(yes|no)$/i.test(touches!)) return 'the "touches charge / subscription events" column must be yes or no';
  if (!(REVIEW_VERDICTS as readonly string[]).includes(verdict!.toLowerCase())) {
    return `the "Ignores Avery?" column must be "${REVIEW_VERDICTS.join('" or "')}"`;
  }
  return null;
}

/** sha256 over the sorted non-Avery endpoints: id, url, status, sorted events. */
export async function inventoryDigest(endpoints: readonly StripeObject[]): Promise<string> {
  const rows = endpoints
    .map((w) => [String(w.id), String(w.url), String(w.status), [...((w.enabled_events ?? []) as string[])].sort()])
    .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** File system calls main() needs; injected so the receipt wiring is testable. */
export interface ReceiptFs {
  existsSync(p: string): boolean;
  realpathSync(p: string): string;
  readFileSync(p: string, enc: 'utf8'): string;
  resolve(...p: string[]): string;
}

/** Reads and checks the receipts named on the command line (the part of main() that touches files). */
export function loadGates(fsx: ReceiptFs, args: SetupArgs, opts: { cwd: string; opsDir: string; today: string }): Gates {
  const read = (p: string, label: string) => {
    const abs = fsx.resolve(opts.cwd, p);
    if (!fsx.existsSync(abs)) throw new SetupRefused(`${label} ${p} does not exist`);
    const real = fsx.realpathSync(abs);
    if (!isUnderOpsDir(real, opts.opsDir)) throw new SetupRefused(`${label} must be a file under avery-hub/docs/ops/`);
    return { real, text: fsx.readFileSync(real, 'utf8') };
  };
  const gates: Gates = { inventory: { ok: false, reason: '--inventory-receipt not given' } };
  if (args.live) {
    const tax = checkTaxReceipt(read(args.taxGateReceipt!, '--tax-gate-receipt').text, opts.today);
    if (!tax.ok) throw new SetupRefused(`tax gate receipt: ${tax.reason}`);
    gates.tax = { taxable: tax.taxable! };
  }
  if (args.inventoryReceipt) {
    const r = read(args.inventoryReceipt, '--inventory-receipt');
    // The exact canonical file, not any file with that name (an archive copy must not count).
    const canonical = `${opts.opsDir.replace(/\/+$/, '')}/${AVERY_STRIPE_SETUP.inventoryFile}`;
    gates.inventory = r.real === canonical
      ? checkInventoryReceipt(r.text, args.live ? 'live' : 'test', opts.today)
      : { ok: false, reason: `the receipt must be docs/ops/${AVERY_STRIPE_SETUP.inventoryFile}` };
  }
  return gates;
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
  /** One id per run (default random). Mixed into update keys: see below. */
  runId?: string;
}): Promise<Readback> {
  const { client, args, expected } = opts;
  const S = AVERY_STRIPE_SETUP;
  const out = opts.out ?? (() => {});
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const warnings: string[] = [];
  const mode = args.live ? 'live' : 'test';
  const runId = opts.runId ?? crypto.randomUUID();
  const createKey = (object: string, params: FormParams) => `setup:${args.env}:${mode}:${object}:create:${fnv1a(JSON.stringify(params))}`;
  // Update keys hash the OBSERVED state, the change AND this run's id. Inside a
  // run, the client's retries reuse the key (no double apply). A later run gets
  // a new key even when the same drift comes back within Stripe's ~24 h key
  // retention (a webhook endpoint has no `updated` field to tell two drifts
  // apart). Updates are convergent (they set the target values), so a new key
  // on a re-run is always safe.
  const updateKey = (object: string, id: string, observed: unknown, change: FormParams) =>
    `setup:${args.env}:${mode}:${object}:update-${id}:${fnv1a(JSON.stringify({ observed, change, runId }))}`;

  // ---- Phase 1: read-only checks. Every refusal happens here, before any write. ----
  if (args.hubOrigin !== expected.hubOrigin) {
    throw new SetupRefused(`--hub-origin ${args.hubOrigin} is not the configured HUB_ORIGIN for ${args.env} (${expected.hubOrigin})`);
  }
  const descProblem = descriptorProblem(S.product.statementDescriptor);
  if (descProblem) throw new SetupRefused(descProblem);

  // The Avery endpoint is excluded from the inventory digest ONLY by full
  // identity (this environment's hub URL AND the avery_object tag); any other
  // endpoint, even one carrying app=avery, is part of the reviewed snapshot.
  const url = `${args.hubOrigin}${S.webhook.path}`;
  const allHooks = await client.listAll('/v1/webhook_endpoints');
  const isOurHook = (w: StripeObject) => w.url === url && meta(w).app === S.app && meta(w).avery_object === S.webhook.tag;
  const currentDigest = await inventoryDigest(allHooks.filter((w) => !isOurHook(w)));
  const digestHint = ` Current ${mode}_mode_endpoints_digest after review: ${currentDigest}`;

  const account = await client.get('/v1/account');
  if (account.id !== expected.accountId) {
    throw new SetupRefused(`this key belongs to Stripe account ${String(account.id)}, not the configured STRIPE_ACCOUNT_ID ${expected.accountId}.${digestHint}`);
  }
  if (args.live) {
    const tax = await client.get('/v1/tax/settings');
    if (tax.status !== 'active') throw new SetupRefused(`Stripe Tax settings status is "${String(tax.status)}", not active. Finish the tax gate first.`);
    if (!opts.gates.tax) throw new SetupRefused('live run without a checked tax gate receipt');
    if (opts.gates.tax.taxable) {
      const regs = (await client.get('/v1/tax/registrations', { status: 'active', limit: 100 })).data as StripeObject[];
      if (!regs.length) throw new SetupRefused('the tax receipt says taxable, but Stripe Tax has no active registration. Add it in Stripe Tax first.');
    }
  }
  const wrongMode = (o: StripeObject, what: string) => {
    if (typeof o.livemode === 'boolean' && o.livemode !== args.live) throw new SetupRefused(`${what} ${String(o.id)} is ${o.livemode ? 'live' : 'test'} mode, run is ${mode}`);
  };
  /** Stripe lists only active objects for some types by default: ask for both, explicitly. */
  const listBoth = async (path: string, query: FormParams = {}) => {
    const seen = new Map<string, StripeObject>();
    for (const active of [true, false]) {
      for (const o of await client.listAll(path, { ...query, active })) seen.set(String(o.id), o);
    }
    return [...seen.values()];
  };
  const tagged = (o: StripeObject, tag: string) => meta(o).app === S.app && meta(o).avery_object === tag;
  const legacy = (o: StripeObject) => meta(o).app === S.app && meta(o).avery_object === undefined;

  // Prices first (active and inactive, by lookup key): they also identify the product.
  const allPrices = await listBoth('/v1/prices', { lookup_keys: S.prices.map((p) => p.lookupKey) });
  const pricesByKey = new Map<string, StripeObject>();
  for (const want of S.prices) {
    const matches = allPrices.filter((p) => p.lookup_key === want.lookupKey);
    if (matches.length > 1) throw new SetupRefused(`${matches.length} prices share lookup key ${want.lookupKey}; archive the extras and clear their lookup keys`);
    if (matches[0]) pricesByKey.set(want.lookupKey, matches[0]);
  }

  // Product: tagged ones first; else a legacy app=avery product matched on exact attributes.
  const allProducts = await listBoth('/v1/products');
  const avProducts = allProducts.filter((p) => tagged(p, S.product.tag));
  const activeProducts = avProducts.filter((p) => p.active !== false);
  if (activeProducts.length > 1) throw new SetupRefused(`found ${activeProducts.length} active Avery products; archive the extras in the Dashboard first`);
  if (activeProducts.length === 0 && avProducts.length > 0) {
    throw new SetupRefused(`the Avery product ${String(avProducts[0]!.id)} is archived. Fix: unarchive it in the Stripe Dashboard, then re-run.`);
  }
  let existingProduct = activeProducts[0];
  let backfillProduct = false;
  if (!existingProduct) {
    // Legacy objects (app=avery, no avery_object tag), active AND archived. A
    // confirmed match needs the full identity (name + descriptor + app) or an
    // authoritative binding (an Avery lookup-key price points at it). Anything
    // that only looks like it is refused, never guessed. All before any write.
    const priceProducts = new Set([...pricesByKey.values()].map(productIdOf));
    const legacyProducts = allProducts.filter(legacy);
    const bound = (p: StripeObject) => priceProducts.has(String(p.id));
    const exact = (p: StripeObject) => bound(p) || (p.name === S.product.name && p.statement_descriptor === S.product.statementDescriptor);
    const near = legacyProducts.filter((p) => p.name === S.product.name || bound(p));
    const partial = near.filter((p) => !exact(p) && p.active !== false);
    if (partial.length) {
      throw new SetupRefused(
        `untagged app=avery product ${partial.map((c) => String(c.id)).join(', ')} has the Avery name but not the full identity (statement descriptor differs). Fix by hand: correct it and add metadata avery_object=${S.product.tag}, or archive it, then re-run.`,
      );
    }
    const candidates = legacyProducts.filter(exact);
    if (candidates.length > 1) {
      throw new SetupRefused(
        `${candidates.length} untagged app=avery products match the Avery product (${candidates.map((c) => String(c.id)).join(', ')}). Fix: archive the wrong ones, then re-run.`,
      );
    }
    if (candidates[0]) {
      if (candidates[0].active === false) {
        throw new SetupRefused(`the untagged Avery product ${String(candidates[0].id)} is archived. Fix: unarchive it in the Stripe Dashboard, then re-run.`);
      }
      existingProduct = candidates[0];
      backfillProduct = true;
    }
  }
  if (existingProduct) wrongMode(existingProduct, 'product');

  // Prices: must match exactly and be active.
  const foundPrices = new Map<string, StripeObject>();
  for (const want of S.prices) {
    const have = pricesByKey.get(want.lookupKey);
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
  const allPortals = await listBoth('/v1/billing_portal/configurations');
  const avPortals = allPortals.filter((c) => tagged(c, S.portal.tag));
  const activePortals = avPortals.filter((c) => c.active !== false);
  if (activePortals.length > 1) throw new SetupRefused(`found ${activePortals.length} active Avery portal configurations; deactivate the extras first`);
  if (activePortals.length === 0 && avPortals.length > 0) {
    throw new SetupRefused(`the Avery portal configuration ${String(avPortals[0]!.id)} is inactive. Fix: reactivate it in the Stripe Dashboard, then re-run.`);
  }
  let existingPortal = activePortals[0];
  let backfillPortal = false;
  if (!existingPortal) {
    // Legacy portals, active AND inactive: a match needs EVERY feature flag.
    const legacyPortals = allPortals.filter(legacy);
    const partial = legacyPortals.filter((c) => c.active !== false && portalDrift(c).length > 0);
    if (partial.length) {
      throw new SetupRefused(
        `untagged app=avery portal configuration ${partial.map((c) => String(c.id)).join(', ')} does not have the Avery features. Fix by hand: deactivate it, or correct it and add metadata avery_object=${S.portal.tag}, then re-run.`,
      );
    }
    const candidates = legacyPortals.filter((c) => portalDrift(c).length === 0);
    if (candidates.length > 1) {
      throw new SetupRefused(
        `${candidates.length} untagged app=avery portal configurations match the Avery features (${candidates.map((c) => String(c.id)).join(', ')}). Fix: deactivate the wrong ones, then re-run.`,
      );
    }
    if (candidates[0]) {
      if (candidates[0].active === false) {
        throw new SetupRefused(`the untagged Avery portal configuration ${String(candidates[0].id)} is inactive. Fix: reactivate it in the Stripe Dashboard, then re-run.`);
      }
      existingPortal = candidates[0];
      backfillPortal = true;
    }
  }
  if (existingPortal) wrongMode(existingPortal, 'portal configuration');

  // Webhook endpoint (exact URL), and whether any write to it is needed.
  const wantEvents = [...opts.webhookEvents].sort();
  const endpoints = allHooks.filter((w) => w.url === url);
  if (endpoints.length > 1) throw new SetupRefused(`found ${endpoints.length} webhook endpoints for ${url}; remove the extras first`);
  const existingHook = endpoints[0];
  const hookChange: FormParams = {};
  if (existingHook) {
    if (meta(existingHook).app !== S.app) throw new SetupRefused(`a webhook endpoint for ${url} exists but is not tagged app=${S.app}; check it by hand`);
    wrongMode(existingHook, 'webhook endpoint');
    if (existingHook.api_version !== opts.apiVersion) {
      throw new SetupRefused(
        `webhook ${String(existingHook.id)} sends API version ${String(existingHook.api_version)}, code expects ${opts.apiVersion}. Stripe cannot change it in place. Fix (JJ approves): delete the endpoint, re-run, set the new signing secret.`,
      );
    }
    const haveEvents = [...((existingHook.enabled_events ?? []) as string[])].sort();
    if (legacy(existingHook) && haveEvents.join(',') !== wantEvents.join(',')) {
      throw new SetupRefused(
        `untagged app=avery webhook ${String(existingHook.id)} at ${url} has different events. Fix by hand: correct its events and add metadata avery_object=${S.webhook.tag}, or delete it (JJ approves), then re-run.`,
      );
    }
    if (haveEvents.join(',') !== wantEvents.join(',')) hookChange.enabled_events = wantEvents;
    if (existingHook.status !== 'enabled') hookChange.disabled = false;
    if (meta(existingHook).avery_object !== S.webhook.tag) hookChange.metadata = { avery_object: S.webhook.tag };
  }
  const hookWrite = !existingHook || Object.keys(hookChange).length > 0;
  if (hookWrite) {
    // Any webhook write (create, events, re-enable) needs a current inventory for THIS mode and account.
    const inv = opts.gates.inventory;
    const need = `a completed ${mode}-mode inventory receipt (--inventory-receipt docs/ops/${S.inventoryFile})`;
    const hint = digestHint;
    if (!inv.ok) throw new SetupRefused(`changing the webhook endpoint needs ${need}: ${inv.reason}.${hint}`);
    if (inv.accountId !== account.id) {
      throw new SetupRefused(`the inventory receipt is for ${String(inv.accountId)}, not this account ${String(account.id)}.${hint}`);
    }
    if (inv.digest !== currentDigest) {
      throw new SetupRefused(`the inventory is stale: the other endpoints changed since it was reviewed. Re-review them and update the receipt.${hint}`);
    }
    // Each live endpoint needs a row whose URL, status and events match what Stripe shows now.
    for (const w of allHooks.filter((x) => !isOurHook(x))) {
      const row = (inv.reviewedRows ?? []).find((r) => r.id === String(w.id));
      const live = `url ${String(w.url)}, status ${String(w.status)}, events ${[...((w.enabled_events ?? []) as string[])].sort().join(' ')}`;
      if (!row) throw new SetupRefused(`the inventory has no review row for ${String(w.id)} (live: ${live}). Add a complete row for each endpoint.`);
      const liveEvents = [...((w.enabled_events ?? []) as string[])].sort().join(',');
      if (row.url !== w.url || row.status !== w.status || row.events.join(',') !== liveEvents) {
        throw new SetupRefused(`the review row for ${String(w.id)} does not match Stripe (live: ${live}). Re-review it and correct the row.`);
      }
    }
  }

  // ---- Phase 2: writes. ----
  let product: StripeObject;
  const productParams: FormParams = { name: S.product.name, statement_descriptor: S.product.statementDescriptor };
  if (!existingProduct) {
    const params = { ...productParams, metadata: { app: S.app, avery_object: S.product.tag } };
    product = await client.post('/v1/products', params, { idempotencyKey: createKey('product', params) });
    counts.created++;
  } else if (backfillProduct || existingProduct.name !== S.product.name || existingProduct.statement_descriptor !== S.product.statementDescriptor) {
    const change: FormParams = { ...productParams, ...(backfillProduct ? { metadata: { avery_object: S.product.tag } } : {}) };
    const observed = { name: existingProduct.name, statement_descriptor: existingProduct.statement_descriptor, metadata: existingProduct.metadata, updated: existingProduct.updated };
    product = await client.post(`/v1/products/${String(existingProduct.id)}`, change, {
      idempotencyKey: updateKey('product', String(existingProduct.id), observed, change),
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
  } else if (backfillPortal || portalDrift(existingPortal).length) {
    portalId = String(existingPortal.id);
    const change: FormParams = { features: PORTAL_FEATURES, ...(backfillPortal ? { metadata: { avery_object: S.portal.tag } } : {}) };
    await client.post(`/v1/billing_portal/configurations/${portalId}`, change, {
      idempotencyKey: updateKey('portal', portalId, { features: existingPortal.features, metadata: existingPortal.metadata, updated: existingPortal.updated }, change),
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
    if (hookWrite) {
      const observed = { enabled_events: existingHook.enabled_events, status: existingHook.status, metadata: existingHook.metadata };
      await client.post(`/v1/webhook_endpoints/${hookId}`, hookChange, { idempotencyKey: updateKey('webhook', hookId, observed, hookChange) });
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
  check(meta(rb.product).avery_object === S.product.tag, 'product metadata avery_object');
  check(meta(rb.portal).app === S.app, 'portal metadata app');
  check(meta(rb.portal).avery_object === S.portal.tag, 'portal metadata avery_object');
  check(meta(rb.webhook).app === S.app, 'webhook metadata app');
  check(meta(rb.webhook).avery_object === S.webhook.tag, 'webhook metadata avery_object');
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
    [`${mode}_mode_endpoints_digest`, currentDigest],
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

type NodeFs = Omit<ReceiptFs, 'resolve'>;

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
    const gates = loadGates({ ...fs, resolve: path.resolve }, args, { cwd: process.cwd(), opsDir, today });

    const expected = readWranglerTarget(fs.readFileSync(path.resolve(hubDir, 'wrangler.jsonc'), 'utf8'), args.env);
    const clientMod = (await import(new URL('../src/stripe/client.ts', HERE).href)) as typeof import('../src/stripe/client');
    const eventsMod = (await import(new URL('../src/stripe/events.ts', HERE).href)) as typeof import('../src/stripe/events');
    const client = clientMod.createStripeClient({ secretKey: secretKey!, ...clientMod.clientConfigFromEnv(process.env) });
    await runSetup({
      client,
      args,
      expected,
      gates,
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
