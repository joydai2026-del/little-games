// The OpenAI model provider: the same `AiLike` the game already calls, wired to
// Chat Completions instead of the Workers AI binding.
//
// Why it exists. Cloudflare stays on the FREE plan (JJ's decision, 2026-09-08),
// and the free plan's Workers AI allowance is 10,000 neurons a day. On 2026-09-07
// the deployed worker was answering every model call with `4006: you have used up
// your daily free allocation`, which puts the AI players offline for most of
// every day. An OpenAI key runs the bots instead.
//
// WHICH provider runs them is config (AI_PROVIDER), decided in one place
// (`modelProvider` in src/worker/env.ts) and never in game logic. Everything
// below `AiLike` is unchanged: this module translates the two input shapes
// bots.ts already sends into one OpenAI request and hands back
// `{ response: <text> }`, which is a shape `textFromModel`, `parseJudgeVerdict`
// and `parseVoteAnswer` already read.
//
// No dependencies and no Cloudflare types on purpose: plain fetch, so the vitest
// suite drives this file with a fake `fetchImpl` and no Cloudflare runtime.

import type { AiLike } from './bots';

/** Chat Completions lives under this; a self-hosted or proxy base overrides it. */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * How hard a reasoning model is allowed to think before it answers. Policy, not
 * a literal: OPENAI_REASONING_EFFORT in wrangler.jsonc feeds this through
 * `modelProvider`.
 *
 * THE DEFAULT IS EMPTY, WHICH MEANS "SEND NOTHING" (Codex review round 2,
 * must-fix 2). It used to default to `minimal`, which is a GUESS about a model
 * id nobody here has called: `gpt-5.1` accepts none | low | medium | high and
 * rejects `minimal`, so the default alone would 400 every vote and every judge
 * call and the bots would never vote. The legal set differs per model id, so the
 * value is opt-in: whoever points OPENAI_TEXT_MODEL at a reasoning model sets
 * the effort that model accepts, and every other deploy never sends the field.
 */
export const DEFAULT_REASONING_EFFORT = '';

/**
 * A provider failure with its parts kept SEPARATE, so nothing downstream has to
 * sniff error TEXT to classify it. Codex review 3 reproduced the cost of
 * sniffing: `openai 502: upstream unavailable, request id 4006` was read as
 * Workers AI's quota wall and took every bot in the room offline for the rest of
 * the game. `code` is the machine-readable marker `isAiOfflineError` classifies
 * on; the message stays human-readable for the log and nothing else.
 */
export class ModelProviderError extends Error {
  readonly provider = 'openai' as const;
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, detail: string) {
    super(`openai ${status}: ${detail}`);
    this.name = 'ModelProviderError';
    this.status = status;
    this.code = code;
  }
}

export interface OpenAiModelOptions {
  apiKey: string;
  baseUrl?: string;
  /** See DEFAULT_REASONING_EFFORT. Only the reasoning GPT-5 family is sent it. */
  reasoningEffort?: string;
  /** Injected by the tests. The worker uses the runtime's own fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * `String.fromCharCode(...bytes)` on a whole photo is a crash, not a slow path:
 * VISION_MAX_BYTES is 1,000,000 and the argument list has a hard engine limit
 * well below that. So the binary string is built a chunk at a time.
 */
const B64_CHUNK = 0x8000;

function base64(bytes: number[]): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

/**
 * PNG's 8-byte signature. Photos come from loremflickr and picsum as JPEG (see
 * src/worker/photo.ts), so JPEG is the default and this only exists so a PNG is
 * not announced as something it is not: the data URL's media type is what the
 * model decodes with.
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function imageMime(bytes: number[]): string {
  return PNG_MAGIC.every((b, i) => bytes[i] === b) ? 'image/png' : 'image/jpeg';
}

/**
 * Which family a model id belongs to, because the three of them want three
 * different request bodies. Codex review 1 and Claude review 2 both pinned the
 * previous one-bucket version:
 *
 *   'gpt-5-reasoning'  gpt-5*, EXCEPT gpt-5-chat*. Rejects a non-default
 *                      temperature. Takes reasoning_effort, but WHICH values
 *                      depends on the exact id: gpt-5-mini takes `minimal`,
 *                      gpt-5.1 rejects it and takes none | low | medium | high.
 *   'o-series'         o1 / o3 / o4-mini. Also rejects a non-default
 *                      temperature. Takes reasoning_effort, but only
 *                      low | medium | high.
 *   'chat'             gpt-4.1*, gpt-4o*, gpt-5-chat*. Temperature as sent, and
 *                      NEVER reasoning_effort. gpt-5-chat* is the trap: it
 *                      matches /^gpt-5/ but is a plain chat model that takes
 *                      temperature and rejects reasoning_effort, the exact
 *                      opposite.
 *
 * Because the legal effort values differ per id even inside one family, this
 * file never picks one. It sends whatever OPENAI_REASONING_EFFORT holds, and
 * only when that var is non-empty (Codex review round 2, must-fix 2).
 *
 * Grade C: taken from OpenAI's published per-family behaviour, not measured on
 * this account. A fake fetch cannot reject a body, so the tests below prove what
 * this emits, not what OpenAI accepts.
 */
export type ModelFamily = 'gpt-5-reasoning' | 'o-series' | 'chat';

export function familyOf(model: string): ModelFamily {
  if (/^gpt-5-chat/.test(model)) return 'chat';
  if (/^gpt-5/.test(model)) return 'gpt-5-reasoning';
  if (/^o\d/.test(model)) return 'o-series';
  return 'chat';
}

/** The Workers AI vision input, `{ prompt, image, ... }`, as OpenAI content parts. */
function messagesFor(rec: Record<string, unknown>): unknown[] {
  // Text calls (the caption judge, the relevance judge, the vote) already send
  // `messages`, and OpenAI takes them unchanged.
  if (Array.isArray(rec.messages)) return rec.messages;

  const prompt = typeof rec.prompt === 'string' ? rec.prompt : '';
  const image = Array.isArray(rec.image) ? (rec.image as number[]) : null;
  // No image means the Meta licence handshake (`{ prompt: 'agree' }`), which
  // smoke.ts skips for this provider. Sent as plain text anyway, so a caller
  // that forgets gets a harmless answer rather than a malformed request.
  if (!image || image.length === 0) return [{ role: 'user', content: prompt }];

  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          // `detail: 'low'` is the cheap tier. A caption is a joke about what is
          // obviously in the picture, not an OCR job.
          image_url: {
            url: `data:${imageMime(image)};base64,${base64(image)}`,
            detail: 'low',
          },
        },
      ],
    },
  ];
}

/**
 * Workers AI takes the BARE JSON schema under `json_schema`; OpenAI wants it
 * named and wrapped. `strict: false` because the game's schemas
 * (CAPTION_JUDGE_SCHEMA, VOTE_SCHEMA, RELEVANCE_SCHEMA in bots.ts) do not carry
 * `additionalProperties: false`, which strict mode requires. Every key IS
 * already in `required` in all three (Claude review 7 corrected the earlier
 * wording here, which claimed otherwise and would have sent the next round
 * hunting a constraint that does not exist). The schemas are left alone on
 * purpose: a strict schema OpenAI rejects is a 400, which is a bot that never
 * votes, so this stays off until it is measured live.
 */
function responseFormatFor(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const rf = raw as Record<string, unknown>;
  if (rf.type !== 'json_schema') return null;
  const schema = rf.json_schema;
  if (!schema || typeof schema !== 'object') return null;
  return { type: 'json_schema', json_schema: { name: 'answer', schema, strict: false } };
}

/**
 * THE PER-FAMILY QUIRK TABLE. Every way OpenAI differs from the Workers AI input
 * shape lives in this one function, so adding a family is one edit here and never
 * a change in game logic.
 *
 *   max_completion_tokens  the current field. `max_tokens` is the legacy name and
 *                          the newer models refuse it outright.
 *   temperature            passed through for the 'chat' family, dropped for the
 *                          two reasoning families, which accept only the default
 *                          and error on anything else.
 *   reasoning_effort       sent ONLY when the configured effort is non-empty AND
 *                          the model is one of the two reasoning families. An
 *                          unset var sends nothing, anywhere: see
 *                          DEFAULT_REASONING_EFFORT for why guessing a value is
 *                          a 400 on every text call.
 */
export function requestBodyFor(
  model: string,
  input: unknown,
  reasoningEffort: string = DEFAULT_REASONING_EFFORT
): Record<string, unknown> {
  const rec = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const body: Record<string, unknown> = { model, messages: messagesFor(rec) };

  const format = responseFormatFor(rec.response_format);
  if (format) body.response_format = format;

  const maxTokens = Number(rec.max_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_completion_tokens = Math.trunc(maxTokens);
  }

  const family = familyOf(model);
  if (family === 'chat') {
    if (typeof rec.temperature === 'number') body.temperature = rec.temperature;
  } else if (reasoningEffort.length > 0) {
    // A reasoning family AND an operator who named a value. Either half missing
    // and the field is simply absent, which every one of these models accepts.
    body.reasoning_effort = reasoningEffort;
  }

  return body;
}

/** The AbortSignal bots.ts threads through `options`, if there is one. */
function signalOf(options: unknown): AbortSignal | undefined {
  if (!options || typeof options !== 'object') return undefined;
  const signal = (options as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

/**
 * The key must never reach a log. An upstream or a proxy that echoes the request
 * back can put it in the error body, which `noteIfAiOffline` in bots.ts prints
 * (Codex review 2 reproduced this with a synthetic 401 whose message echoed the
 * key). Truncation does not remove a secret, it only moves it, so redaction
 * happens on the WHOLE body before anything is parsed or cut.
 */
function redact(text: string, apiKey: string): string {
  return apiKey.length > 0 ? text.split(apiKey).join('[redacted]') : text;
}

/**
 * What went wrong, out of an error body that is DATA and never an instruction:
 * redacted, read, truncated. `error.code` is kept SEPARATE from the human text
 * because it is the only thing `isAiOfflineError` is allowed to classify on.
 */
function parseError(text: string, apiKey: string): { code: string | null; detail: string } {
  const safe = redact(text, apiKey);
  let code: string | null = null;
  let detail = safe;
  try {
    const parsed = JSON.parse(safe) as { error?: { code?: unknown; message?: unknown } };
    const err = parsed?.error;
    // REDACTED AGAIN, AFTER DECODING (Codex review round 2, must-fix 1). The
    // first pass runs on the RAW body, where an escaped key (`sk-...`) is
    // not a match for the key. `JSON.parse` then decodes the escape and hands
    // the whole secret back, so the extracted fields are scrubbed a second time
    // before either of them can reach an Error message and a log line.
    const parsedCode = typeof err?.code === 'string' ? redact(err.code, apiKey) : '';
    const parsedMessage = typeof err?.message === 'string' ? redact(err.message, apiKey) : '';
    if (parsedCode.length > 0) {
      code = parsedCode;
      detail = parsedCode;
    } else if (parsedMessage.length > 0) {
      detail = parsedMessage;
    } else {
      // AND THE THIRD BRANCH TOO (review round 3, must-fix 1). A JSON body that
      // carries NEITHER `error.code` NOR `error.message` used to fall through to
      // `safe`, which is only the RAW-body redaction: an escaped key sitting in
      // any OTHER field (a proxy echoing the request headers back) survived into
      // the thrown message and into `wrangler tail`. Re-serializing the DECODED
      // object puts every field through the redactor, not just the two promoted
      // ones. The shape changes (it is now normalized JSON), which is fine: this
      // branch is a diagnostic dump, never something the code classifies on.
      detail = redact(JSON.stringify(parsed), apiKey);
    }
  } catch {
    // Not JSON (an HTML error page from a proxy, say). The raw text is the detail.
  }
  return { code, detail: detail.slice(0, 300) };
}

export function makeOpenAiModel(opts: OpenAiModelOptions): AiLike {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async run(model: string, input: unknown, options?: unknown): Promise<unknown> {
      const signal = signalOf(options);
      const response = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(
          requestBodyFor(model, input, opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT)
        ),
        ...(signal ? { signal } : {}),
      });

      const text = await response.text();
      if (!response.ok) {
        const { code, detail } = parseError(text, opts.apiKey);
        throw new ModelProviderError(response.status, code, detail);
      }

      // `{ response }` is the shape textFromModel already reads, so the whole
      // pipeline below this line is provider-blind.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // A 2xx that is not JSON is the same thing to the game as an empty
        // answer: the ladder retries, the judge fails open.
        return { response: '' };
      }
      const message = (
        parsed as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> }
      )?.choices?.[0]?.message;
      const content = message?.content;
      if (typeof content === 'string' && content.length > 0) return { response: content };

      // A REFUSAL IS AN ANSWER, NOT AN ABSENCE (Codex review round 2, must-fix
      // 4). OpenAI declines in a separate `refusal` field with `content: null`.
      // Read only `content` and that arrives as `{ response: '' }`, which the
      // ladder treats as "this rung told us nothing": it re-sends the SAME
      // prompt the model just declined instead of taking its lighter one, and
      // the tuning rig records an empty where a refusal happened. Handing the
      // refusal text back puts it in front of the caption guard, which is the
      // thing that knows a refusal when it reads one.
      const refusal = message?.refusal;
      if (typeof refusal === 'string' && refusal.length > 0) return { response: refusal };
      return { response: '' };
    },
  };
}
