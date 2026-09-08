// The OpenAI provider, driven by a fake fetch.
//
// It exists because the Cloudflare account stays on the FREE plan and the free
// Workers AI allowance (10,000 neurons a day) had the AI players offline for
// most of every day. So the thing under test here is a TRANSLATION: the game
// keeps sending the two Workers AI input shapes it has always sent, and this
// file proves what actually goes on the wire and what comes back.
//
// Three properties matter more than the rest:
//   1. the photo really is in the request, as a data URL a model can decode
//   2. a schema call is wrapped the way OpenAI needs, or a bot never votes
//   3. an account-level error is classified as a WALL and a rate limit is not

import { describe, expect, it, vi } from 'vitest';
import { makeOpenAiModel, ModelProviderError } from '../src/worker/openai';
import {
  composeBotCaption,
  generateBotCaption,
  isAiOfflineError,
  parseJudgeVerdict,
  parseVoteAnswer,
  type BotModels,
} from '../src/worker/bots';
import { modelProvider, settings, type Env } from '../src/worker/env';
import { PERSONAS } from '../src/shared/personas';
import { fixturePhoto } from '../src/shared/fixture-photo';

const KEY = 'sk-test-not-a-real-key';

interface Capture {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake fetch that records the request and answers with `reply`. */
function fakeFetch(
  reply: { status?: number; body: unknown },
  seen: Capture[]
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    seen.push({
      url,
      headers,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
}

/** The ordinary 200: one choice, one string of content. */
function answers(content: string) {
  return { body: { choices: [{ message: { content } }] } };
}

function firstContentPart(body: Record<string, unknown>, index: number): Record<string, unknown> {
  const messages = body.messages as Array<{ content: unknown }>;
  return (messages[0].content as Array<Record<string, unknown>>)[index];
}

describe('the vision call', () => {
  it('puts the prompt and the real photo bytes in one user message', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('A caption.'), seen) });
    const bytes = Array.from(fixturePhoto());

    await ai.run('gpt-4.1-mini', {
      prompt: 'Write one caption.',
      image: bytes,
      max_tokens: 64,
      temperature: 0.9,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.openai.com/v1/chat/completions');

    const text = firstContentPart(seen[0].body, 0);
    expect(text).toEqual({ type: 'text', text: 'Write one caption.' });

    const image = firstContentPart(seen[0].body, 1);
    expect(image.type).toBe('image_url');
    const url = (image.image_url as { url: string; detail: string }).url;
    expect((image.image_url as { detail: string }).detail).toBe('low');
    // Not just "it looks like a data URL": the bytes must survive the encode, or
    // the model is captioning something other than the round's photo.
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const decoded = atob(url.slice('data:image/jpeg;base64,'.length));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.charCodeAt(0)).toBe(bytes[0]);
    expect(decoded.charCodeAt(decoded.length - 1)).toBe(bytes[bytes.length - 1]);
  });

  it('sniffs PNG bytes and announces them as PNG', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('ok'), seen) });
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01];

    await ai.run('gpt-4.1-mini', { prompt: 'p', image: png });

    const image = firstContentPart(seen[0].body, 1);
    expect((image.image_url as { url: string }).url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('sends a prompt with no image as a plain text message', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('ok'), seen) });

    await ai.run('gpt-4.1-mini', { prompt: 'agree' });

    expect(seen[0].body.messages).toEqual([{ role: 'user', content: 'agree' }]);
  });
});

describe('the request body', () => {
  it('carries the key in the Authorization header', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('ok'), seen) });

    await ai.run('gpt-4.1-mini', { messages: [{ role: 'user', content: 'hi' }] });

    expect(seen[0].headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('honours a custom base URL, without a doubled slash', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({
      apiKey: KEY,
      baseUrl: 'https://proxy.test/v1/',
      fetchImpl: fakeFetch(answers('ok'), seen),
    });

    await ai.run('gpt-4.1-mini', { messages: [{ role: 'user', content: 'hi' }] });

    expect(seen[0].url).toBe('https://proxy.test/v1/chat/completions');
  });

  it('wraps a bare JSON schema the way OpenAI needs it', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('{}'), seen) });
    const schema = {
      type: 'object',
      properties: { captionId: { type: 'string' } },
      required: ['captionId'],
    };

    await ai.run('gpt-4.1-mini', {
      messages: [{ role: 'user', content: 'pick one' }],
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: 64,
      temperature: 0.3,
    });

    expect(seen[0].body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'answer', schema, strict: false },
    });
    // The messages are passed straight through; only the schema needed a wrapper.
    expect(seen[0].body.messages).toEqual([{ role: 'user', content: 'pick one' }]);
  });

  it('sends max_completion_tokens and never the legacy max_tokens', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('ok'), seen) });

    await ai.run('gpt-4.1-mini', { prompt: 'p', image: [1, 2, 3], max_tokens: 64 });

    expect(seen[0].body.max_completion_tokens).toBe(64);
    expect('max_tokens' in seen[0].body).toBe(false);
  });

  it('keeps temperature for gpt-4.1-mini and adds no reasoning_effort', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({ apiKey: KEY, fetchImpl: fakeFetch(answers('ok'), seen) });

    await ai.run('gpt-4.1-mini', { prompt: 'p', image: [1], max_tokens: 64, temperature: 0.9 });

    expect(seen[0].body.temperature).toBe(0.9);
    expect('reasoning_effort' in seen[0].body).toBe(false);
  });

  // THE PER-FAMILY TABLE, one row per (model, configured effort) pair. Two
  // earlier versions of this test locked in a wrong body: first
  // `reasoning_effort: 'minimal'` for o3-mini (Codex review 1), then the
  // `minimal` DEFAULT reaching gpt-5.1, which rejects that exact value (Codex
  // review round 2, must-fix 2). A fake fetch cannot refuse a body, so a wrong
  // body stays green here while every live text call 400s and no bot ever votes.
  // Hence the rule the rows encode: the effort is opt-in, never guessed.
  it('sends each model family the body that family accepts', async () => {
    const expected: Array<{
      model: string;
      configured: string | undefined;
      temperature: number | undefined;
      reasoning: string | undefined;
    }> = [
      // The var left EMPTY, which is the shipped default: nothing goes out, on
      // any id. gpt-5.1 is the case that pinned this, since `minimal` is illegal
      // for it and the old default sent exactly that.
      { model: 'gpt-5.1', configured: undefined, temperature: undefined, reasoning: undefined },
      { model: 'gpt-5-mini', configured: undefined, temperature: undefined, reasoning: undefined },
      // The operator named a value their model accepts: it goes out unchanged.
      { model: 'gpt-5-mini', configured: 'minimal', temperature: undefined, reasoning: 'minimal' },
      { model: 'gpt-5.1', configured: 'none', temperature: undefined, reasoning: 'none' },
      { model: 'o3-mini', configured: 'low', temperature: undefined, reasoning: 'low' },
      // gpt-5-chat* only LOOKS like the family. It is a chat model: temperature
      // yes, reasoning_effort no, whatever the var says.
      { model: 'gpt-5-chat-latest', configured: 'minimal', temperature: 0.9, reasoning: undefined },
      { model: 'gpt-4.1-mini', configured: 'minimal', temperature: 0.9, reasoning: undefined },
      { model: 'gpt-4.1-mini', configured: undefined, temperature: 0.9, reasoning: undefined },
    ];

    for (const want of expected) {
      const seen: Capture[] = [];
      const ai = makeOpenAiModel({
        apiKey: KEY,
        ...(want.configured === undefined ? {} : { reasoningEffort: want.configured }),
        fetchImpl: fakeFetch(answers('ok'), seen),
      });

      await ai.run(want.model, { prompt: 'p', image: [1], max_tokens: 64, temperature: 0.9 });

      const label = `${want.model} with effort ${want.configured ?? '(unset)'}`;
      expect(seen[0].body.temperature, label).toBe(want.temperature);
      expect(seen[0].body.reasoning_effort, label).toBe(want.reasoning);
    }
  });

  it('takes the reasoning effort from config, so it is a dial and not a literal', async () => {
    const seen: Capture[] = [];
    const ai = makeOpenAiModel({
      apiKey: KEY,
      reasoningEffort: 'medium',
      fetchImpl: fakeFetch(answers('ok'), seen),
    });

    await ai.run('gpt-5-mini', { prompt: 'p', image: [1], max_tokens: 64 });
    expect(seen[0].body.reasoning_effort).toBe('medium');

    // ...and it still never reaches a chat model, which rejects the field.
    const other: Capture[] = [];
    const chat = makeOpenAiModel({
      apiKey: KEY,
      reasoningEffort: 'medium',
      fetchImpl: fakeFetch(answers('ok'), other),
    });
    await chat.run('gpt-4.1-mini', { prompt: 'p', image: [1], max_tokens: 64 });
    expect('reasoning_effort' in other[0].body).toBe(false);
  });
});

describe('the answer', () => {
  it('comes back as { response } so the existing parsers work unchanged', async () => {
    const seen: Capture[] = [];
    const vote = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(answers('{"captionId": "cap-b"}'), seen),
    });
    expect(parseVoteAnswer(await vote.run('gpt-4.1-mini', { messages: [] }))).toBe('cap-b');

    const judge = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(answers('{"verdict": "refusal"}'), []),
    });
    expect(parseJudgeVerdict(await judge.run('gpt-4.1-mini', { messages: [] }))).toBe('refusal');
  });

  it('is an empty response when the content is missing, never a crash', async () => {
    const empty = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch({ body: { choices: [] } }, []),
    });
    expect(await empty.run('gpt-4.1-mini', { messages: [] })).toEqual({ response: '' });

    const notJson = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch({ body: 'not json at all' }, []),
    });
    expect(await notJson.run('gpt-4.1-mini', { messages: [] })).toEqual({ response: '' });
  });
});

describe('errors, and which ones are a wall', () => {
  it('throws with the status and the error code, and a dead key is a wall', async () => {
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        {
          status: 401,
          body: {
            error: {
              message: 'Incorrect API key provided: sk-test-...',
              type: 'invalid_request_error',
              code: 'invalid_api_key',
            },
          },
        },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelProviderError);
    expect((err as Error).message).toBe('openai 401: invalid_api_key');
    // The parts stay SEPARATE, which is what lets bots.ts classify without ever
    // reading the text (Codex review 3).
    expect((err as ModelProviderError).provider).toBe('openai');
    expect((err as ModelProviderError).status).toBe(401);
    expect((err as ModelProviderError).code).toBe('invalid_api_key');
    expect(isAiOfflineError(err)).toBe(true);
  });

  it('treats a rate limit as a hiccup, not a wall', async () => {
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        {
          status: 429,
          body: { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } },
        },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).toBe('openai 429: rate_limit_exceeded');
    expect((err as ModelProviderError).code).toBe('rate_limit_exceeded');
    // The whole point of the narrow marker list: the retry ladder still gets to
    // work on this one instead of every bot sitting out the rest of the game.
    expect(isAiOfflineError(err)).toBe(false);
  });

  it('has no code when the body carries none, and that is never a wall', async () => {
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        { status: 502, body: 'upstream unavailable, request id 4006' },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as ModelProviderError).code).toBeNull();
    expect((err as ModelProviderError).status).toBe(502);
    // Codex review 3's reproduction: a proxy's request id used to read as
    // Workers AI's quota wall and took every bot in the room offline.
    expect(isAiOfflineError(err)).toBe(false);
  });

  it('REDACTS the key out of an error body before anything is logged', async () => {
    // An upstream or proxy that echoes the request back can put the key in the
    // body, and bots.ts prints that message (Codex review 2). Truncation does
    // not remove a secret, it only moves it.
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        {
          status: 401,
          body: { error: { message: `Incorrect API key provided: ${KEY}`, code: null } },
        },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).toBe('openai 401: Incorrect API key provided: [redacted]');
  });

  // THE ESCAPE THAT SURVIVED THE FIRST PASS (Codex review round 2, must-fix 1).
  // Redaction used to run only on the RAW body, where `sk-...` matches
  // nothing. `JSON.parse` then decoded it and handed the whole secret to the
  // Error message, which bots.ts prints. Both fields the parser can promote to
  // the message are covered, because either one alone is a leaked key.
  it('redacts a JSON-ESCAPED key out of the message, not just a literal one', async () => {
    const escaped = '\\u0073k-test-not-a-real-key';
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        { status: 401, body: `{"error":{"code":null,"message":"${escaped}"}}` },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).toBe('openai 401: [redacted]');
  });

  it('redacts a JSON-ESCAPED key out of the CODE too', async () => {
    const escaped = '\\u0073k-test-not-a-real-key';
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        { status: 401, body: `{"error":{"code":"${escaped}","message":"bad key"}}` },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
    // The code is what isAiOfflineError classifies on, so it is carried
    // separately AND scrubbed separately.
    expect((err as ModelProviderError).code).toBe('[redacted]');
    expect((err as ModelProviderError).code).not.toContain(KEY);
    expect(isAiOfflineError(err)).toBe(false);
  });

  it('redacts the key out of a raw non-JSON body too', async () => {
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 500, body: `<pre>Authorization: Bearer ${KEY}</pre>` }, []),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).toContain('[redacted]');
  });

  // THE THIRD BRANCH (review round 3, must-fix 1). A JSON body carrying NEITHER
  // `error.code` NOR `error.message` fell through to the RAW-body redaction,
  // where an escaped key matches nothing. A proxy echoing the request headers
  // back therefore put the whole secret in the message bots.ts prints.
  it('redacts an ESCAPED key out of a body with no code and no message', async () => {
    const escaped = '\\u0073k-test-not-a-real-key';
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        {
          status: 400,
          body:
            '{"error":{"type":"invalid_request_error"},' +
            `"echo":{"authorization":"Bearer ${escaped}"}}`,
        },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).toContain('[redacted]');
    // Still a usable diagnostic: everything that is not the key survives.
    expect((err as Error).message).toContain('invalid_request_error');
    expect((err as ModelProviderError).code).toBeNull();
  });

  it('redacts a LITERAL key out of a body with no code and no message', async () => {
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch(
        { status: 400, body: { error: { type: 'x' }, echo: { authorization: `Bearer ${KEY}` } } },
        []
      ),
    });

    const err = await ai.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).toContain('[redacted]');
  });

  it('falls back to the message, then to the raw body, and truncates', async () => {
    const noCode = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 400, body: { error: { message: 'bad request' } } }, []),
    });
    await expect(noCode.run('gpt-4.1-mini', { messages: [] })).rejects.toThrow(
      'openai 400: bad request'
    );

    const html = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 502, body: '<html>' + 'x'.repeat(500) + '</html>' }, []),
    });
    const err = await html.run('gpt-4.1-mini', { messages: [] }).catch((e: unknown) => e);
    // Body text is DATA. It is read, capped and reported, never trusted.
    expect((err as Error).message.length).toBeLessThanOrEqual('openai 502: '.length + 300);
  });
});

describe('modelProvider', () => {
  const openAiEnv = (over: Record<string, string | undefined> = {}) =>
    ({
      AI: { run: async () => ({ response: 'from workers ai' }) },
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: KEY,
      ...over,
    }) as unknown as Env;

  it('picks openai only when the var asks AND the key is there', () => {
    const chosen = modelProvider(openAiEnv());
    expect(chosen.provider).toBe('openai');
    expect(chosen.visionModel).toBe('gpt-4.1-mini');
    expect(chosen.textModel).toBe('gpt-4.1-mini');
    expect(settings(openAiEnv()).provider).toBe('openai');
  });

  it('takes the model ids from the vars', () => {
    const chosen = modelProvider(
      openAiEnv({ OPENAI_VISION_MODEL: 'gpt-5-mini', OPENAI_TEXT_MODEL: 'o3-mini' })
    );
    expect(chosen.visionModel).toBe('gpt-5-mini');
    expect(chosen.textModel).toBe('o3-mini');
  });

  it('uses the vision model as its own fallback, so the ladder stops at two rungs', () => {
    // There is no second OpenAI vision model to fall back to. composeBotCaption
    // skips its third rung when the two ids match, which is exactly right: it
    // would be the same model answering the same prompt a third time.
    const chosen = modelProvider(openAiEnv());
    expect(chosen.visionModelFallback).toBe(chosen.visionModel);
  });

  it('falls back to Workers AI when the key is missing, and when nothing is set', () => {
    const noKey = modelProvider(openAiEnv({ OPENAI_API_KEY: undefined }));
    expect(noKey.provider).toBe('workers-ai');
    expect(noKey.visionModel).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(noKey.textModel).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    const bare = modelProvider({} as Env);
    expect(bare.provider).toBe('workers-ai');
    expect(settings({} as Env).provider).toBe('workers-ai');
  });

  it('hands back the AI binding itself on workers-ai', async () => {
    const env = openAiEnv({ AI_PROVIDER: 'workers-ai' });
    const chosen = modelProvider(env);
    expect(chosen.provider).toBe('workers-ai');
    expect(await chosen.ai.run('any', {})).toEqual({ response: 'from workers ai' });
  });

  it('takes the reasoning effort from the var, and defaults it to UNSET', () => {
    const chosen = modelProvider(openAiEnv({ OPENAI_REASONING_EFFORT: 'low' }));
    expect(chosen.provider).toBe('openai');
    expect(settings(openAiEnv({ OPENAI_REASONING_EFFORT: 'low' })).openaiReasoningEffort).toBe('low');
    // Empty, not `minimal`: the value is opt-in, because which values are legal
    // depends on the model id and a wrong one 400s every text call (Codex review
    // round 2, must-fix 2).
    expect(settings(openAiEnv()).openaiReasoningEffort).toBe('');
  });

  // `modelProvider` runs on every bot batch, so an unlatched warn is the same
  // line forever in `wrangler tail` (Codex review 4, Claude review 4: measured
  // at 5 warns for 5 calls). A fresh module registry per test is what gives each
  // one its own isolate, which is the scope the latch claims.
  it('warns ONCE per isolate that the key is missing, not once per call', async () => {
    vi.resetModules();
    const fresh = await import('../src/worker/env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let i = 0; i < 5; i += 1) fresh.modelProvider(openAiEnv({ OPENAI_API_KEY: undefined }));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('OPENAI_API_KEY');
    } finally {
      warn.mockRestore();
    }
  });

  it('warns ONCE about an AI_PROVIDER typo instead of silently using the free tier', async () => {
    // The single most likely deploy mistake: `open-ai` used to land the game
    // back on the exhausted Workers AI allowance with no signal anywhere, which
    // is the exact problem this provider exists to solve (Claude review 5).
    vi.resetModules();
    const fresh = await import('../src/worker/env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let chosen = fresh.modelProvider(openAiEnv({ AI_PROVIDER: 'open-ai' }));
      for (let i = 0; i < 4; i += 1) {
        chosen = fresh.modelProvider(openAiEnv({ AI_PROVIDER: 'open-ai' }));
      }
      expect(chosen.provider).toBe('workers-ai');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('open-ai');
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing at all when the provider is unset or is workers-ai', async () => {
    vi.resetModules();
    const fresh = await import('../src/worker/env');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fresh.modelProvider({} as Env);
      fresh.modelProvider(openAiEnv({ AI_PROVIDER: 'workers-ai' }));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// AN EXPLICIT REFUSAL IS NOT AN EMPTY ANSWER (Codex review round 2, must-fix 4).
// OpenAI declines in a separate `refusal` field with `content: null`. Reading
// only `content` turned that into `{ response: '' }`, which the ladder treats as
// "this rung told us nothing": it re-sent the SAME prompt the model had just
// declined instead of taking its lighter one, and the tuning rig recorded an
// empty where a refusal happened. These run the REAL adapter under the REAL
// ladder, because the bug lived in the seam between them.
// ---------------------------------------------------------------------------

describe('an OpenAI refusal, all the way through the caption ladder', () => {
  const REFUSAL = 'I cannot write a caption for this photo.';

  /** A 200 whose choice carries no content and an explicit refusal. */
  const refusesThenAnswers = (second: unknown) => {
    let calls = 0;
    return (async () => {
      calls += 1;
      const body =
        calls === 1
          ? { choices: [{ message: { content: null, refusal: REFUSAL } }] }
          : (second as object);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  };

  const openAiModels = (fetchImpl: typeof fetch): BotModels => ({
    ai: makeOpenAiModel({ apiKey: KEY, fetchImpl }),
    // The single-vision-model shape modelProvider builds for this provider.
    visionModel: 'gpt-4.1-mini',
    visionModelFallback: 'gpt-4.1-mini',
    textModel: 'gpt-4.1-mini',
    timeoutMs: 20_000,
    visionMaxBytes: 1_000_000,
  });

  it('hands the refusal text back rather than an empty string', async () => {
    const ai = makeOpenAiModel({
      apiKey: KEY,
      fetchImpl: refusesThenAnswers(null),
    });
    expect(await ai.run('gpt-4.1-mini', { prompt: 'p', image: [1] })).toEqual({
      response: REFUSAL,
    });

    // The one-shot caption path reads the same value, so `ai:smoke` and the
    // ladder agree about what happened.
    const said = await generateBotCaption(openAiModels(refusesThenAnswers(null)), PERSONAS[0], fixturePhoto());
    expect(said).toBe(REFUSAL);
  });

  it('makes the ladder take its LIGHTER prompt, not repeat the declined one', async () => {
    const models = openAiModels(
      refusesThenAnswers({ choices: [{ message: { content: 'Day four of the standoff.' } }] })
    );

    const { attempts, final } = await composeBotCaption(models, PERSONAS[0], fixturePhoto(), {
      judge: false,
    });

    expect(attempts[0].verdict).toBe('refusal');
    // The whole point: rung 2 is the reworded prompt a refusal earns. Before the
    // fix this was `empty`, rung 2 was skipped, and the plain prompt was sent
    // again as the same-id retry.
    expect(attempts[1].mode).toBe('lighter');
    expect(attempts).toHaveLength(2);
    expect(final).toBe('Day four of the standoff.');
  });
});
