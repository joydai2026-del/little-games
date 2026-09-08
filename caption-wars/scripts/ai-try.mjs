#!/usr/bin/env node
// The prompt tuning rig's client. Calls POST /api/ai-try on the DEPLOYED worker,
// which runs real photos through the real bot caption pipeline, and prints what
// the models actually wrote plus the rates that matter.
//
//   CAPTION_WARS_URL=https://caption-wars.<subdomain>.workers.dev \
//   SMOKE_TOKEN=<the wrangler secret> \
//   npm run ai:try -- --samples 24 --photos-per-call 3
//
// Why per-call batching: every sample is a real vision-model call and a Worker
// has a subrequest budget, so the target sample count is reached over several
// small requests rather than one big one.
//
// No dependencies: plain Node fetch.

const url = (process.env.CAPTION_WARS_URL ?? '').replace(/\/+$/, '');
const token = process.env.SMOKE_TOKEN ?? '';

function die(message) {
  console.error(`ai:try FAILED - ${message}`);
  process.exit(1);
}

if (!url) die('set CAPTION_WARS_URL to the deployed worker URL');
if (!token) die('set SMOKE_TOKEN to the value you gave `npx wrangler secret put SMOKE_TOKEN`');

function parseArgs(argv) {
  const args = { samples: 20, photosPerCall: 3, personas: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--samples':
        args.samples = Number(argv[++i]);
        break;
      case '--photos-per-call':
        args.photosPerCall = Number(argv[++i]);
        break;
      case '--personas':
        args.personas = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--json':
        args.json = true;
        break;
      default:
        die(`unknown argument ${argv[i]}`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

async function callOnce(photos) {
  const res = await fetch(`${url}/api/ai-try`, {
    method: 'POST',
    headers: { 'x-smoke-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos, ...(args.personas ? { personas: args.personas } : {}) }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    die(`/api/ai-try answered ${res.status} with non-JSON: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    console.error(JSON.stringify(body, null, 2));
    die(`/api/ai-try answered ${res.status}`);
  }
  return body;
}

/** Pads a cell so the table lines up in a terminal. */
function cell(text, width) {
  const s = String(text ?? '');
  return s.length > width ? `${s.slice(0, width - 1)}…` : s.padEnd(width);
}

const all = [];
const photoErrors = [];
let promptVersion = 'unknown';

while (all.length < args.samples) {
  const body = await callOnce(args.photosPerCall);
  promptVersion = body.prompt_version;
  all.push(...body.samples);
  photoErrors.push(...(body.photoErrors ?? []));
  process.stderr.write(`  ...${all.length}/${args.samples} samples\n`);
  if (body.samples.length === 0) die('the worker returned no samples at all');
}

if (args.json) {
  console.log(JSON.stringify({ prompt_version: promptVersion, samples: all }, null, 2));
  process.exit(0);
}

console.log(`\nprompt ${promptVersion}, ${all.length} samples\n`);
console.log(
  `${cell('persona', 18)} ${cell('v1', 10)} ${cell('final caption / why not', 84)}`
);
console.log('-'.repeat(115));
for (const s of all) {
  const first = s.attempts[0] ?? {};
  const shown = s.final ?? `NO CAPTION (${s.attempts.map((a) => a.verdict).join(' -> ')})`;
  console.log(`${cell(s.persona, 18)} ${cell(first.verdict, 10)} ${cell(shown, 84)}`);
}

const firsts = all.map((s) => s.attempts[0]?.verdict ?? 'empty');
const count = (v) => firsts.filter((f) => f === v).length;
const pct = (n) => `${((n / all.length) * 100).toFixed(1)}%`;
const labelling = all.filter((s) => s.attempts.some((a) => a.verdict === 'labelling')).length;
const failed = all.filter((s) => s.final === null).length;

console.log('\nFIRST-ATTEMPT RATES (what the prompt produces before any retry)');
console.log(`  ok        ${count('ok')}\t${pct(count('ok'))}`);
console.log(`  refusal   ${count('refusal')}\t${pct(count('refusal'))}`);
console.log(`  empty     ${count('empty')}\t${pct(count('empty'))}`);
console.log(`  labelling ${count('labelling')}\t${pct(count('labelling'))}`);
console.log('\nWHOLE PIPELINE');
console.log(`  captions delivered   ${all.length - failed}/${all.length}`);
console.log(`  bots that sat it out ${failed}`);
console.log(`  labelling anywhere   ${labelling}`);
if (photoErrors.length > 0) console.log(`\nphoto errors: ${photoErrors.length}`);

// The acceptance bar from the plan. Refusals and echoes are counted as the same
// thing on purpose: to a player they are both "that is not a caption".
const refusalPct = (count('refusal') / all.length) * 100;
const bad = [];
if (refusalPct >= 10) bad.push(`refusal/meta first-attempt rate ${refusalPct.toFixed(1)}% (bar: under 10%)`);
if (labelling > 0) bad.push(`${labelling} labelling trip(s) (bar: 0)`);
if (bad.length > 0) {
  console.log(`\nai:try BELOW THE BAR - ${bad.join('; ')}`);
  process.exit(1);
}
console.log('\nai:try OK - within the acceptance bar in the plan');
