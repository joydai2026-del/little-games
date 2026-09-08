# Caption Wars: config-selected OpenAI model provider

Date: 2026-09-08. Branch: `feat/caption-wars-openai-provider`. Nothing committed, nothing deployed,
git untouched.

## What this is, in one paragraph

The AI players were offline most of every day because Cloudflare's free Workers AI allowance (10,000
neurons) runs out and every call comes back `4006`. JJ decided Cloudflare stays free and she supplies
an OpenAI key instead. So the game now has a provider SWITCH: `AI_PROVIDER=workers-ai` (the
zero-config default) or `AI_PROVIDER=openai`. One function decides it, three call sites use it, and no
game logic mentions a provider. `wrangler.jsonc` is set to `openai`; the deploy is safe without the
secret because a missing key warns once and falls back to Workers AI.

## Files touched

| File | Change | Grade |
|---|---|---|
| `src/worker/openai.ts` (NEW) | `makeOpenAiModel()` returns an `AiLike` backed by OpenAI Chat Completions. Translates both Workers AI input shapes, returns `{ response }`. No deps, plain fetch | B (proven in source + tests) |
| `tests/openai.test.ts` (NEW) | 18 tests over the translation, error classification, and `modelProvider` | A (they run green) |
| `src/worker/env.ts` | `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_VISION_MODEL`, `OPENAI_TEXT_MODEL`, optional `OPENAI_API_KEY`; `Settings.provider`; new `modelProvider(env)` and internal `resolveProvider(env)` | B |
| `src/worker/bots.ts` | `isAiOfflineError` widened by exactly two markers; the offline `console.warn` is now provider-neutral and prints the real message | B |
| `src/worker/room-do.ts` | `botModels()` goes through `modelProvider` | B |
| `src/worker/smoke.ts` | `modelProvider`; licence handshake only on `workers-ai`; `provider` in `SmokeResult` | B |
| `src/worker/ai-try.ts` | `modelProvider`; the judge-audit branch now reports `models.textModel` instead of `set.textModel` (it was naming a model it was not calling) | B |
| `scripts/ai-smoke.mjs` | prints `provider` on the OK line. Its existing parsing was already unaffected | B |
| `wrangler.jsonc` | the four vars plus a comment block (policy vs secret, the free-plan reason). `AI_PROVIDER` set to `"openai"` per JJ | B |
| `tsconfig.json` / `tsconfig.worker.json` | `tests/openai.test.ts` routed to the worker config, because it imports `env.ts` which names Cloudflare ambient types. This follows the convention already written in `tsconfig.json`'s own comment | B |
| `docs/plans/2026-09-07-mvp-plan.md` | new section `## Amendments after JJ's decisions (2026-09-08)`: decision 1, **rule 70**, the fallback, the quirk table, and the two still-open items | n/a |
| `README.md` | four vars plus the secret command in the config table, and a short "which models answer" section | n/a |

## The three sibling sites that build a `BotModels` (all now go through `modelProvider`)

1. `src/worker/room-do.ts`, `botModels()` (line ~348) : the game itself.
2. `src/worker/smoke.ts`, `handleAiSmoke` : `POST /api/ai-smoke`, the deploy gate.
3. `src/worker/ai-try.ts`, `handleAiTry` : `POST /api/ai-try`, the prompt tuning rig.

`grep -rn "env\.AI\b" src/ scripts/` now returns exactly one use of the AI BINDING,
`src/worker/env.ts:174` inside `modelProvider`. (The wider `env\.AI` prefix also matches
`env.AI_PROVIDER`, `env.AI_TRY_MAX_SAMPLES` and `env.AI_TRY_MAX_MODEL_CALLS`, which are vars, not the
binding.) There is no other use of the binding in the worker or the scripts. Grade A (grep run after
the change).

## Design decisions worth naming

- **Rule number.** The highest existing rule in the plan is 69, so the new one is **70**.
- **`isAiOfflineError` markers.** Added `insufficient_quota` and `invalid_api_key`. Deliberately NOT
  `rate_limit_exceeded` and not the 429 status (which `insufficient_quota` shares): a rate limit is a
  hiccup, a dead key or empty wallet is a wall. Same asymmetry the file already argues for `4006`.
- **`visionModelFallback` on OpenAI is the same id as `visionModel`.** There is no second OpenAI
  vision model. `composeBotCaption` already skips its third rung when the two ids match, so the ladder
  is two rungs on OpenAI with no new branch.
- **`strict: false` on the wrapped JSON schema.** The game's three schemas
  (`CAPTION_JUDGE_SCHEMA`, `VOTE_SCHEMA`, `RELEVANCE_SCHEMA`) do not carry the
  `additionalProperties: false` plus every-key-required shape OpenAI strict mode demands. A rejected
  request is a bot that never votes, so strict is off.
- **Base64 in 32 KB chunks.** `String.fromCharCode(...bytes)` on a 1 MB photo (`VISION_MAX_BYTES`) is
  an argument-count crash, not a slow path.
- **Missing key falls back rather than failing.** A deploy that sets the var and forgets
  `wrangler secret put OPENAI_API_KEY` degrades to what it had yesterday plus one `console.warn`.

## Tests added

`tests/openai.test.ts` (18):

- the vision call: prompt + real fixture photo bytes in one message; the data URL decodes back to the
  same byte count, first byte and last byte
- PNG signature sniffed to `image/png`
- a prompt with no image is a plain text message (the licence handshake shape)
- `Authorization: Bearer <key>` header
- custom base URL, no doubled slash
- bare JSON schema wrapped as `{ name: 'answer', schema, strict: false }`; messages passed through
- `max_completion_tokens` sent, `max_tokens` absent
- temperature kept and no `reasoning_effort` on `gpt-4.1-mini`
- temperature dropped and `reasoning_effort: 'minimal'` on `gpt-5-mini` and `o3-mini`
- the answer feeds `parseVoteAnswer` and `parseJudgeVerdict` unchanged
- missing content and non-JSON 2xx both give `{ response: '' }`, never a crash
- 401 `invalid_api_key` throws `openai 401: invalid_api_key` and `isAiOfflineError` says true
- 429 `rate_limit_exceeded` throws and `isAiOfflineError` says false
- error detail falls back to `message`, then raw body, truncated to 300 chars
- `modelProvider`: openai only with var + key; model ids from the vars; fallback is the vision model;
  falls back to Workers AI with no key and on a bare env; hands back the AI binding on `workers-ai`

`tests/bots.test.ts` (2 added to the existing `isAiOfflineError` describe):

- "recognises the two OpenAI ACCOUNT-level codes"
- "leaves an OpenAI rate limit alone: a 429 is a hiccup unless it says quota"

## Verification (all run 2026-09-08, in `caption-wars`)

```
npm run typecheck   -> clean, no output (tsc -p tsconfig.json && tsc -p tsconfig.worker.json)
npm test            -> vitest: 12 files, 341 tests passed (was 11 / 320)
                       node --test: 37 pass, 0 fail
npm run check:xss   -> exit 0
npm run build       -> vite build OK, 21 modules, dist/client written in ~52ms
```

Plus a local JSONC parse of `wrangler.jsonc` to prove the new comment block did not break the file.
Nothing that hits the network or a paid API was run. Grade A for all five.

## Things I was unsure about, stated plainly

1. **The two default model ids are grade C.** `gpt-4.1-mini` for both vision and text was chosen from
   OpenAI's published catalog, never called on this account. It may not exist under that exact id for
   this key, and its caption quality is unknown.
2. **The quirk table is grade C.** That `gpt-5*` and the o-series reject non-default `temperature` and
   need `reasoning_effort` comes from OpenAI's published per-family behaviour, not from a live call
   here. If JJ points the vars at `gpt-4.1-mini` (the default), none of it fires.
3. **`strict: false` is a judgement call.** Strict mode would give stronger JSON guarantees but needs
   the schemas rewritten. If bot votes come back malformed on OpenAI, tightening the three schemas and
   flipping this to `true` is the next move, not a parser change.
4. **Nothing has run against a real OpenAI endpoint.** The whole provider is proven in source and by a
   fake fetch. `npm run ai:smoke` against the deployed worker with the secret set is the first real
   evidence, and it must be run before anyone is handed a link.
5. **The prompt's measured numbers do not transfer.** `p10`'s refusal / on-photo rates were taken on
   Workers AI models. Rule 58's `ai:try` bar has to be re-measured on OpenAI from scratch.
6. **`console.warn` wording change in `noteIfAiOffline`.** I changed it from a Workers-AI-specific
   sentence to a provider-neutral one that includes the error message, because the old line would now
   be wrong half the time. No test asserted on that string (the suite is green).
7. **Not asked for, done anyway, both one line:** `ai-try.ts`'s judge-audit response was reporting
   `set.textModel` while calling `models.textModel`; on OpenAI those differ, so it would have named the
   wrong model. And `scripts/ai-smoke.mjs` now prints the provider on its OK line. Say the word and
   either can come out.

---

## Fix round 1

Date: 2026-09-08, same branch, same day. Two independent reviews came back FIX-FIRST (Codex CLI, and
a fresh-context Claude adversarial pass). Every must-fix below is applied. Nothing committed, nothing
deployed, git untouched apart from staging.

### What changed, in one paragraph

Three of the fixes are about not GUESSING. The provider now throws a structured error carrying the
status and the parsed `error.code`, so "is the account out of money" is answered by a code and never
by hunting for words in a sentence (a proxy's `request id 4006` used to read as Cloudflare's quota
wall and benched every bot in the room). The API key is scrubbed out of any error body before it can
reach a log. And the per-model request body is now three families instead of one bucket, because
`o3-mini` rejects the exact value the old code sent it, which would have been a 400 on every single
text call. The fourth fix restores the retry the caption ladder lost: on OpenAI there is only one
vision model, and the ladder had quietly collapsed to a single attempt.

### The six fixes

| # | Review that pinned it | What was wrong | What it does now |
|---|---|---|---|
| 1 | Codex 3, Claude 5 (in part) | `isAiOfflineError` searched arbitrary error TEXT, so `openai 502: upstream unavailable, request id 4006` classified as an account-level wall and took the room's bots offline | `ModelProviderError` (new, `openai.ts`) carries `provider`, `status`, `code`. OpenAI errors are classified on the CODE only (`insufficient_quota`, `invalid_api_key`). Workers AI errors keep the marker list with the numeric one ANCHORED: `/^\s*4006\b/` plus `daily free allocation` |
| 2 | Codex 2 | An upstream that echoes the request could put the API key in the error body, and truncation only moved it | `redact()` replaces every occurrence of the key with `[redacted]` across the WHOLE body, before parsing and before the 300-char cut |
| 3 | Codex 1, Claude 2 | One bucket for `gpt-5*` and the o-series. `reasoning_effort: 'minimal'` is not a legal o-series value (it takes low/medium/high), so `OPENAI_TEXT_MODEL=o3-mini` would 400 on every vote and every judge call. `gpt-5-chat*` was in the same bucket and is the exact opposite: it takes temperature and rejects reasoning_effort | `familyOf()` returns `gpt-5-reasoning` / `o-series` / `chat`. Reasoning GPT-5: no temperature, configured effort. o-series: no temperature, no effort at all. Chat (`gpt-4.1*`, `gpt-4o*`, `gpt-5-chat*`): temperature through, no effort. The effort value is now the `OPENAI_REASONING_EFFORT` var (default `minimal`), so it is policy and not a literal |
| 4 | Claude 1 | On OpenAI `visionModelFallback` IS `visionModel`, and an errored rung reports verdict `empty`, so the ladder skipped rung 2 (nothing to reword) AND rung 3 (ids match) and made ONE call. One transient 429 benched a bot for the round, silently, since a rate limit is deliberately not a wall | When the two ids match, the last rung becomes one plain retry of the same model, taken ONLY when nothing came back at all. A refusal or a labelling trip is a content verdict the same model would repeat, so it does not earn a retry. Two distinct ids behave exactly as before |
| 5 | Codex 4, Claude 4 + 5 | The missing-key warning fired on every `modelProvider()` call (measured 5 for 5), and an `AI_PROVIDER` typo like `open-ai` was completely silent while landing the game back on the exhausted free allowance | Two module-level latches: once per isolate for the missing key, once per isolate for an unknown provider value. An unset var still says nothing, because that is the zero-config default |
| 6 | Claude 7 | The `strict: false` comment claimed the schemas lacked required keys. They do not: all three list every key in `required` | Comment corrected: the only missing piece is `additionalProperties: false`. Schemas deliberately unchanged, because a strict schema OpenAI rejects is a 400, which is a bot that never votes |

Claude review 6 (`generateBotCaption` calling the same model twice on OpenAI) is answered rather than
changed: after fix 4 that second call IS a legitimate retry. The smoke JSON still reports `provider`,
and a comment in `bots.ts` now says so, so a later round does not "fix" it back.

### Files touched in this round

| File | Change |
|---|---|
| `src/worker/openai.ts` | `ModelProviderError`, `DEFAULT_REASONING_EFFORT`, `familyOf()` + `ModelFamily`, `redact()`, `parseError()` (replaces `errorDetail`), `requestBodyFor(model, input, reasoningEffort)`, `OpenAiModelOptions.reasoningEffort` |
| `src/worker/bots.ts` | `isAiOfflineError` split into structured vs string classifier, `4006` anchored; the same-id retry rung in `composeBotCaption`; comment on `generateBotCaption`'s loop |
| `src/worker/env.ts` | `Env.OPENAI_REASONING_EFFORT`, `Settings.openaiReasoningEffort`, effort passed to `makeOpenAiModel`, two warn latches, unknown-provider warning |
| `wrangler.jsonc` | `OPENAI_REASONING_EFFORT: "minimal"` plus the comment saying which family it reaches |
| `README.md` | the new var in the config table; the "which models answer" section rewritten from two differences to three (ladder, code-based classification, per-family bodies) |
| `tests/openai.test.ts` | per-family body table (gpt-5-mini, gpt-5-chat-latest, o3-mini, gpt-4.1-mini) replaces the test that asserted the WRONG o3-mini body; configured-effort test; two redaction tests; structured-error assertions; a no-code 502 test; three warn-once tests using a fresh module registry |
| `tests/bots.test.ts` | the `4006` anchor (`Error 4006` is now false, and Codex's 502 repro is asserted false); the OpenAI classifier tests rewritten onto `ModelProviderError`; a new `the caption ladder on a single-vision-model provider` describe with the retry, the no-retry-on-refusal case, and the two-distinct-ids case |

### The weak test that was locking in a bug

`tests/openai.test.ts` asserted `reasoning_effort === 'minimal'` for `o3-mini`. A fake fetch cannot
refuse a body, so the test proved the code emitted what the code intended, and it would have stayed
green while every live text call returned 400. That is the shape to watch for in this suite: a
translation test can only prove what goes on the wire, never that the far end accepts it. The
per-family expectations are still grade C for the same reason.

### Verification (run 2026-09-08 in `caption-wars`, exit 0)

```
npm run typecheck && npm test && npm run check:xss && npm run build

> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.worker.json     (no output)
> vitest run
   Test Files  12 passed (12)
        Tests  353 passed (353)                     (was 341)
> node --test tests/agent-lib.test.mjs tests/agent-flow.test.mjs
   # pass 37   # fail 0
> ! grep -rnE 'innerHTML|outerHTML|...' src/client                          (exit 0)
> vite build
   dist/client/index.html                  0.60 kB
   dist/client/assets/index-BFQTbJRU.css   7.07 kB
   dist/client/assets/index-BJlFmT7Y.js   26.57 kB
   built in 122ms
```

Grade A. No network call, no paid API call, and no OpenAI endpoint was contacted in this round either.

### Still open after this round (unchanged by these fixes)

1. **Nothing has run against the real OpenAI API.** Claude review 3 is a process finding, not a code
   bug, and it stands: `wrangler.jsonc` ships `AI_PROVIDER: "openai"`, so the next deploy moves every
   AI player onto a path with zero live evidence. The gate is `wrangler secret put OPENAI_API_KEY`,
   deploy, `npm run ai:smoke` showing `provider: "openai"` with `vision.ok` and `text.ok` both true,
   then one real round through the room URL. Until then the status line is "built, unverified live".
2. **The two default model ids and the whole family table are grade C.** Published behaviour, never
   measured on this key.
3. **Base64 tail cost** (Claude review 8): four bots each encode the same 1 MB photo independently in
   one alarm batch, about 68 ms CPU on the free plan. Not touched, because the common case is an
   800x600 photo at 50-150 KB and `detail: 'low'` crops to 512x512 anyway. Encoding once per round
   and sharing it is the cheap win if the ceiling ever bites.
4. **Rule 58's `ai:try` bar has to be re-measured on OpenAI from scratch.** The p10 refusal and
   on-photo rates were taken on Workers AI models and do not transfer.

---

## Fix round 2

Date: 2026-09-08, same branch, same day. A second Codex CLI pass came back FIX-FIRST with five
numbered must-fixes, three of them re-opening round 1 fixes that were incomplete rather than wrong.
All five are applied. Nothing committed, nothing deployed, git untouched apart from `git add -A .`.

### What changed, in one paragraph

Round 1 fixed the right things and stopped one step short on three of them. The key was scrubbed out
of the raw error body but not out of the fields decoded FROM it, so a `sk-...` escape walked
straight past. The retry ladder was documented as two rungs and enforced by reading a verdict, which
counts nothing, so refusal then error then retry spent three paid calls. And the reasoning-effort dial
still guessed: `minimal` as a default is illegal on `gpt-5.1`, so a deploy that changed only the model
id would 400 every vote. The two new findings are about telling a platform limit apart from a bad
model: OpenAI declines in a `refusal` field the adapter never read (so a refusal arrived as an empty
answer), and the tuning rig's 160-call cap is three times Cloudflare Free's 50-subrequest ceiling, so
a run would report exhaustion as a model-quality number.

### The five fixes

| # | What was wrong | What it does now |
|---|---|---|
| 1 | `parseError` redacted the RAW body, then `JSON.parse` DECODED `sk-test-not-a-real-key` back into the whole key and put it in the Error message, which `bots.ts` logs. The two round-1 tests only used a literal key | `code` and `message` are each redacted AGAIN after decoding, before either can reach the message. Two tests, one for an escaped key in `message` and one in `code` |
| 2 | `OPENAI_REASONING_EFFORT` defaulted to `minimal`. That is a guess about an id nobody here has called: `gpt-5.1` accepts none/low/medium/high and REJECTS `minimal`, so pointing the var at it would 400 every vote and every judge call, and the judge would fail open forever | The default is EMPTY. `reasoning_effort` goes out only when the var is non-empty AND the model is a reasoning id (`/^gpt-5/` minus `gpt-5-chat*`, or `/^o\d/`). Temperature rule unchanged: dropped for those two families, passed through for chat |
| 3 | The same-id retry checked `last.verdict === 'empty'`, which describes the last rung and counts nothing. Refusal (rung 1) then a transient error (rung 2, reports `empty`) unlocked rung 3: three paid calls on a ladder whose own doc comment says two | A call counter, `SAME_ID_MAX_CALLS = 2`. When `visionModelFallback === visionModel` the ladder dispatches at most two vision calls whatever the verdicts. A count cannot be talked round by a verdict |
| 4 | The adapter read only `choices[0].message.content`. OpenAI declines with `content: null` and the reason in a separate `refusal` field, so a refusal became `{ response: '' }`: the ladder read that as "told us nothing", skipped its lighter prompt and re-sent the prompt the model had just declined | A non-empty `refusal` is returned as the response, so the caption guard and the ladder both see a refusal for what it is |
| 5 | `AI_TRY_MAX_MODEL_CALLS` was 160. Cloudflare Free allows 50 external subrequests per Worker invocation and on this provider every model call is one, as is every photo fetch and redirect. A `{"photos":6}` run needs 78 calls, so it would die on the platform and report the deaths as failed captions with `truncated:false` | Cap set to 40 (10 left for photo fetches and redirects), and `ai-try.ts` wraps the model with a watcher: an error matching `/subrequest/i` is recorded once in a new `limitErrors` array and forces `summary.truncated: true`. The rig cannot report a platform limit as a model number |

The rig itself was NOT rebuilt, per instruction. Fix 5 is a cap change plus a 15-line watcher.

### Files touched in this round

| File | Change |
|---|---|
| `src/worker/openai.ts` | `DEFAULT_REASONING_EFFORT` is now `''`; `parseError` re-redacts decoded `code` and `message`; `requestBodyFor` sends `reasoning_effort` only on non-empty config AND a reasoning family; response parsing reads `message.refusal` when `content` is empty |
| `src/worker/bots.ts` | `SAME_ID_MAX_CALLS = 2`, a `calls` counter in `composeBotCaption`, and the same-id retry gated on it. Ladder doc comment updated |
| `src/worker/ai-try.ts` | `watchForSubrequestLimit()`, `limitErrors` on `AiTryResult` and on the judge-audit response, and `truncated` now ORs it in |
| `wrangler.jsonc` | `OPENAI_REASONING_EFFORT` to `""` with a per-model-id table in the comment; `AI_TRY_MAX_MODEL_CALLS` `160` to `40` with the subrequest ceiling named |
| `README.md` | the effort var row rewritten as opt-in with the per-id legal values; the "which models answer" family paragraph rewritten to match |
| `scripts/ai-try.mjs` | header says use `--photos-per-call 2` on the free plan, and that a `limitErrors` / `truncated` run does not count |
| `tests/openai.test.ts` | two escaped-key redaction tests; the family table rebuilt as (model, configured effort) rows including `gpt-5.1` unset sends nothing / `gpt-5-mini` + `minimal` sends it / `gpt-4.1-mini` + `minimal` sends nothing; the settings default now asserts `''`; a new describe running the REAL adapter under the REAL ladder for the `refusal` field |
| `tests/bots.test.ts` | refusal-then-error stops at two calls; error-then-success still spends its second call and ships the caption; the distinct-ids case unchanged |

### One judgement call worth naming

Round 1 sent the o-series NO `reasoning_effort` at all, because `minimal` is illegal there. With the
value now opt-in that guard is unnecessary and would be wrong: an operator who deploys `o3-mini` sets
`low`, and refusing to send it would waste the dial. So the o-series is treated as a reasoning family
for both temperature and effort, and the legal values per id are documented in `wrangler.jsonc` and
the README instead of hardcoded. The protection that mattered (nothing is ever GUESSED) is now
structural rather than per-family.

### Verification (run 2026-09-08 in `caption-wars`, exit 0)

```
npm run typecheck && npm test && npm run check:xss && npm run build

> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.worker.json     (no output)
> vitest run
   Test Files  12 passed (12)
        Tests  359 passed (359)                     (was 353)
> node --test tests/agent-lib.test.mjs tests/agent-flow.test.mjs
   # pass 37   # fail 0
> ! grep -rnE 'innerHTML|outerHTML|...' src/client                          (exit 0)
> vite build
   dist/client/index.html                  0.60 kB
   dist/client/assets/index-BFQTbJRU.css   7.07 kB
   dist/client/assets/index-BJlFmT7Y.js   26.57 kB
   built in 144ms
```

Plus a local JSONC parse of `wrangler.jsonc` confirming the new comment block still parses and that
the two changed vars read back as `""` and `40`. Grade A. No network call, no paid API call, and no
OpenAI endpoint was contacted in this round either.

### Still open after this round

1. **Nothing has run against the real OpenAI API.** Unchanged and still the gate:
   `wrangler secret put OPENAI_API_KEY`, deploy, `npm run ai:smoke` showing `provider: "openai"` with
   `vision.ok` and `text.ok` true, then one real round through the room URL.
2. **The family table stays grade C.** A fake fetch cannot refuse a body. Fix 2 reduces the blast
   radius (the default now sends nothing anywhere) but does not measure anything.
3. **The 50-subrequest ceiling is grade B, `Too many subrequests` is grade C.** The 50 comes from
   Cloudflare's published limits page; the exact error string was not reproduced here, which is why
   the match is a loose case-insensitive `/subrequest/i`. If a live run hits it and `limitErrors`
   stays empty, that regex is the thing to check first.
4. **Rule 58's `ai:try` bar still has to be re-measured on OpenAI from scratch**, now in runs of
   `--photos-per-call 2`.

## Fix round 3

Reviewers: one fresh-context Claude adversarial pass (FIX-FIRST, 2 must-fixes, both reproduced) and
one Codex adversarial pass (FIX-FIRST, 1 must-fix). They agreed on the photo-side subrequest hole;
the other three items are one reviewer each. All four are applied. Nothing was deployed, no network
call was made, and no OpenAI endpoint was contacted in this round.

### What changed, in one paragraph

The API key could still reach a log on one branch nobody had covered: an error body that is valid
JSON but carries neither `error.code` nor `error.message` fell through to the RAW-body redaction,
where a JSON-escaped key matches nothing. That branch now redacts the DECODED object. The Workers AI
`4006` wall was anchored so tightly it no longer recognised its own binding's prefixed form. The
tuning rig's subrequest watcher covered model calls but not photo fetches, which come out of the same
50, so an exhausted run could still report itself complete. And the same-id ladder's call counter was
counting rungs the call budget had refused, spending a model call that never happened.

### The four fixes

| # | What was wrong | What it does now |
|---|---|---|
| 1 | `parseError`'s third branch reported the raw-redacted body, so an escaped key in any field other than `code`/`message` survived into the thrown message that `bots.ts` prints | After a successful parse with neither field present, the fallback is `redact(JSON.stringify(parsed))`: every field of the DECODED object goes through the redactor |
| 2 | `/^\s*4006\b/` made `InferenceUpstreamError: 4006: account quota reached` a hiccup, so the bots would retry the wall every round and the room would never say it was offline | `/(^|\W)4006:/`. The COLON is what keeps it narrow: `request id 4006` mid-sentence still reads false |
| 3 | A photo fetch dying with `Too many subrequests` landed in `photoErrors` and the run reported `truncated: false`: infrastructure exhaustion reported as a valid measurement | The photo catch runs the same `/subrequest/i` test through a shared `noteIfSubrequestLimit`, so either door fills `limitErrors` and forces `truncated: true` |
| 4 | `calls += 1` ran before `runVisionOnce`, which refuses inside `budget.reserve()`, so a refused rung ate one of the ladder's two same-id calls | The counter increments only when the budget's refusal count did not move across the call |

Two defaults were realigned with their own documentation at the same time: `AI_TRY_MAX_MODEL_CALLS`
in `src/shared/config.ts` (and the README table) is 40, not 160, because the code default is what
fires if the var is ever absent and 160 is over three times the free plan's 50-subrequest ceiling;
and `scripts/ai-try.mjs` defaults `photosPerCall` to 2, the number its own header tells you to use.

### Files touched in this round

| File | Change |
|---|---|
| `src/worker/openai.ts` | third-branch fallback redacts the decoded object |
| `src/worker/bots.ts` | `4006` regex, its header comment, and the ladder counter |
| `src/worker/ai-try.ts` | `noteIfSubrequestLimit` extracted; photo catch classifies through it |
| `src/shared/config.ts` | `AI_TRY_MAX_MODEL_CALLS` 160 -> 40, with the why on the line above |
| `scripts/ai-try.mjs` | `photosPerCall` default 3 -> 2 |
| `README.md` | the `AI_TRY_MAX_MODEL_CALLS` default column |
| `tests/openai.test.ts` | escaped-key and literal-key bodies with no code and no message |
| `tests/bots.test.ts` | prefixed `4006` is the wall; two ladder-counter cases |
| `tests/ai-try.test.ts` | model-side ceiling, photo-side ceiling, and a plain 404 that is neither |

### Every new test was mutation-checked

Each fix was reverted in place and its test file re-run. All four went red, so none of the seven new
tests is decorative. This is the check that round 2's own subrequest fix failed (its mutation
survived 359/359), which is why it is now part of the round.

| Fix reverted to | Result |
|---|---|
| `detail = safe` | 1 failed / 32 passed |
| `/^\s*4006\b/` | 1 failed / 68 passed |
| photo catch without `noteIfSubrequestLimit` | 1 failed / 10 passed |
| `calls += 1` before the call | 1 failed / 68 passed |

### Verification (run 2026-09-08 in `caption-wars`, exit 0)

```
npm run typecheck && npm test && npm run check:xss && npm run build

> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.worker.json     (no output)
> vitest run
   Test Files  12 passed (12)
        Tests  366 passed (366)                     (was 359)
> node --test tests/agent-lib.test.mjs tests/agent-flow.test.mjs
   # pass 37   # fail 0
> ! grep -rnE 'innerHTML|outerHTML|...' src/client                          (exit 0)
> vite build
   dist/client/index.html                  0.60 kB
   dist/client/assets/index-BFQTbJRU.css   7.07 kB
   dist/client/assets/index-BJlFmT7Y.js   26.57 kB
   built in 99ms
```

Grade A for this build. No network call, no paid API call.

### Still open after this round

1. **Nothing has run against the real OpenAI API.** Unchanged and still the gate:
   `wrangler secret put OPENAI_API_KEY`, deploy, `npm run ai:smoke` showing `provider: "openai"` with
   `vision.ok` and `text.ok` true, then one real round through the room URL.
2. **The family table stays grade C.** A fake fetch cannot refuse a body.
3. **`Too many subrequests` is still grade C.** The string was not reproduced against the live
   runtime; both doors match it with the same loose `/subrequest/i`. If a live run exhausts the
   ceiling and `limitErrors` stays empty, that regex is the one thing to check.
4. **Rule 58's `ai:try` bar still has to be re-measured on OpenAI from scratch**, in runs of
   `--photos-per-call 2` (now the default).
5. **Not raised as a defect, worth a later look:** `scripts/ai-smoke.mjs` prints the provider but
   does not assert it, so a silent fallback to Workers AI passes smoke whenever the free allowance
   happens to be intact.
