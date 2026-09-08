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
  type BotModels,
  type CaptionAttempt,
} from './bots';
import { fetchPhoto } from './photo';
import { settings, type Env } from './env';

/** Hard cap: this is model spend, and a Worker has a subrequest budget. */
const MAX_PHOTOS = 10;
const DEFAULT_PHOTOS = 3;

export interface AiTrySample {
  photoSha: string;
  photoSource: string;
  photoBytes: number;
  persona: string;
  model: string;
  attempts: CaptionAttempt[];
  final: string | null;
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
  };
  photoErrors: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
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
  const expected = env.SMOKE_TOKEN;
  if (!expected) {
    return json({ error: 'ai-try is off: set the SMOKE_TOKEN secret first' }, 503);
  }
  if (request.headers.get('x-smoke-token') !== expected) {
    return json({ error: 'bad smoke token' }, 401);
  }

  let body: { photos?: number; personas?: string[] } = {};
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }

  const wanted = Number(body.photos);
  const photoCount = Math.min(
    MAX_PHOTOS,
    Math.max(1, Number.isFinite(wanted) ? Math.trunc(wanted) : DEFAULT_PHOTOS)
  );
  const personas: Persona[] =
    Array.isArray(body.personas) && body.personas.length > 0
      ? PERSONAS.filter((p) => body.personas!.includes(p.id) || body.personas!.includes(p.name))
      : PERSONAS;
  if (personas.length === 0) {
    return json({ error: `no persona matched; ids are ${PERSONAS.map((p) => p.id).join(', ')}` }, 400);
  }

  const set = settings(env);
  const models: BotModels = {
    ai: env.AI as unknown as BotModels['ai'],
    visionModel: set.visionModel,
    visionModelFallback: set.visionModelFallback,
    textModel: set.textModel,
    timeoutMs: set.botTimeoutMs,
    visionMaxBytes: set.visionMaxBytes,
  };

  const samples: AiTrySample[] = [];
  const photoErrors: string[] = [];

  for (let i = 0; i < photoCount; i++) {
    let photo;
    try {
      photo = await fetchPhoto(set, seedCode(), i + 1);
    } catch (err) {
      photoErrors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    if (photo.bytes.byteLength > set.visionMaxBytes) {
      photoErrors.push(`photo ${photo.meta.sha256.slice(0, 8)} is over the vision byte cap`);
      continue;
    }

    // The personas for one photo run together: same picture, four voices, which
    // is exactly the shape of a real round.
    const forPhoto = await Promise.all(
      personas.map(async (persona) => {
        const { attempts, final } = await composeBotCaption(models, persona, photo.bytes);
        return {
          photoSha: photo.meta.sha256,
          photoSource: photo.meta.source,
          photoBytes: photo.meta.bytes,
          persona: persona.name,
          model: models.visionModel,
          attempts,
          final,
        } satisfies AiTrySample;
      })
    );
    samples.push(...forPhoto);
  }

  const firstAttempt: Record<string, number> = { ok: 0, refusal: 0, labelling: 0, empty: 0 };
  let labellingAnywhere = 0;
  for (const sample of samples) {
    const first = sample.attempts[0];
    if (first) firstAttempt[first.verdict] = (firstAttempt[first.verdict] ?? 0) + 1;
    if (sample.attempts.some((a) => a.verdict === 'labelling')) labellingAnywhere += 1;
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
    },
    photoErrors,
  };

  return json(result, samples.length > 0 ? 200 : 502);
}
