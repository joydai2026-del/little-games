// The Worker's bindings and configuration.
//
// Everything tunable is a wrangler `var` (a string, because that is what
// wrangler vars are) with a typed default in src/shared/config.ts. Nothing in
// game logic reads a literal: `settings()` turns the raw strings into numbers
// once per request, falling back to the shared default when a var is missing or
// nonsense. That is the house rule "anything that could change is config".
//
// This file is deliberately the only place in the worker that mentions
// Cloudflare binding types, so photo.ts / bots.ts / schedule.ts stay importable
// from the vitest suite with no Cloudflare runtime.

import type { AiLike } from './bots';
import { DEFAULT_REASONING_EFFORT, makeOpenAiModel } from './openai';
import {
  AI_TRY_MAX_MODEL_CALLS,
  AI_TRY_MAX_SAMPLES,
  BOT_TIMEOUT_MS,
  CAPTION_JUDGE_TIMEOUT_MS,
  CAPTION_MAX_CHARS,
  PHOTO_MAX_BYTES,
  PHOTO_TIMEOUT_MS,
  REVEAL_MIN_MS,
  VISION_MAX_BYTES,
} from '../shared/config';

export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  ROOMS: DurableObjectNamespace;

  PHOTO_TAGS: string;
  PHOTO_WIDTH: string;
  PHOTO_HEIGHT: string;
  PHOTO_MAX_BYTES: string;
  PHOTO_TIMEOUT_MS: string;
  VISION_MAX_BYTES: string;
  VISION_MODEL: string;
  VISION_MODEL_FALLBACK: string;
  TEXT_MODEL: string;

  /**
   * WHICH provider runs the AI players: `workers-ai` (the zero-config default)
   * or `openai`. It is a var and not a literal because the free Workers AI
   * allowance is a wall the game meets every day (rule 55), and swapping the
   * provider must never be a code change. See `modelProvider` below.
   */
  AI_PROVIDER: string;
  OPENAI_BASE_URL: string;
  OPENAI_VISION_MODEL: string;
  OPENAI_TEXT_MODEL: string;
  /**
   * How hard a reasoning GPT-5 model may think before it answers
   * (`minimal` | `low` | `medium` | `high`). A var and not a literal because it
   * is a cost / quality dial, and the right value depends on which model id the
   * other two vars point at (review round 1 on this branch, must-fix 3).
   */
  OPENAI_REASONING_EFFORT: string;
  /** wrangler secret, set with `npx wrangler secret put OPENAI_API_KEY`. Absent = Workers AI. */
  OPENAI_API_KEY?: string;

  BOT_TIMEOUT_MS: string;
  CAPTION_JUDGE_TIMEOUT_MS: string;
  REVEAL_MIN_MS: string;
  AI_TRY_MAX_SAMPLES: string;
  AI_TRY_MAX_MODEL_CALLS: string;

  /**
   * Cloudflare's rate-limit binding, capping how many rooms one IP can create
   * (review round 8, should-fix 4). Configured in wrangler.jsonc, so the numbers
   * are policy rather than source. OPTIONAL on purpose: the worker must run
   * without it (the vitest suite builds an Env by hand, and an environment that
   * has not got the binding yet should degrade to today's behaviour rather than
   * throw on every room creation).
   */
  ROOM_CREATE_LIMITER?: RateLimit;

  /** wrangler secret, set with `npx wrangler secret put SMOKE_TOKEN`. Absent = /api/ai-smoke is off. */
  SMOKE_TOKEN?: string;
}

export type AiProvider = 'workers-ai' | 'openai';

export interface Settings {
  /** Which provider actually answers, once the key has been checked for. */
  provider: AiProvider;
  photoTags: string[];
  photoWidth: number;
  photoHeight: number;
  photoMaxBytes: number;
  photoTimeoutMs: number;
  visionMaxBytes: number;
  visionModel: string;
  visionModelFallback: string;
  textModel: string;
  /** See Env.OPENAI_REASONING_EFFORT. Ignored unless the provider is `openai`. */
  openaiReasoningEffort: string;
  botTimeoutMs: number;
  captionJudgeTimeoutMs: number;
  revealMinMs: number;
  captionMaxChars: number;
  aiTryMaxSamples: number;
  aiTryMaxModelCalls: number;
}

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function str(raw: string | undefined, fallback: string): string {
  const s = (raw ?? '').trim();
  return s.length > 0 ? s : fallback;
}

/** Defaults that only exist as wrangler vars (there is no game logic that needs them elsewhere). */
// Must stay the same list as PHOTO_TAGS in wrangler.jsonc, where the content
// policy behind it is written down (review round 6: `party` and `costume` were
// dropped for returning sexualised photos, every replacement was audited live;
// review round 7 dropped `statue` after a 7th draw returned a full-frontal
// museum nude, as the safe default pending JJ's call).
const DEFAULT_TAGS = 'dog,cat,funny,awkward,baby,goat,fail,duck,pigeon,squirrel,cake,derp,messy,raccoon,hamster,frog,monkey,sloth,otter,cow,sheep,lego,donut';
const DEFAULT_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DEFAULT_VISION_MODEL_FALLBACK = '@cf/llava-hf/llava-1.5-7b-hf';
const DEFAULT_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Grade C: not measured on this account. JJ changes them in wrangler.jsonc.
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4.1-mini';
const DEFAULT_OPENAI_TEXT_MODEL = 'gpt-4.1-mini';

/**
 * The provider decision, and the ONE place it is made: `openai` only when the
 * var asks for it AND the key exists. A deploy that sets AI_PROVIDER=openai and
 * forgets `wrangler secret put OPENAI_API_KEY` degrades to Workers AI rather
 * than turning every bot into an error, which is the same fail-soft shape rule
 * 38(a) picks everywhere else in this game.
 */
/**
 * ONCE PER ISOLATE, not once per call. `modelProvider` runs on every bot batch,
 * every smoke request and every tuning run, so an unlatched warn is the same
 * line forever in `wrangler tail` (Codex review 4, Claude review 4: measured at
 * 5 warns for 5 calls). Module scope is the isolate's lifetime, which is the
 * scope the README and wrangler.jsonc already claim.
 */
let warnedMissingKey = false;
let warnedUnknownProvider = false;

function resolveProvider(env: Env): AiProvider {
  const asked = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (asked !== 'openai') return 'workers-ai';
  return (env.OPENAI_API_KEY ?? '').trim().length > 0 ? 'openai' : 'workers-ai';
}

/**
 * Which binding the bots call, and under which model ids. Every site that builds
 * a `BotModels` goes through here (room-do.ts `botModels`, smoke.ts, ai-try.ts),
 * so there is exactly one answer to "who is answering" in the worker.
 *
 * OpenAI has no second vision model to fall back to, so the fallback IS the
 * primary. `composeBotCaption` handles that case explicitly: when the two ids
 * match, the last rung becomes ONE plain retry of the same model, taken only
 * when nothing came back at all. Before that (Claude review 1) the ladder
 * collapsed to a single call here, so one transient 429 benched the bot for the
 * round with no message to anyone.
 */
export function modelProvider(env: Env): {
  provider: AiProvider;
  ai: AiLike;
  visionModel: string;
  visionModelFallback: string;
  textModel: string;
} {
  const asked = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  const provider = resolveProvider(env);

  // A TYPO IS SILENT OTHERWISE (Claude review 5). `AI_PROVIDER=open-ai` with a
  // valid key landed the game back on the exhausted free allowance with no
  // signal anywhere, which is the exact problem this provider exists to solve.
  // An unset var is the zero-config default and says nothing.
  if (asked.length > 0 && asked !== 'openai' && asked !== 'workers-ai' && !warnedUnknownProvider) {
    warnedUnknownProvider = true;
    console.warn(
      `env: AI_PROVIDER=${asked} is not a provider (expected openai or workers-ai); using Workers AI`
    );
  }

  if (provider === 'openai') {
    const visionModel = str(env.OPENAI_VISION_MODEL, DEFAULT_OPENAI_VISION_MODEL);
    return {
      provider,
      ai: makeOpenAiModel({
        apiKey: (env.OPENAI_API_KEY ?? '').trim(),
        reasoningEffort: str(env.OPENAI_REASONING_EFFORT, DEFAULT_REASONING_EFFORT),
        ...(str(env.OPENAI_BASE_URL, '').length > 0 ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
      }),
      visionModel,
      visionModelFallback: visionModel,
      textModel: str(env.OPENAI_TEXT_MODEL, DEFAULT_OPENAI_TEXT_MODEL),
    };
  }

  if (asked === 'openai' && !warnedMissingKey) {
    warnedMissingKey = true;
    console.warn('env: AI_PROVIDER=openai but OPENAI_API_KEY is not set; falling back to Workers AI');
  }
  const set = settings(env);
  return {
    provider,
    ai: env.AI as unknown as AiLike,
    visionModel: set.visionModel,
    visionModelFallback: set.visionModelFallback,
    textModel: set.textModel,
  };
}

export function settings(env: Env): Settings {
  const tags = str(env.PHOTO_TAGS, DEFAULT_TAGS)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return {
    provider: resolveProvider(env),
    photoTags: tags.length > 0 ? tags : DEFAULT_TAGS.split(','),
    photoWidth: num(env.PHOTO_WIDTH, 800),
    photoHeight: num(env.PHOTO_HEIGHT, 600),
    photoMaxBytes: num(env.PHOTO_MAX_BYTES, PHOTO_MAX_BYTES),
    photoTimeoutMs: num(env.PHOTO_TIMEOUT_MS, PHOTO_TIMEOUT_MS),
    visionMaxBytes: num(env.VISION_MAX_BYTES, VISION_MAX_BYTES),
    visionModel: str(env.VISION_MODEL, DEFAULT_VISION_MODEL),
    visionModelFallback: str(env.VISION_MODEL_FALLBACK, DEFAULT_VISION_MODEL_FALLBACK),
    textModel: str(env.TEXT_MODEL, DEFAULT_TEXT_MODEL),
    openaiReasoningEffort: str(env.OPENAI_REASONING_EFFORT, DEFAULT_REASONING_EFFORT),
    botTimeoutMs: num(env.BOT_TIMEOUT_MS, BOT_TIMEOUT_MS),
    captionJudgeTimeoutMs: num(env.CAPTION_JUDGE_TIMEOUT_MS, CAPTION_JUDGE_TIMEOUT_MS),
    revealMinMs: num(env.REVEAL_MIN_MS, REVEAL_MIN_MS),
    captionMaxChars: CAPTION_MAX_CHARS,
    aiTryMaxSamples: num(env.AI_TRY_MAX_SAMPLES, AI_TRY_MAX_SAMPLES),
    aiTryMaxModelCalls: num(env.AI_TRY_MAX_MODEL_CALLS, AI_TRY_MAX_MODEL_CALLS),
  };
}
