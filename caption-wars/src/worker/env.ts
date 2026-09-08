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

import {
  BOT_TIMEOUT_MS,
  CAPTION_MAX_CHARS,
  PHOTO_MAX_BYTES,
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
  VISION_MAX_BYTES: string;
  VISION_MODEL: string;
  VISION_MODEL_FALLBACK: string;
  TEXT_MODEL: string;
  BOT_TIMEOUT_MS: string;
  REVEAL_MIN_MS: string;

  /** wrangler secret, set with `npx wrangler secret put SMOKE_TOKEN`. Absent = /api/ai-smoke is off. */
  SMOKE_TOKEN?: string;
}

export interface Settings {
  photoTags: string[];
  photoWidth: number;
  photoHeight: number;
  photoMaxBytes: number;
  visionMaxBytes: number;
  visionModel: string;
  visionModelFallback: string;
  textModel: string;
  botTimeoutMs: number;
  revealMinMs: number;
  captionMaxChars: number;
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
const DEFAULT_TAGS = 'dog,cat,funny,awkward,party,baby,goat,costume,fail';
const DEFAULT_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DEFAULT_VISION_MODEL_FALLBACK = '@cf/llava-hf/llava-1.5-7b-hf';
const DEFAULT_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export function settings(env: Env): Settings {
  const tags = str(env.PHOTO_TAGS, DEFAULT_TAGS)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return {
    photoTags: tags.length > 0 ? tags : DEFAULT_TAGS.split(','),
    photoWidth: num(env.PHOTO_WIDTH, 800),
    photoHeight: num(env.PHOTO_HEIGHT, 600),
    photoMaxBytes: num(env.PHOTO_MAX_BYTES, PHOTO_MAX_BYTES),
    visionMaxBytes: num(env.VISION_MAX_BYTES, VISION_MAX_BYTES),
    visionModel: str(env.VISION_MODEL, DEFAULT_VISION_MODEL),
    visionModelFallback: str(env.VISION_MODEL_FALLBACK, DEFAULT_VISION_MODEL_FALLBACK),
    textModel: str(env.TEXT_MODEL, DEFAULT_TEXT_MODEL),
    botTimeoutMs: num(env.BOT_TIMEOUT_MS, BOT_TIMEOUT_MS),
    revealMinMs: num(env.REVEAL_MIN_MS, REVEAL_MIN_MS),
    captionMaxChars: CAPTION_MAX_CHARS,
  };
}
