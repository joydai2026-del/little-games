// POST /api/ai-try: the cost ceiling, and the tag-audit mode.
//
// Codex review round 6, must-fix 1: `AI_TRY_MAX_MODEL_CALLS` was not a cap. It
// was checked once per PHOTO and then the route fanned every persona out with
// `Promise.all`, incrementing the counter AFTER the calls had already happened,
// so a cap smaller than one photo batch could be exceeded by a whole batch
// (personas x ladder rungs, plus a description and a relevance judge). The cap
// is now a budget object that RESERVES a slot before every model call, and the
// test that proves it is the one Codex asked for: a cap lower than one batch.

import { describe, expect, it, vi } from 'vitest';
import { fixturePhoto, FIXTURE_PHOTO_SHA256 } from '../src/shared/fixture-photo';

// Real photos would be a network call; the shape is all this route needs.
vi.mock('../src/worker/photo', () => ({
  fetchPhoto: vi.fn(async () => ({
    bytes: fixturePhoto(),
    contentType: 'image/jpeg',
    meta: {
      round: 1,
      source: 'loremflickr' as const,
      credit: 'loremflickr.com',
      sha256: FIXTURE_PHOTO_SHA256,
      bytes: 75878,
    },
  })),
}));

const { handleAiTry } = await import('../src/worker/ai-try');
const { fetchPhoto } = await import('../src/worker/photo');

const TOKEN = 'a-smoke-token';

/** Counts every call the route makes to the AI binding. */
function countingEnv(over: Record<string, string> = {}) {
  const calls: string[] = [];
  const env = {
    SMOKE_TOKEN: TOKEN,
    AI: {
      async run(model: string, input: unknown) {
        calls.push(model);
        // The vision calls carry `prompt`; the judges carry `messages`.
        if ((input as { prompt?: string }).prompt !== undefined) {
          return { response: 'Day four of the standoff.' };
        }
        return { response: '{"verdict": "caption", "captionId": "c1"}' };
      },
    },
    AI_TRY_MAX_SAMPLES: '24',
    AI_TRY_MAX_MODEL_CALLS: '160',
    ...over,
  };
  return { env: env as never, calls };
}

function request(body: unknown, token: string = TOKEN): Request {
  return new Request('https://example.test/api/ai-try', {
    method: 'POST',
    headers: { 'x-smoke-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai-try: the model-call cap', () => {
  it('never exceeds a cap lower than ONE photo batch', async () => {
    // One photo batch here is 1 description + 4 personas x (>=1 rung + judge),
    // i.e. at least 9 calls. The cap is 3.
    const { env, calls } = countingEnv({ AI_TRY_MAX_MODEL_CALLS: '3' });
    const res = await handleAiTry(request({ photos: 2 }), env);
    const body = (await res.json()) as {
      summary: { model_calls: number; model_call_cap: number };
      photoErrors: string[];
    };

    expect(calls.length).toBe(3);
    expect(body.summary.model_calls).toBe(3);
    expect(body.summary.model_call_cap).toBe(3);
    // ...and it says so, rather than silently returning a short table.
    expect(body.photoErrors.join(' ')).toMatch(/model-call cap/);
  });

  it('a cap of 1 buys exactly the photo description and nothing else', async () => {
    const { env, calls } = countingEnv({ AI_TRY_MAX_MODEL_CALLS: '1' });
    await handleAiTry(request({ photos: 3 }), env);
    expect(calls).toHaveLength(1);
  });

  it('reports the judge verdicts, so the extra call per caption is visible', async () => {
    const { env } = countingEnv();
    const res = await handleAiTry(request({ photos: 1, personas: ['daisy-deadpan'] }), env);
    const body = (await res.json()) as {
      summary: { judge_rejected: number; judge_verdicts: Record<string, number>; model_calls: number };
    };
    expect(body.summary.judge_verdicts.caption).toBe(1);
    expect(body.summary.judge_rejected).toBe(0);
    // 1 description + 1 caption rung + 1 caption judge + 1 relevance judge.
    expect(body.summary.model_calls).toBe(4);
  });
});

describe('POST /api/ai-try: the tag audit (round 6, M4)', () => {
  it('describeOnly asks the photo host for the named tag and only describes it', async () => {
    const { env, calls } = countingEnv();
    const res = await handleAiTry(request({ tags: ['duck'], photos: 2, describeOnly: true }), env);
    const body = (await res.json()) as { samples: Array<{ photoDescription: string; photoTag: string }> };

    expect(body.samples).toHaveLength(2);
    expect(body.samples[0].photoTag).toBe('duck');
    expect(calls).toHaveLength(2); // one description per photo, no captions
    const settingsUsed = vi.mocked(fetchPhoto).mock.calls.at(-1)?.[0] as { photoTags: string[] };
    expect(settingsUsed.photoTags).toEqual(['duck']);
  });

  it('validates a tag rather than passing it into an outbound URL', async () => {
    const { env } = countingEnv();
    for (const tags of [['../../etc'], ['a b'], ['CAPS!'], []]) {
      const res = await handleAiTry(request({ tags, describeOnly: true }), env);
      expect(res.status, JSON.stringify(tags)).toBe(400);
    }
  });

  it('a request with no tags leaves the deployed PHOTO_TAGS alone', async () => {
    const { env } = countingEnv();
    await handleAiTry(request({ photos: 1, describeOnly: true }), env);
    const settingsUsed = vi.mocked(fetchPhoto).mock.calls.at(-1)?.[0] as { photoTags: string[] };
    expect(settingsUsed.photoTags.length).toBeGreaterThan(1);
  });
});

describe('POST /api/ai-try: the token gate', () => {
  it('401s a wrong token and 405s a GET', async () => {
    const { env, calls } = countingEnv();
    expect((await handleAiTry(request({}, 'wrong'), env)).status).toBe(401);
    // A wrong-LENGTH token is the case round 6 made constant-time too.
    expect((await handleAiTry(request({}, 'x'), env)).status).toBe(401);
    const get = new Request('https://example.test/api/ai-try', { method: 'GET' });
    expect((await handleAiTry(get, env)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });
});
