// Chinese speech for one dictation word: Workers AI MeloTTS, cached.
//
// The pattern (not the code) of the Bilingual Vocab Game's src/worker/tts.ts:
//   - One Workers AI call per attempt, retried only when the failure is
//     transient (the call threw, or nothing came back). A malformed answer is
//     not retried: the same prompt gives the same junk.
//   - The bytes are sniffed and the Content-Type set from what came back
//     (MeloTTS has returned WAV while its docs say MP3).
//   - caches.default first, keyed on the model and the exact word, so a word
//     the class hears 30 times costs one call. The cache is an optimisation,
//     never a dependency: a cache failure is a miss, not an error.
//   - Only a real clip is ever cached.
// What is different here: there is no open ?text= route. The Worker only
// speaks a word of a round that is running in a real room, asked for by a
// player of that round (room-do.ts `say`), so a stranger cannot make us pay
// for arbitrary speech. Cache misses are also rate-limited per IP.

export interface AiRunner {
  run(model: string, options: Record<string, unknown>): Promise<unknown>;
}

export interface TtsConfig {
  model: string;
  lang: string;
  maxAttempts: number;
  retryDelaysMs: readonly number[];
  cacheSeconds: number;
  maxBytes: number;
}

type Attempt = { bytes: Uint8Array | null; reason: 'ok' | 'transient' | 'malformed' };

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reads the audio container from its magic bytes. Defaults to MP3. */
export function sniffAudioType(bytes: Uint8Array): string {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x41, 0x56, 0x45], 8)) return 'audio/wav';
  if (starts([0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (starts([0x66, 0x4c, 0x61, 0x43])) return 'audio/flac';
  return 'audio/mpeg';
}

async function toBytes(raw: unknown): Promise<Attempt> {
  const ok = (b: Uint8Array): Attempt => (b.byteLength > 0 ? { bytes: b, reason: 'ok' } : { bytes: null, reason: 'malformed' });
  if (raw instanceof Uint8Array) return ok(raw);
  if (raw instanceof ArrayBuffer) return ok(new Uint8Array(raw));
  if (raw instanceof ReadableStream) {
    try {
      return ok(new Uint8Array(await new Response(raw).arrayBuffer()));
    } catch {
      return { bytes: null, reason: 'transient' };
    }
  }
  const audio = raw && typeof raw === 'object' ? (raw as { audio?: unknown }).audio : undefined;
  if (typeof audio === 'string' && audio.length > 0) {
    try {
      return ok(base64ToBytes(audio));
    } catch {
      return { bytes: null, reason: 'malformed' };
    }
  }
  return { bytes: null, reason: 'malformed' };
}

async function runOnce(ai: AiRunner, cfg: TtsConfig, text: string): Promise<Attempt> {
  let raw: unknown;
  try {
    raw = await ai.run(cfg.model, { prompt: text, lang: cfg.lang });
  } catch (err) {
    console.error('tts: call threw', err instanceof Error ? err.message : err);
    return { bytes: null, reason: 'transient' };
  }
  if (raw === null || raw === undefined) return { bytes: null, reason: 'transient' };
  return toBytes(raw);
}

/** Runs the model with retries on transient failures. Returns the clip bytes and the paid calls made. */
export async function synthesize(
  ai: AiRunner,
  cfg: TtsConfig,
  text: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<{ bytes: Uint8Array | null; attempts: number }> {
  const max = Math.max(1, Math.floor(cfg.maxAttempts));
  for (let attempt = 0; attempt < max; attempt++) {
    const { bytes, reason } = await runOnce(ai, cfg, text);
    if (reason === 'ok' && bytes) {
      if (bytes.byteLength > cfg.maxBytes) return { bytes: null, attempts: attempt + 1 };
      return { bytes, attempts: attempt + 1 };
    }
    if (reason === 'malformed' || attempt + 1 >= max) return { bytes: null, attempts: attempt + 1 };
    await wait(cfg.retryDelaysMs[Math.min(attempt, cfg.retryDelaysMs.length - 1)] ?? 0);
  }
  return { bytes: null, attempts: max };
}

export function ttsCacheKey(requestUrl: string, model: string, text: string): Request {
  const url = new URL('/__tts/v1', requestUrl);
  url.searchParams.set('m', model);
  url.searchParams.set('t', text);
  return new Request(url.toString(), { method: 'GET' });
}

export function audioResponse(bytes: Uint8Array, cacheSeconds: number, cache: 'HIT' | 'MISS'): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': sniffAudioType(bytes),
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': `private, max-age=${cacheSeconds}`,
      'X-Content-Type-Options': 'nosniff',
      'X-Tts-Cache': cache,
    },
  });
}

export interface SpeakDeps {
  ai: AiRunner | undefined;
  cache: Cache | null;
  /** Called before a paid call (cache miss). Return false to refuse (rate limit). */
  allowMiss: () => Promise<boolean>;
  wait?: (ms: number) => Promise<void>;
}

/** The clip for one word: cache, else the model. Never throws. */
export async function speakWord(text: string, cfg: TtsConfig, requestUrl: string, deps: SpeakDeps): Promise<Response> {
  const jsonError = (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  const key = ttsCacheKey(requestUrl, cfg.model, text);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(key);
      if (hit) return audioResponse(new Uint8Array(await hit.arrayBuffer()), cfg.cacheSeconds, 'HIT');
    } catch (err) {
      console.error('tts: cache read failed', err instanceof Error ? err.message : err);
    }
  }
  if (!deps.ai) return jsonError('speech is not set up here', 503);
  if (!(await deps.allowMiss())) return jsonError('too many new words at once, wait a minute and try again', 429);
  const { bytes } = await synthesize(deps.ai, cfg, text, deps.wait);
  if (!bytes) return jsonError('speech is unavailable right now', 502);
  if (deps.cache) {
    try {
      await deps.cache.put(key, audioResponse(bytes, cfg.cacheSeconds, 'MISS'));
    } catch (err) {
      console.error('tts: cache write failed', err instanceof Error ? err.message : err);
    }
  }
  return audioResponse(bytes, cfg.cacheSeconds, 'MISS');
}
