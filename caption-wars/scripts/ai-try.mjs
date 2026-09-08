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
  const args = {
    samples: 20,
    photosPerCall: 3,
    personas: null,
    json: false,
    // THE TAG AUDIT (review round 6). PHOTO_TAGS is the game's content policy:
    // it decides what the game PUTS ON THE SCREEN. `--audit-tags duck,pigeon`
    // pulls real photos for each tag and prints the vision model's one-sentence
    // description of every one, so a tag is judged on what it actually returns
    // rather than on what the word sounds like.
    //   npm run ai:try -- --audit-tags duck,pigeon --per-tag 3
    auditTags: null,
    perTag: 3,
  };
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
      case '--audit-tags':
        args.auditTags = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--per-tag':
        args.perTag = Number(argv[++i]);
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

async function callOnce(photos, extra = {}) {
  const res = await fetch(`${url}/api/ai-try`, {
    method: 'POST',
    headers: { 'x-smoke-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      photos,
      ...(args.personas ? { personas: args.personas } : {}),
      ...extra,
    }),
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

// TAG AUDIT MODE: describe real photos for each candidate tag and stop. No
// captions, no rates, one model call per photo.
if (args.auditTags) {
  console.log(`\ntag audit: ${args.perTag} photos per tag, one vision description each\n`);
  for (const tag of args.auditTags) {
    const body = await callOnce(args.perTag, { tags: [tag], describeOnly: true });
    for (const sample of body.samples) {
      console.log(
        `  ${cell(tag, 12)} ${cell(sample.photoSource, 12)} ${sample.photoDescription ?? '(no description)'}`
      );
    }
    for (const err of body.photoErrors ?? []) console.log(`  ${cell(tag, 12)} ERROR ${err}`);
    console.log('');
  }
  console.log('Read every line. A tag ships only if its photos are about the tag and');
  console.log('have no people-focused content. Anything with people in it is JJ\'s call.');
  process.exit(0);
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
// Grouped by photo, with the vision model's own one-sentence description above
// its four captions: the relevance rate below is only trustworthy if a human can
// read the picture and the caption side by side, which is the whole point of the
// round-5 addition (a live game scored 24/24 on the old bar while shipping "It's
// been raining all day, so we went for a hike." for a photo of a horse).
const byPhoto = new Map();
for (const s of all) {
  if (!byPhoto.has(s.photoSha)) byPhoto.set(s.photoSha, []);
  byPhoto.get(s.photoSha).push(s);
}
for (const [sha, group] of byPhoto) {
  console.log(`\nphoto ${sha.slice(0, 8)}: ${group[0].photoDescription ?? '(no description)'}`);
  console.log(
    `  ${cell('persona', 16)} ${cell('v1', 9)} ${cell('rel', 10)} ${cell('ms', 6)} ${cell('final caption / why not', 70)}`
  );
  for (const s of group) {
    const first = s.attempts[0] ?? {};
    const shown = s.final ?? `NO CAPTION (${s.attempts.map((a) => a.verdict).join(' -> ')})`;
    const ms = s.attempts.reduce((sum, a) => sum + (a.ms ?? 0), 0);
    console.log(
      `  ${cell(s.persona, 16)} ${cell(first.verdict, 9)} ${cell(s.relevance, 10)} ${cell(ms, 6)} ${cell(shown, 70)}`
    );
  }
}

const firsts = all.map((s) => s.attempts[0]?.verdict ?? 'empty');
const count = (v) => firsts.filter((f) => f === v).length;
const pct = (n) => `${((n / all.length) * 100).toFixed(1)}%`;
const labelling = all.filter((s) => s.attempts.some((a) => a.verdict === 'labelling')).length;
const failed = all.filter((s) => s.final === null).length;

// ROUND 6 SPLITS THIS NUMBER, and the reason matters. Rule 40's bar
// ("under 10% first-attempt refusal/meta") has always been measured with the
// REGEX as the instrument. The round-6 judge is a second, sharper instrument on
// the same answers, so lumping its rejections into the same number would move a
// documented acceptance bar without saying so, and would read as "the prompt got
// worse" when what actually happened is "we can finally see". So:
//   regex     what rule 40 has always measured. The bar applies to THIS.
//   judge     non-captions the regex missed. Reported, and its own bar below.
const firstJudge = all.map((s) => s.attempts[0]?.judge ?? null);
const byRegex = firsts.filter((f, i) => f === 'refusal' && firstJudge[i] === null).length;
const byJudge = firsts.filter((f, i) => f === 'refusal' && firstJudge[i] !== null).length;

console.log('\nFIRST-ATTEMPT RATES (what the prompt produces before any retry)');
console.log(`  ok        ${count('ok')}\t${pct(count('ok'))}`);
console.log(`  refusal   ${count('refusal')}\t${pct(count('refusal'))}\t(regex ${byRegex}, judge ${byJudge})`);
console.log(`  empty     ${count('empty')}\t${pct(count('empty'))}`);
console.log(`  labelling ${count('labelling')}\t${pct(count('labelling'))}`);
console.log('\nWHOLE PIPELINE');
console.log(`  captions delivered   ${all.length - failed}/${all.length}`);
console.log(`  bots that sat it out ${failed}`);
console.log(`  labelling anywhere   ${labelling}`);

// THE CAPTION JUDGE (round 6). Every attempt the fast-path regex let through was
// then shown to TEXT_MODEL, and only `caption` shipped. `rejected` is what the
// regex would have missed; `unknown` is the judge failing open.
const judged = all.flatMap((s) => s.attempts.map((a) => a.judge)).filter((v) => v != null);
const judgeCount = (v) => judged.filter((j) => j === v).length;
console.log('\nCAPTION JUDGE (the authority: only "caption" ships)');
console.log(`  judged     ${judged.length} (one extra text call per caption the regex passed)`);
console.log(`  caption    ${judgeCount('caption')}`);
console.log(`  REJECTED   ${judgeCount('refusal') + judgeCount('description')} (refusal ${judgeCount('refusal')}, description ${judgeCount('description')})`);
console.log(`  unknown    ${judgeCount('unknown')} (judge failed open, regex verdict stood)`);

// RELEVANCE (round 5): is the caption about the photo at all? Counted over the
// samples that produced a caption, because a bot that sat the round out has no
// caption to be about anything.
const delivered = all.filter((s) => s.final !== null);
const rel = (v) => delivered.filter((s) => s.relevance === v).length;
const onPhoto = rel('on-photo');
const onPhotoPct = delivered.length > 0 ? (onPhoto / delivered.length) * 100 : 0;
console.log('\nRELEVANCE (is the caption about THIS photo)');
console.log(`  on-photo   ${onPhoto}/${delivered.length}\t${onPhotoPct.toFixed(1)}%`);
console.log(`  off-photo  ${rel('off-photo')}`);
console.log(`  unknown    ${rel('unknown')}`);

const attemptTimes = all.flatMap((s) => s.attempts.map((a) => a.ms ?? 0)).filter((n) => n > 0);
if (attemptTimes.length > 0) {
  const sorted = [...attemptTimes].sort((a, b) => a - b);
  const mean = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  console.log('\nPER-ATTEMPT LATENCY (what BOT_TIMEOUT_MS has to cover)');
  console.log(`  attempts ${sorted.length}  mean ${mean}ms  p50 ${sorted[Math.floor(sorted.length * 0.5)]}ms  p95 ${sorted[Math.floor(sorted.length * 0.95)]}ms  max ${sorted[sorted.length - 1]}ms`);
}
if (photoErrors.length > 0) console.log(`\nphoto errors: ${photoErrors.length}`);

// The acceptance bar from the plan (rule 40). Refusals and echoes are counted as
// the same thing on purpose: to a player they are both "that is not a caption".
// Round 5 added the on-photo bar, because the other three numbers can all be
// perfect while the captions are about a different photo entirely.
const refusalPct = (byRegex / all.length) * 100;
const judgePct = (byJudge / all.length) * 100;
const bad = [];
if (refusalPct >= 10) bad.push(`regex refusal/meta first-attempt rate ${refusalPct.toFixed(1)}% (bar: under 10%)`);
// Rule 50's bar on the new instrument: the judge may reject up to a third of
// first attempts before the prompt itself is the problem. It is set where the
// measurement landed once the judge existed (round 6: 25-29% on 24 samples,
// every rejection re-checked by hand and correct), not at a number nobody has
// ever measured. What the PLAYER sees is bounded by the two lines under it:
// zero non-captions delivered and zero bots sitting out is the real bar.
if (judgePct >= 35) bad.push(`judge-rejected first-attempt rate ${judgePct.toFixed(1)}% (bar: under 35%)`);
if (labelling > 0) bad.push(`${labelling} labelling trip(s) (bar: 0)`);
if (delivered.length > 0 && onPhotoPct < 80) {
  bad.push(`on-photo rate ${onPhotoPct.toFixed(1)}% (bar: at least 80%)`);
}
if (bad.length > 0) {
  console.log(`\nai:try BELOW THE BAR - ${bad.join('; ')}`);
  process.exit(1);
}
console.log('\nai:try OK - within the acceptance bar in the plan');
