// POST /api/ai-try: the prompt tuning rig (review round 4, must-fix 3).
//
// `ai-smoke` answers "is the AI binding alive". This answers the different and
// much more important question: WHAT DO THE BOTS ACTUALLY WRITE, on real photos,
// through the real pipeline. It exists because three review rounds tuned the
// caption prompt and the content guard with nobody ever reading the models'
// output, and the live game then shipped these to players AS CAPTIONS:
//
//   "Black people just standing there."
//   "I cannot write a caption that makes a joke at the expense of a dog."
//   "The party game photo shows a man wearing a suit and tie..."
//   "A globe is in a city."
//
// So: real photos through the real `fetchPhoto`, real personas, the real
// `composeBotCaption` ladder, and every attempt reported verbatim with its
// verdict. `scripts/ai-try.mjs` calls this and prints the rates. The rates the
// shipped prompt produced are recorded in the plan as the bar any future prompt
// edit has to clear.
//
// Guarded by the same SMOKE_TOKEN secret as ai-smoke: unset = off (503), never
// open. It costs real model calls, so it is never reachable from the game.

import { PERSONAS, type Persona } from '../shared/personas';
import {
  CAPTION_PROMPT_VERSION,
  composeBotCaption,
  describePhoto,
  judgeIsCaption,
  judgeRelevance,
  makeCallBudget,
  type AiLike,
  type CaptionJudgeVerdict,
  type BotModels,
  type CaptionAttempt,
  type RelevanceVerdict,
} from './bots';
import { refusalMatch } from '../shared/caption-guard';
import { fetchPhoto } from './photo';
import { modelProvider, settings, type Env } from './env';
import { secretsMatch } from './token';

/** Hard cap: this is model spend, and a Worker has a subrequest budget. */
const MAX_PHOTOS = 10;
const DEFAULT_PHOTOS = 3;

/**
 * A tag override is an operator-supplied string that ends up in an outbound URL,
 * so it is validated rather than trusted: lower-case letters, digits and hyphens,
 * short, and at most this many of them. See the tag policy in the README.
 */
const TAG_RE = /^[a-z0-9-]{1,24}$/;
const MAX_TAGS = 12;

/** How many strings one judge-audit request may check. Each one is a model call. */
const MAX_JUDGE_TEXTS = 30;

export interface AiTrySample {
  photoSha: string;
  photoSource: string;
  photoBytes: number;
  /**
   * What the VISION model says is in this photo, in one sentence, from a plain
   * "describe this photo" prompt. It is the evidence behind `relevance`: a rate
   * with no descriptions under it would be a number nobody could check.
   */
  photoDescription: string | null;
  persona: string;
  model: string;
  attempts: CaptionAttempt[];
  final: string | null;
  /** Is the delivered caption about THIS photo? Tuning only. See judgeRelevance. */
  relevance: RelevanceVerdict;
  /** The tag the photo host was asked for, when the request overrode PHOTO_TAGS. */
  photoTag?: string;
}

export interface AiTryResult {
  prompt_version: string;
  photos: number;
  samples: AiTrySample[];
  /** Counted over SAMPLES (one per photo x persona), on the FIRST attempt of each. */
  summary: {
    samples: number;
    first_attempt: Record<string, number>;
    final_ok: number;
    final_failed: number;
    labelling_anywhere: number;
    /** on-photo / off-photo / unknown, counted over the samples that produced a caption. */
    relevance: Record<string, number>;
    /** Every model call this request made, so the spend is visible in the answer. */
    model_calls: number;
    /** The ceiling those calls were reserved against. */
    model_call_cap: number;
    /**
     * Model calls the cap REFUSED, plus whether this request stopped early
     * because of it (round 8, Claude nit 1). `model_calls === model_call_cap` is
     * not evidence of truncation on its own: a request whose last call lands
     * exactly on the cap measured everything it set out to measure. `truncated`
     * is the honest flag, and `ai:try` fails on THAT.
     */
    model_calls_refused: number;
    truncated: boolean;
    /**
     * Captions the fast-path regex passed and the caption JUDGE then rejected
     * (round 6). This is the number that says whether the judge is earning its
     * one extra text call per caption.
     */
    judge_rejected: number;
    judge_verdicts: Record<string, number>;
  };
  photoErrors: string[];
  /**
   * The PLATFORM said stop, not the model. See watchForSubrequestLimit: at most
   * one entry, and any entry also sets `summary.truncated`, so a run that ran
   * out of subrequests can never be read as a model-quality measurement.
   */
  limitErrors: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * THE PLATFORM CEILING, TOLD APART FROM A BAD MODEL (Codex review round 2,
 * must-fix 5). Cloudflare's free plan allows 50 external subrequests per Worker
 * invocation (grade B, developers.cloudflare.com/workers/platform/limits/), and
 * on the OpenAI provider every model call is one of them, as is every photo
 * fetch and every redirect it follows. Past the ceiling the runtime throws, the
 * ladder swallows it as "this rung told us nothing", and the rig would report
 * infrastructure exhaustion as a model-quality number: exactly the false reading
 * rule 58's acceptance bar would be set from. Recorded once and reported as
 * truncated instead. `Too many subrequests` is Cloudflare's live string (grade
 * C, not reproduced here), so the match is loose and case-insensitive.
 */
function noteIfSubrequestLimit(message: string, limitErrors: string[]): void {
  if (/subrequest/i.test(message) && limitErrors.length === 0) {
    limitErrors.push(`worker subrequest ceiling reached: ${message.slice(0, 200)}`);
  }
}

function watchForSubrequestLimit(ai: AiLike, limitErrors: string[]): AiLike {
  return {
    async run(model: string, input: unknown, options?: unknown): Promise<unknown> {
      try {
        return await ai.run(model, input, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        noteIfSubrequestLimit(message, limitErrors);
        throw err;
      }
    },
  };
}

/** A throwaway room code, so picsum's seed (and therefore the photo) differs per call. */
function seedCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function handleAiTry(request: Request, env: Env): Promise<Response> {
  // Its own method check as well as the router's (src/worker/index.ts). Two
  // lines, and the route stops depending on where it happens to be mounted.
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = env.SMOKE_TOKEN;
  if (!expected) {
    return json({ error: 'ai-try is off: set the SMOKE_TOKEN secret first' }, 503);
  }
  if (!(await secretsMatch(request.headers.get('x-smoke-token'), expected))) {
    return json({ error: 'bad smoke token' }, 401);
  }

  let body: {
    photos?: number;
    personas?: string[];
    tags?: string[];
    describeOnly?: boolean;
    judgeTexts?: string[];
  } = {};
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }

  const base = settings(env);

  // TAG VERIFICATION (review round 6, must-fix 3 / M4). PHOTO_TAGS is the game's
  // content policy: what the game PUTS ON THE SCREEN, which five review rounds
  // never looked at while spending their whole content budget on what the bots
  // WRITE. A tag is only worth shipping if photos of it are actually about that
  // subject and have no people-focused content in them, and the only way to know
  // that is to pull real photos for the tag and describe them. So this route
  // takes a tag override plus `describeOnly`, and the same command that tunes the
  // prompt also audits a candidate tag:
  //
  //   curl -X POST .../api/ai-try -H "x-smoke-token: $SMOKE_TOKEN" \
  //        -d '{"tags":["duck"],"photos":3,"describeOnly":true}'
  //
  // The override never touches the deployed PHOTO_TAGS: it is per request, so an
  // audit costs no redeploy and cannot leave the game pointed at a test tag.
  let tags: string[] | null = null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length === 0 || body.tags.length > MAX_TAGS) {
      return json({ error: `tags must be an array of 1 to ${MAX_TAGS} strings` }, 400);
    }
    const cleaned = body.tags.map((t) => String(t ?? '').trim().toLowerCase());
    const bad = cleaned.find((t) => !TAG_RE.test(t));
    if (bad !== undefined) {
      return json({ error: `tag ${JSON.stringify(bad)} is not [a-z0-9-]{1,24}` }, 400);
    }
    tags = cleaned;
  }
  const set = tags ? { ...base, photoTags: tags } : base;
  const describeOnly = body.describeOnly === true;

  const personas: Persona[] =
    Array.isArray(body.personas) && body.personas.length > 0
      ? PERSONAS.filter((p) => body.personas!.includes(p.id) || body.personas!.includes(p.name))
      : PERSONAS;
  if (personas.length === 0) {
    return json({ error: `no persona matched; ids are ${PERSONAS.map((p) => p.id).join(', ')}` }, 400);
  }

  // THE COST CAP (review round 5, should-fix). One valid-token call used to be
  // able to spend 10 photos x 4 personas x 3 ladder rungs with nothing bounding
  // it but the Worker's own subrequest budget, and round 5 added a description
  // call per photo and a judge call per caption on top. So the request is
  // clamped twice: by SAMPLES (photos x personas) and by a hard ceiling on model
  // calls that stops the loop wherever it has got to. Both are wrangler vars, so
  // a tuning session can raise them without a code change.
  const wanted = Number(body.photos);
  const asked = Math.max(1, Number.isFinite(wanted) ? Math.trunc(wanted) : DEFAULT_PHOTOS);
  const byCap = Math.max(1, Math.floor(set.aiTryMaxSamples / personas.length));
  const photoCount = describeOnly ? Math.min(MAX_PHOTOS, asked) : Math.min(MAX_PHOTOS, asked, byCap);

  // Third and last of the BotModels sites (room-do.ts botModels, smoke.ts,
  // here). The rig must measure the SAME provider the game plays on, or the
  // numbers it reports are about models nobody is running.
  const chosen = modelProvider(env);
  // Filled at most once, from either door: watchForSubrequestLimit on a model
  // call, or the photo-fetch catch below.
  const limitErrors: string[] = [];
  const models: BotModels = {
    ai: watchForSubrequestLimit(chosen.ai, limitErrors),
    visionModel: chosen.visionModel,
    visionModelFallback: chosen.visionModelFallback,
    textModel: chosen.textModel,
    timeoutMs: set.botTimeoutMs,
    judgeTimeoutMs: set.captionJudgeTimeoutMs,
    voteTemperature: set.botVoteTemperature,
    visionMaxBytes: set.visionMaxBytes,
  };

  // THE JUDGE AUDIT (review round 6). The judge is now the AUTHORITY on "is this
  // a caption" (see the header of src/shared/caption-guard.ts), so its verdicts
  // have to be checkable on demand rather than inferred from a game. Give it a
  // list of strings and it answers for each one, next to what the fast-path
  // regex said, on the deployed models:
  //
  //   curl -X POST .../api/ai-try -H "x-smoke-token: $SMOKE_TOKEN" \
  //        -d '{"judgeTexts":["I am an AI and I have no feelings.","Day four of the standoff."]}'
  //
  // The strings are DATA: they go to the judge as the text under test and never
  // as instructions (judgeIsCaption says so in its own prompt).
  if (body.judgeTexts !== undefined) {
    if (
      !Array.isArray(body.judgeTexts) ||
      body.judgeTexts.length === 0 ||
      body.judgeTexts.length > MAX_JUDGE_TEXTS
    ) {
      return json({ error: `judgeTexts must be an array of 1 to ${MAX_JUDGE_TEXTS} strings` }, 400);
    }
    const texts = body.judgeTexts.map((t) => String(t ?? '').slice(0, 300));
    const judgeBudget = makeCallBudget(set.aiTryMaxModelCalls);
    const verdicts: Array<{
      text: string;
      regex: string | null;
      judge: CaptionJudgeVerdict;
      ships: boolean;
    }> = [];
    for (const text of texts) {
      const regex = refusalMatch(text);
      // The JUDGE's timeout, not the bot job's (Codex round 7, should-fix 3).
      // The audit was waiting up to BOT_TIMEOUT_MS (20s) per string while the
      // game gives one judge call CAPTION_JUDGE_TIMEOUT_MS (10s), so the audit
      // was measuring a judge the game never runs.
      const judge = await judgeIsCaption(models, text, set.captionJudgeTimeoutMs, judgeBudget);
      verdicts.push({ text, regex, judge, ships: regex === null && judge === 'caption' });
    }
    return json({
      prompt_version: CAPTION_PROMPT_VERSION,
      model: models.textModel,
      judge: verdicts,
      summary: {
        model_calls: judgeBudget.used(),
        model_call_cap: judgeBudget.cap(),
        model_calls_refused: judgeBudget.refused(),
        truncated: judgeBudget.refused() > 0 || limitErrors.length > 0,
      },
      limitErrors,
    });
  }

  const samples: AiTrySample[] = [];
  const photoErrors: string[] = [];
  // Every model call below RESERVES a slot in this object before it happens
  // (Codex round 6, must-fix 1). The old counter was checked once per photo and
  // incremented after a `Promise.all` fan-out had already run, so a cap smaller
  // than one photo batch could be exceeded by a whole batch.
  const callBudget = makeCallBudget(set.aiTryMaxModelCalls);
  const spent = (): boolean => callBudget.used() >= callBudget.cap();
  // Set when the photo loop stops early because the cap is already reached. That
  // is a genuine truncation (photos this request meant to sample never happened)
  // even though no `reserve()` was refused to reach it.
  let stoppedAtCap = false;

  for (let i = 0; i < photoCount; i++) {
    if (spent()) {
      photoErrors.push(`stopped at the ${set.aiTryMaxModelCalls}-model-call cap for one request`);
      stoppedAtCap = true;
      break;
    }
    let photo;
    try {
      photo = await fetchPhoto(set, seedCode(), i + 1);
    } catch (err) {
      // THE CEILING HAS TWO DOORS (review round 3, must-fix on both reviewers'
      // lists). The watcher above wraps MODEL calls only, but photo fetches and
      // the redirects they follow come out of the same 50 subrequests, so an
      // exhausted run whose sixth PHOTO fetch is the one that dies used to land
      // here and be reported as `truncated: false`: exactly the false reading
      // the watcher exists to prevent, through the other door. Same test, same
      // list. An ordinary photo failure (a 404, a byte-cap trip) does not match
      // `/subrequest/i` and stays a plain photoError.
      const message = err instanceof Error ? err.message : String(err);
      noteIfSubrequestLimit(message, limitErrors);
      photoErrors.push(message);
      continue;
    }
    if (photo.bytes.byteLength > set.visionMaxBytes) {
      photoErrors.push(`photo ${photo.meta.sha256.slice(0, 8)} is over the vision byte cap`);
      continue;
    }

    // One plain description of this photo, shared by every persona's sample. It
    // is what makes `relevance` checkable by a human reading the table, and in
    // `describeOnly` mode it is the whole answer.
    const description = await describePhoto(models, photo.bytes, set.botTimeoutMs, callBudget);

    if (describeOnly) {
      samples.push({
        photoSha: photo.meta.sha256,
        photoSource: photo.meta.source,
        photoBytes: photo.meta.bytes,
        photoDescription: description,
        persona: '(describe only)',
        model: models.visionModel,
        attempts: [],
        final: null,
        relevance: 'unknown',
        ...(tags ? { photoTag: tags.join(',') } : {}),
      });
      continue;
    }

    // The personas for one photo run together: same picture, four voices, which
    // is exactly the shape of a real round. The shared budget is what keeps that
    // fan-out inside the cap: `reserve()` is synchronous, so every branch has
    // taken its slot before it awaits anything.
    const forPhoto = await Promise.all(
      personas.map(async (persona) => {
        const { attempts, final } = await composeBotCaption(models, persona, photo.bytes, {
          callBudget,
        });
        let relevance: RelevanceVerdict = 'unknown';
        if (final !== null && description !== null) {
          relevance = await judgeRelevance(models, description, final, set.botTimeoutMs, callBudget);
        }
        return {
          photoSha: photo.meta.sha256,
          photoSource: photo.meta.source,
          photoBytes: photo.meta.bytes,
          photoDescription: description,
          persona: persona.name,
          model: models.visionModel,
          attempts,
          final,
          relevance,
          ...(tags ? { photoTag: tags.join(',') } : {}),
        } satisfies AiTrySample;
      })
    );
    samples.push(...forPhoto);
  }

  const firstAttempt: Record<string, number> = { ok: 0, refusal: 0, labelling: 0, empty: 0 };
  const relevance: Record<string, number> = { 'on-photo': 0, 'off-photo': 0, unknown: 0 };
  const judgeVerdicts: Record<string, number> = {
    caption: 0,
    refusal: 0,
    description: 0,
    unknown: 0,
  };
  let labellingAnywhere = 0;
  let judgeRejected = 0;
  for (const sample of samples) {
    const first = sample.attempts[0];
    if (first) firstAttempt[first.verdict] = (firstAttempt[first.verdict] ?? 0) + 1;
    if (sample.attempts.some((a) => a.verdict === 'labelling')) labellingAnywhere += 1;
    if (sample.final !== null) relevance[sample.relevance] = (relevance[sample.relevance] ?? 0) + 1;
    for (const attempt of sample.attempts) {
      if (attempt.judge === null || attempt.judge === undefined) continue;
      judgeVerdicts[attempt.judge] = (judgeVerdicts[attempt.judge] ?? 0) + 1;
      if (attempt.judge === 'refusal' || attempt.judge === 'description') judgeRejected += 1;
    }
  }

  const result: AiTryResult = {
    prompt_version: CAPTION_PROMPT_VERSION,
    photos: photoCount,
    samples,
    summary: {
      samples: samples.length,
      first_attempt: firstAttempt,
      final_ok: samples.filter((s) => s.final !== null).length,
      final_failed: samples.filter((s) => s.final === null).length,
      labelling_anywhere: labellingAnywhere,
      relevance,
      model_calls: callBudget.used(),
      model_call_cap: callBudget.cap(),
      model_calls_refused: callBudget.refused(),
      truncated: stoppedAtCap || callBudget.refused() > 0 || limitErrors.length > 0,
      judge_rejected: judgeRejected,
      judge_verdicts: judgeVerdicts,
    },
    photoErrors,
    limitErrors,
  };

  if (samples.length > 0) return json(result, 200);
  // Nit: two different 502s used to be indistinguishable without reading the
  // body. `error` now names which one it is, because "every photo fetch failed"
  // and "the AI binding is dead" want completely different next steps.
  return json(
    {
      ...result,
      error:
        photoErrors.length > 0
          ? 'no samples: every photo fetch failed (see photoErrors)'
          : 'no samples: nothing was attempted, check the AI binding and the personas filter',
    },
    502
  );
}
