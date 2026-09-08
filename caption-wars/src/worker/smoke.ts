// POST /api/ai-smoke: the deploy gate for the AI half of the game (plan
// amendment 4).
//
// The model ids in wrangler.jsonc are a guess until something actually calls
// them: `wrangler ai models list` fails on this account with auth code 10000,
// so the catalog cannot be checked locally. This endpoint is how the deployed
// Worker answers the question, on the real account, with the real binding.
//
// It runs a REAL photo (the bundled goat fixture, src/shared/fixture-photo.ts)
// through the vision model and a real JSON-mode ballot through the text model,
// and reports which model ids answered. No mock anywhere.
//
// Guarded by the wrangler secret SMOKE_TOKEN (header x-smoke-token). Unset
// secret = the endpoint is off (503), never open.

import { PERSONAS } from '../shared/personas';
import { fixturePhoto, FIXTURE_PHOTO_SHA256 } from '../shared/fixture-photo';
import { generateBotCaption, generateBotVote, type BotModels } from './bots';
import { modelProvider, settings, type Env } from './env';
import { secretsMatch } from './token';

export interface SmokeResult {
  /** Which provider actually answered: `workers-ai` or `openai`. */
  provider: string;
  vision: { model: string; fallback: string; ok: boolean; sample: string | null };
  text: { model: string; ok: boolean; picked: string | null };
  fixture: { sha256: string; bytes: number };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Meta's vision models require a one-time licence acceptance per account: send
 * `{ prompt: "agree" }` before the first real call
 * (developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/,
 * read 2026-09-07). Doing it here means the first bot of the first real game is
 * not the thing that discovers it.
 */
async function acceptMetaLicence(ai: BotModels['ai'], model: string): Promise<void> {
  try {
    await ai.run(model, { prompt: 'agree' });
  } catch (err) {
    console.warn('smoke: licence prompt failed', err instanceof Error ? err.message : err);
  }
}

export async function handleAiSmoke(request: Request, env: Env): Promise<Response> {
  const expected = env.SMOKE_TOKEN;
  if (!expected) {
    return json({ error: 'the smoke test is off: set the SMOKE_TOKEN secret first' }, 503);
  }
  if (!(await secretsMatch(request.headers.get('x-smoke-token'), expected))) {
    return json({ error: 'bad smoke token' }, 401);
  }

  const set = settings(env);
  // One place decides the provider; this is the second of the three BotModels
  // sites (room-do.ts botModels, here, ai-try.ts).
  const chosen = modelProvider(env);
  const models: BotModels = {
    ai: chosen.ai,
    visionModel: chosen.visionModel,
    visionModelFallback: chosen.visionModelFallback,
    textModel: chosen.textModel,
    timeoutMs: set.botTimeoutMs,
    judgeTimeoutMs: set.captionJudgeTimeoutMs,
    visionMaxBytes: set.visionMaxBytes,
  };

  // The licence handshake is a Workers AI thing (Meta's models on Cloudflare).
  // On OpenAI it would be one paid call that asks nothing.
  if (chosen.provider === 'workers-ai') {
    await acceptMetaLicence(models.ai, models.visionModel);
  }

  const bytes = fixturePhoto();
  const caption = await generateBotCaption(models, PERSONAS[0], bytes);

  const ballot = [
    { id: 'cap-a', text: 'The goat has seen things.' },
    { id: 'cap-b', text: 'Employee of the month, again.' },
  ];
  const picked = await generateBotVote(models, PERSONAS[1] ?? PERSONAS[0], ballot);

  const result: SmokeResult = {
    provider: chosen.provider,
    vision: {
      model: models.visionModel,
      fallback: models.visionModelFallback,
      ok: caption !== null,
      sample: caption,
    },
    text: { model: models.textModel, ok: picked !== null, picked },
    fixture: { sha256: FIXTURE_PHOTO_SHA256, bytes: bytes.byteLength },
  };

  return json(result, result.vision.ok && result.text.ok ? 200 : 502);
}
