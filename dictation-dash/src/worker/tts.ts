// Chinese speech for one dictation word: Workers AI MeloTTS, cached.
//
// The pattern (not the code) of the Bilingual Vocab Game's src/worker/tts.ts:
//   - One Workers AI call per attempt, retried only when the failure is
//     transient (the call threw, or nothing came back). A malformed answer is
//     not retried: the same prompt gives the same junk.
//   - The bytes are sniffed and the Content-Type set from what came back
//     (MeloTTS has returned WAV while its docs say MP3).
//   - A cache first, keyed on the exact word, so a word the class hears 30
//     times costs one call. The cache is an optimisation, never a dependency:
//     a cache failure is a miss, not an error. The caller passes the room's
//     Durable Object storage as the cache (room-do.ts `clip`), because the
//     Cache API is a no-op on workers.dev (live-verified 2026-09-28: two
//     requests for the same word both came back MISS with different bytes).
//   - Only a real clip is ever cached.
// What is different here: there is no open ?text= route. The Worker only
// speaks a word of a round that is running in a real room, asked for by a
// player of that round (room-do.ts `say`), so a stranger cannot make us pay
// for arbitrary speech. EVERY model call (retries included) must pass the
// caller's beforeAttempt: a per-IP rate limit, a per-room daily budget and a
// global daily budget, all failing CLOSED (room-do.ts).

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
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  /** Asked before EVERY model call (each one is paid). False = stop now. */
  beforeAttempt: () => Promise<boolean> = async () => true
): Promise<{ bytes: Uint8Array | null; attempts: number; refused?: boolean }> {
  const max = Math.max(1, Math.floor(cfg.maxAttempts));
  for (let attempt = 0; attempt < max; attempt++) {
    if (!(await beforeAttempt())) return { bytes: null, attempts: attempt, refused: true };
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

export function audioResponse(bytes: Uint8Array, _cacheSeconds: number, cache: 'HIT' | 'MISS'): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': sniffAudioType(bytes),
      'Content-Length': String(bytes.byteLength),
      // Never cached by the browser: the same URL means a different word next
      // round (live bug 2026-09-28). The room's storage is the cache.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Tts-Cache': cache,
    },
  });
}

export interface SpeakDeps {
  ai: AiRunner | undefined;
  cache: Cache | null;
  /** Called before EVERY paid model call (a miss may retry). False = refuse: rate limit or budget. Must fail closed. */
  beforeAttempt: () => Promise<boolean>;
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
  const { bytes, refused, attempts } = await synthesize(deps.ai, cfg, text, deps.wait, deps.beforeAttempt);
  if (!bytes && refused && attempts === 0) return jsonError('speech is resting: too many new words right now, wait a minute and try again', 429);
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
