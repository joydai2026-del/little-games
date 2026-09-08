#!/usr/bin/env node
// The prompt tuning rig's client. Calls POST /api/ai-try on the DEPLOYED worker,
// which runs real photos through the real bot caption pipeline, and prints what
// the models actually wrote plus the rates that matter.
//
//   CAPTION_WARS_URL=https://caption-wars.<subdomain>.workers.dev \
//   SMOKE_TOKEN=<the wrangler secret> \
//   npm run ai:try -- --samples 24 --photos-per-call 2
//
// Why per-call batching: every sample is a real vision-model call and a Worker
// has a subrequest budget, so the target sample count is reached over several
// small requests rather than one big one.
//
// ON THE CLOUDFLARE FREE PLAN USE `--photos-per-call 2`. Free allows 50 external
// subrequests per Worker invocation, and on the OpenAI provider every model call
// is one, as is every photo fetch. Three photos x four personas does not fit;
// two does, with room for the photo fetches. If a run comes back with
// `limitErrors` or `summary.truncated`, that is the ceiling and not the models,
// so the rates in that answer do not count.
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
    // 2, the number this file's own header tells you to use on the free plan.
    photosPerCall: 2,
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
  // ROUND 9 (Claude nit 1): `--samples 0` and `--samples abc` (which is NaN)
  // never entered the sampling loop, so `all` was empty, no rate could fail,
  // and the script printed "ai:try OK - within the acceptance bar in the plan"
  // and exited 0 on ZERO DATA. Rule 58 makes this the deploy gate for the
  // prompt; a gate that passes on no measurement is the one failure mode it
  // cannot have.
  if (!Number.isInteger(args.samples) || args.samples < 1) {
    die(`--samples must be a whole number of at least 1 (got ${args.samples})`);
  }
  if (!Number.isInteger(args.photosPerCall) || args.photosPerCall < 1) {
    die('--photos-per-call must be a whole number of at least 1');
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
// THE SPEND, per request (review round 7, must-fix 1b / Claude should-fix 3).
// The worker has always computed these and this script threw them away, so a run
// that saturated AI_TRY_MAX_MODEL_CALLS silently stopped judging and stopped
// scoring relevance on its later samples and printed a BETTER-looking table for
// it. A saturated run is a truncated measurement, not a passing one.
const calls = [];

while (all.length < args.samples) {
  const body = await callOnce(args.photosPerCall);
  promptVersion = body.prompt_version;
  all.push(...body.samples);
  photoErrors.push(...(body.photoErrors ?? []));
  if (body.summary) {
    calls.push({
      used: body.summary.model_calls ?? 0,
      cap: body.summary.model_call_cap ?? 0,
      // ROUND 8 (Claude nit 1): the worker now says outright whether the cap
      // REFUSED a call it wanted to make, or stopped the photo loop early. A
      // request whose last call lands exactly on the cap measured everything it
      // set out to measure and is not truncated, but `used >= cap` called it
      // saturated and failed the run. Fall back to the old comparison only when
      // talking to a worker deployed before this field existed.
      truncated:
        typeof body.summary.truncated === 'boolean'
          ? body.summary.truncated
          : (body.summary.model_call_cap ?? 0) > 0 &&
            (body.summary.model_calls ?? 0) >= body.summary.model_call_cap,
    });
  }
  process.stderr.write(`  ...${all.length}/${args.samples} samples\n`);
  if (body.samples.length === 0) die('the worker returned no samples at all');
}

const modelCalls = calls.reduce((sum, c) => sum + c.used, 0);
const perRequestCap = calls.length > 0 ? Math.max(...calls.map((c) => c.cap)) : 0;
const saturated = calls.filter((c) => c.truncated).length;

// ROUND 8 (Codex should-fix 1): `--json` used to return HERE, before the
// acceptance bar below existed, and its payload carried only the raw samples. So
// `ai:try --json` exited 0 on a run that normal `ai:try` would have failed, and
// carried no spend data at all: automation reading it could not even see that
// the run had been truncated at the model-call cap. The bar is now computed once
// and BOTH modes enforce it. The report below still prints for a human; in
// --json mode it goes to stderr so stdout stays parseable.
const out = args.json
  ? (line = '') => process.stderr.write(`${line}\n`)
  : (line = '') => console.log(line);

out(`\nprompt ${promptVersion}, ${all.length} samples\n`);
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
  out(`\nphoto ${sha.slice(0, 8)}: ${group[0].photoDescription ?? '(no description)'}`);
  out(
    `  ${cell('persona', 16)} ${cell('v1', 9)} ${cell('rel', 10)} ${cell('ms', 6)} ${cell('final caption / why not', 70)}`
  );
  for (const s of group) {
    const first = s.attempts[0] ?? {};
    const shown = s.final ?? `NO CAPTION (${s.attempts.map((a) => a.verdict).join(' -> ')})`;
    const ms = s.attempts.reduce((sum, a) => sum + (a.ms ?? 0), 0);
    out(
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

out('\nFIRST-ATTEMPT RATES (what the prompt produces before any retry)');
out(`  ok        ${count('ok')}\t${pct(count('ok'))}`);
out(`  refusal   ${count('refusal')}\t${pct(count('refusal'))}\t(regex ${byRegex}, judge ${byJudge})`);
out(`  empty     ${count('empty')}\t${pct(count('empty'))}`);
out(`  labelling ${count('labelling')}\t${pct(count('labelling'))}`);
out('\nWHOLE PIPELINE');
out(`  captions delivered   ${all.length - failed}/${all.length}`);
out(`  bots that sat it out ${failed}`);
out(`  labelling anywhere   ${labelling}`);

// THE CAPTION JUDGE (round 6). Every attempt the fast-path regex let through was
// then shown to TEXT_MODEL, and only `caption` shipped. `rejected` is what the
// regex would have missed; `unknown` is the judge failing open.
const judged = all.flatMap((s) => s.attempts.map((a) => a.judge)).filter((v) => v != null);
const judgeCount = (v) => judged.filter((j) => j === v).length;
out('\nCAPTION JUDGE (the authority: only "caption" ships)');
out(`  judged     ${judged.length} (one extra text call per caption the regex passed)`);
out(`  caption    ${judgeCount('caption')}`);
out(`  REJECTED   ${judgeCount('refusal') + judgeCount('description')} (refusal ${judgeCount('refusal')}, description ${judgeCount('description')})`);
out(`  unknown    ${judgeCount('unknown')} (judge failed open, regex verdict stood)`);

// RELEVANCE (round 5): is the caption about the photo at all? Counted over the
// samples that produced a caption, because a bot that sat the round out has no
// caption to be about anything.
const delivered = all.filter((s) => s.final !== null);
const rel = (v) => delivered.filter((s) => s.relevance === v).length;
const onPhoto = rel('on-photo');
const onPhotoPct = delivered.length > 0 ? (onPhoto / delivered.length) * 100 : 0;
out('\nRELEVANCE (is the caption about THIS photo)');
out(`  on-photo   ${onPhoto}/${delivered.length}\t${onPhotoPct.toFixed(1)}%`);
out(`  off-photo  ${rel('off-photo')}`);
out(`  unknown    ${rel('unknown')}`);

const attemptTimes = all.flatMap((s) => s.attempts.map((a) => a.ms ?? 0)).filter((n) => n > 0);
if (attemptTimes.length > 0) {
  const sorted = [...attemptTimes].sort((a, b) => a - b);
  const mean = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  out('\nPER-ATTEMPT LATENCY (what BOT_TIMEOUT_MS has to cover)');
  out(`  attempts ${sorted.length}  mean ${mean}ms  p50 ${sorted[Math.floor(sorted.length * 0.5)]}ms  p95 ${sorted[Math.floor(sorted.length * 0.95)]}ms  max ${sorted[sorted.length - 1]}ms`);
}
out('\nMODEL SPEND (this is a finite daily allowance, see the README)');
out(`  requests   ${calls.length}`);
out(`  model calls ${modelCalls} total, cap ${perRequestCap} per request`);
out(
  `  truncated  ${saturated} of ${calls.length} request(s) were cut short by the cap` +
    (saturated > 0 ? '  <- the later samples in those requests were NOT judged' : '')
);
if (photoErrors.length > 0) out(`\nphoto errors: ${photoErrors.length}`);

// THE ACCEPTANCE BAR (rule 40, rewritten in review round 7).
//
// What changed and why. Rule 40 has always gated on the FIRST-ATTEMPT regex
// refusal rate, under 10%. Round 6's gate run measured 12.5% while delivering 24
// captions out of 24 with zero bots sitting out: a perfect player-facing outcome
// failing its own gate. Three things are wrong with that bar and all three point
// the same way:
//   1. It gates on an INTERMEDIATE. A first-attempt refusal costs one
//      regeneration out of a three-rung ladder. A player is only harmed when a
//      non-caption is DELIVERED or a bot sits the round out.
//   2. A 10% bar is not resolvable at n = 24. The threshold is literally three
//      events (2/24 = 8.3% passes, 3/24 = 12.5% fails), and the same build
//      measured 4.2%, 4.2% and 12.5% on three runs. The rational response to a
//      coin-flip gate is to re-roll it, which is exactly the behaviour a tuning
//      rig exists to make impossible.
//   3. Since round 6 the number is CONFOUNDED BY THE GUARD. The regex is the
//      fast path (rule 50) and is allowed to miss; edit caption-guard.ts and the
//      refusal rate moves with the prompt untouched. A prompt gate must not move
//      when the guard moves.
// A zero-event bar IS honest at n = 24 (one occurrence is unambiguous), and the
// free daily allowance cannot buy the hundreds of samples a rate bar would need.
// So: GATE ON ZEROES, REPORT THE RATES.
const bad = [];

// HARD 1: non-captions DELIVERED. A caption ships only when the regex passed it
// AND the judge said `caption`; anything delivered on a judge that failed open
// (`unknown`) or never ran (`null`) reached the table with no authority having
// approved it, and that is the one thing rule 39 and rule 50 both exist to stop.
// In a healthy run this is 0, because the judge answers.
const deliveredUnjudged = all.filter((s) => {
  if (s.final === null) return false;
  const shipped = s.attempts[s.attempts.length - 1];
  return !shipped || shipped.judge !== 'caption';
});
out('\nDELIVERED, AND WHAT APPROVED IT (this is rule 40\'s bar)');
out(`  delivered            ${all.length - failed}/${all.length}`);
out(`  approved by the judge ${all.length - failed - deliveredUnjudged.length}`);
out(`  UNJUDGED on delivery  ${deliveredUnjudged.length} (bar: 0)`);
for (const s of deliveredUnjudged.slice(0, 5)) {
  out(`    ${cell(s.persona, 16)} ${s.final}`);
}
if (deliveredUnjudged.length > 0) {
  bad.push(`${deliveredUnjudged.length} caption(s) delivered without a judge verdict (bar: 0)`);
}

// HARD 2: a silent bot is what rule 38(a) protects against.
if (failed > 0) bad.push(`${failed} bot(s) sat the round out (bar: 0)`);

// HARD 3: unchanged since round 4.
if (labelling > 0) bad.push(`${labelling} labelling trip(s) (bar: 0)`);

// HARD 4: a saturated run is a truncated measurement (round 7, must-fix 1b).
if (saturated > 0) {
  bad.push(
    `${saturated} request(s) were cut short by the ${perRequestCap}-model-call cap, so their later ` +
      'samples were not judged and the rates below are measured on a truncated run'
  );
}

// HARD 5: relevance, unchanged since round 5. It is a rate bar and it has the
// same resolution problem as the old refusal bar, which is written down in the
// plan's round-7 block as a known weakness rather than silently moved.
if (delivered.length > 0 && onPhotoPct < 80) {
  bad.push(`on-photo rate ${onPhotoPct.toFixed(1)}% (bar: at least 80%)`);
}

// SOFT: diagnostics for whoever is editing the prompt or the judge prompt. They
// print a warning and they do NOT fail the run, because neither is resolvable at
// this sample size and the regex one moves when the guard moves.
const refusalPct = (byRegex / all.length) * 100;
const judgePct = (byJudge / all.length) * 100;
const soft = [];
if (refusalPct >= 10) {
  soft.push(`regex first-attempt refusal rate ${refusalPct.toFixed(1)}% (soft bar: under 10%)`);
}
if (judgePct >= 35) {
  soft.push(`judge-rejected first-attempt rate ${judgePct.toFixed(1)}% (soft bar: under 35%)`);
}
if (soft.length > 0) {
  out(`\nai:try DIAGNOSTICS (not a failure) - ${soft.join('; ')}`);
}

const pass = bad.length === 0;

// The machine-readable answer (round 8). `summary` is every number the bar is
// computed from, `saturated` is the truncation count the round-7 spend block
// added, and `pass` is the same verdict the human report prints. The exit code
// matches it in BOTH modes, so a pipeline cannot read a green exit off a run
// that failed.
if (args.json) {
  console.log(
    JSON.stringify(
      {
        prompt_version: promptVersion,
        samples: all,
        summary: {
          samples: all.length,
          delivered: all.length - failed,
          sat_out: failed,
          delivered_unjudged: deliveredUnjudged.length,
          labelling_anywhere: labelling,
          on_photo_pct: Number(onPhotoPct.toFixed(1)),
          regex_refusal_pct: Number(refusalPct.toFixed(1)),
          judge_rejected_pct: Number(judgePct.toFixed(1)),
          requests: calls.length,
          model_calls: modelCalls,
          model_call_cap: perRequestCap,
          photo_errors: photoErrors.length,
        },
        saturated,
        pass,
        failures: bad,
        diagnostics: soft,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

if (!pass) {
  out(`\nai:try BELOW THE BAR - ${bad.join('; ')}`);
  process.exit(1);
}
out('\nai:try OK - within the acceptance bar in the plan');
