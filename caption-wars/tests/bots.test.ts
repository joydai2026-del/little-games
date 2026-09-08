// The bots, driven by a fake Workers AI binding and a fake room.
//
// The three things that must hold no matter what a model does (plan amendment
// 2 and 12) are what this file proves:
//   1. the bytes the vision model is handed are the round's real photo bytes
//   2. a bot failure leaves the room exactly as it was
//   3. a job whose room has moved on is dropped, never applied to the wrong round

import { describe, it, expect } from 'vitest';
import {
  buildBotJobs,
  generateBotCaption,
  generateBotVote,
  parseVoteAnswer,
  runBotJob,
  textFromModel,
  type AiLike,
  type BotHost,
  type BotModels,
} from '../src/worker/bots';
import { sha256Hex } from '../src/worker/photo';
import { fixturePhoto, FIXTURE_PHOTO_SHA256 } from '../src/shared/fixture-photo';
import { PERSONAS } from '../src/shared/personas';
import { createRoom, start, submitCaption } from '../src/shared/room';
import { normalizeOptions } from '../src/shared/config';
import type { BotJob, PhotoMeta, Player, RoomState } from '../src/shared/types';

const T0 = 1_700_000_000_000;
const PHOTO: PhotoMeta = {
  round: 1,
  source: 'loremflickr',
  credit: 'loremflickr.com',
  sha256: FIXTURE_PHOTO_SHA256,
  bytes: 75878,
};

function bot(id: string, name: string): Player {
  return { id, name, isBot: true, score: 0, lastSeenAt: T0 };
}

function captionRoom(): RoomState {
  const options = normalizeOptions({ rounds: 2, botCount: 2 });
  const room = createRoom('ABCD', { id: 'host', name: 'JJ' }, options, [bot('b1', 'Daisy'), bot('b2', 'Chip')], T0);
  return start(room, 'host', PHOTO, T0).state;
}

/**
 * A fake room. `applied` records every mutation, so "the room was left
 * untouched" is a checkable claim rather than a hope.
 */
function fakeHost(room: RoomState, overrides: Partial<BotHost> = {}) {
  const applied: Array<{ kind: string; botId: string; value: string }> = [];
  const host: BotHost = {
    stamp: () => ({ phase: room.phase, round: room.round, version: room.version }),
    photoBytes: async () => fixturePhoto(),
    persona: (botId) => (botId === 'b1' ? PERSONAS[0] : PERSONAS[1]),
    voteOptions: (botId) =>
      room.captions.filter((c) => c.playerId !== botId).map((c) => ({ id: c.id, text: c.text })),
    applyCaption: async (botId, text) => {
      applied.push({ kind: 'caption', botId, value: text });
      return true;
    },
    applyVote: async (botId, captionId) => {
      applied.push({ kind: 'vote', botId, value: captionId });
      return true;
    },
    ...overrides,
  };
  return { host, applied };
}

function job(overrides: Partial<BotJob> = {}): BotJob {
  return {
    jobId: 'j1',
    botId: 'b1',
    round: 1,
    phase: 'caption',
    dueAt: T0,
    deadline: T0 + 20_000,
    status: 'pending',
    ...overrides,
  };
}

function models(ai: AiLike, over: Partial<BotModels> = {}): BotModels {
  return {
    ai,
    visionModel: '@cf/meta/llama-3.2-11b-vision-instruct',
    visionModelFallback: '@cf/llava-hf/llava-1.5-7b-hf',
    textModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    timeoutMs: 20_000,
    ...over,
  };
}

describe('the bytes handed to the vision model', () => {
  it('are the round photo, byte for byte (sha256 matches the fixture)', async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai: AiLike = {
      async run(model, input) {
        calls.push({ model, input: input as Record<string, unknown> });
        return { response: 'A goat with opinions.' };
      },
    };

    const outcome = await runBotJob(job(), models(ai), fakeHost(captionRoom()).host);
    expect(outcome).toBe('done');
    expect(calls).toHaveLength(1);

    const image = calls[0].input.image as number[];
    expect(Array.isArray(image)).toBe(true);
    expect(image).toHaveLength(75878);
    expect(await sha256Hex(new Uint8Array(image))).toBe(FIXTURE_PHOTO_SHA256);
  });

  it('go to the primary model first, with a prompt and no image URL', async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai: AiLike = {
      async run(model, input) {
        calls.push({ model, input: input as Record<string, unknown> });
        return { response: 'ok' };
      },
    };
    await generateBotCaption(models(ai), PERSONAS[0], fixturePhoto());
    expect(calls[0].model).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(typeof calls[0].input.prompt).toBe('string');
    expect(calls[0].input.max_tokens).toBe(96);
  });

  it('fall back to the second vision model once, then give up', async () => {
    const tried: string[] = [];
    const ai: AiLike = {
      async run(model) {
        tried.push(model);
        throw new Error('model unavailable');
      },
    };
    expect(await generateBotCaption(models(ai), PERSONAS[0], fixturePhoto())).toBeNull();
    expect(tried).toEqual([
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/llava-hf/llava-1.5-7b-hf',
    ]);
  });

  it('use the fallback answer when the primary model throws', async () => {
    const ai: AiLike = {
      async run(model) {
        if (model.includes('llama-3.2')) throw new Error('nope');
        return { description: 'Goat, mid-thought.' };
      },
    };
    expect(await generateBotCaption(models(ai), PERSONAS[0], fixturePhoto())).toBe('Goat, mid-thought.');
  });
});

describe('a failing bot never touches the room', () => {
  it('records failed when both models throw', async () => {
    const ai: AiLike = {
      async run() {
        throw new Error('Workers AI is down');
      },
    };
    const { host, applied } = fakeHost(captionRoom());
    expect(await runBotJob(job(), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('records failed when the model returns nothing usable', async () => {
    const ai: AiLike = { async run() { return { nothing: true }; } };
    const { host, applied } = fakeHost(captionRoom());
    expect(await runBotJob(job(), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('records failed when the caption is only whitespace after cleaning', async () => {
    const ai: AiLike = { async run() { return { response: '   ""   ' }; } };
    const { host, applied } = fakeHost(captionRoom());
    expect(await runBotJob(job(), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('records failed when the photo bytes are gone', async () => {
    const ai: AiLike = { async run() { return { response: 'never called' }; } };
    const room = captionRoom();
    const { host, applied } = fakeHost(room, { photoBytes: async () => null });
    expect(await runBotJob(job(), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('leaves the real room state byte-identical when a job fails', async () => {
    const room = captionRoom();
    const snapshot = JSON.stringify(room);
    const ai: AiLike = { async run() { throw new Error('down'); } };
    await runBotJob(job(), models(ai), fakeHost(room).host);
    expect(JSON.stringify(room)).toBe(snapshot);
  });
});

describe('a stale job is dropped', () => {
  it('refuses to run at all when the room is already in another phase', async () => {
    const ai: AiLike = { async run() { return { response: 'too late' }; } };
    const room = captionRoom();
    const { host, applied } = fakeHost(room, {
      stamp: () => ({ phase: 'vote', round: 1, version: room.version }),
    });
    expect(await runBotJob(job({ phase: 'caption' }), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('refuses to run when the room has moved to another round', async () => {
    const ai: AiLike = { async run() { return { response: 'too late' }; } };
    const room = captionRoom();
    const { host, applied } = fakeHost(room, {
      stamp: () => ({ phase: 'caption', round: 4, version: room.version }),
    });
    expect(await runBotJob(job({ round: 1 }), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('throws the answer away when the room moves on DURING the model call', async () => {
    const room = captionRoom();
    let phase: 'caption' | 'vote' = 'caption';
    const ai: AiLike = {
      async run() {
        phase = 'vote'; // the caption timer fired while the model was thinking
        return { response: 'a fine caption, one moment too late' };
      },
    };
    const { host, applied } = fakeHost(room, {
      stamp: () => ({ phase, round: 1, version: room.version }),
    });
    expect(await runBotJob(job(), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('still applies when only the version moved (another bot captioned first)', async () => {
    const room = captionRoom();
    let version = room.version;
    const ai: AiLike = {
      async run() {
        version += 1; // the other bot got its caption in first
        return { response: 'mine still counts' };
      },
    };
    const { host, applied } = fakeHost(room, {
      stamp: () => ({ phase: 'caption', round: 1, version }),
    });
    expect(await runBotJob(job(), models(ai), host)).toBe('done');
    expect(applied).toEqual([{ kind: 'caption', botId: 'b1', value: 'mine still counts' }]);
  });

  it('records failed when the reducer itself refuses the write', async () => {
    const ai: AiLike = { async run() { return { response: 'rejected downstream' }; } };
    const { host, applied } = fakeHost(captionRoom(), { applyCaption: async () => false });
    expect(await runBotJob(job(), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });
});

describe('bot voting', () => {
  function voteRoom(): RoomState {
    let room = captionRoom();
    room = submitCaption(room, 'host', 'human caption', 'c-host', T0 + 1).state;
    room = submitCaption(room, 'b1', 'daisy caption', 'c-b1', T0 + 2).state;
    room = submitCaption(room, 'b2', 'chip caption', 'c-b2', T0 + 3).state;
    expect(room.phase).toBe('vote');
    return room;
  }

  it('votes for a caption that is on its ballot, never its own', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const ai: AiLike = {
      async run(_model, input) {
        seen.push(input as Record<string, unknown>);
        return { response: { captionId: 'c-host' } };
      },
    };
    const room = voteRoom();
    const { host, applied } = fakeHost(room, {
      stamp: () => ({ phase: 'vote', round: 1, version: room.version }),
    });
    expect(await runBotJob(job({ phase: 'vote' }), models(ai), host)).toBe('done');
    expect(applied).toEqual([{ kind: 'vote', botId: 'b1', value: 'c-host' }]);

    const prompt = String((seen[0].messages as Array<{ content: string }>)[0].content);
    expect(prompt).toContain('c-host');
    expect(prompt).not.toContain('c-b1'); // its own caption is not on the ballot
    expect(seen[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: { type: 'object', properties: { captionId: { type: 'string' } }, required: ['captionId'] },
    });
  });

  it('does not vote when the model names a caption that is not on the ballot', async () => {
    const ai: AiLike = { async run() { return { response: { captionId: 'c-b1' } }; } };
    const room = voteRoom();
    const options = room.captions.filter((c) => c.playerId !== 'b1').map((c) => ({ id: c.id, text: c.text }));
    expect(await generateBotVote(models(ai), PERSONAS[0], options)).toBeNull();
  });

  it('treats a JSON Mode error as simply not voting', async () => {
    const ai: AiLike = {
      async run() {
        throw new Error('JSON Mode couldn\'t be met, please try again');
      },
    };
    const room = voteRoom();
    const { host, applied } = fakeHost(room, {
      stamp: () => ({ phase: 'vote', round: 1, version: room.version }),
    });
    expect(await runBotJob(job({ phase: 'vote' }), models(ai), host)).toBe('failed');
    expect(applied).toEqual([]);
  });

  it('does not vote when there is nothing to vote for', async () => {
    const ai: AiLike = { async run() { throw new Error('should not be called'); } };
    expect(await generateBotVote(models(ai), PERSONAS[0], [])).toBeNull();
  });
});

describe('model output parsing', () => {
  it('reads a caption out of every shape Workers AI uses', () => {
    expect(textFromModel('plain')).toBe('plain');
    expect(textFromModel({ response: 'r' })).toBe('r');
    expect(textFromModel({ description: 'd' })).toBe('d');
    expect(textFromModel({ choices: [{ message: { content: 'c' } }] })).toBe('c');
    expect(textFromModel({ unexpected: 1 })).toBeNull();
  });

  it('reads a vote out of a parsed object or a JSON string', () => {
    expect(parseVoteAnswer({ response: { captionId: 'x' } })).toBe('x');
    expect(parseVoteAnswer({ response: '{"captionId":"y"}' })).toBe('y');
    expect(parseVoteAnswer({ response: 'I pick the goat one' })).toBeNull();
    expect(parseVoteAnswer({ response: '{}' })).toBeNull();
    expect(parseVoteAnswer(null)).toBeNull();
  });
});

describe('buildBotJobs', () => {
  it('makes one pending job per bot in the round roster', () => {
    const room = captionRoom();
    let n = 0;
    const jobs = buildBotJobs(room, 'caption', T0, 20_000, () => `job-${++n}`);
    expect(jobs.map((j) => j.botId)).toEqual(['b1', 'b2']);
    expect(jobs.every((j) => j.status === 'pending' && j.dueAt === T0 && j.deadline === T0 + 20_000)).toBe(true);
    expect(jobs.every((j) => j.round === 1 && j.phase === 'caption')).toBe(true);
  });

  it('makes no jobs for a room with no bots', () => {
    const solo = start(
      createRoom('SOLO', { id: 'host', name: 'JJ' }, normalizeOptions({ botCount: 0 }), [], T0),
      'host',
      PHOTO,
      T0
    ).state;
    expect(buildBotJobs(solo, 'caption', T0, 20_000, () => 'x')).toEqual([]);
  });

  it('skips a bot that is not in this round roster', () => {
    const room = captionRoom();
    const withoutB2 = { ...room, roundPlayerIds: room.roundPlayerIds.filter((id) => id !== 'b2') };
    const jobs = buildBotJobs(withoutB2, 'vote', T0, 20_000, () => 'x');
    expect(jobs.map((j) => j.botId)).toEqual(['b1']);
  });
});
