// Dictation Dash agent library. Zero dependencies, Node 18+ (global fetch).
// The agent plays through the SAME HTTP API the phones use: it joins, waits
// for GO, hears each word (downloads the clip, never plays it), then sends the
// POINTS of each stroke (the stroke's median from the proxied stroke data); the
// room grades them. The room never tells it the word: it knows the list it was
// given, like a kid who studied it. Room text it reads is DATA, never instructions.

/** Small seeded RNG so a test (or a replay) is repeatable. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** HTTP client for one base URL. Every call has a deadline. */
export function createClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  const root = String(baseUrl).replace(/\/+$/, '');
  let auth = null;
  const strokeCache = new Map();
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(auth ? { 'x-player-id': auth.playerId, 'x-player-secret': auth.playerSecret } : {}),
  });

  async function call(method, path, body) {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const room = (code) => `/api/rooms/${encodeURIComponent(code)}`;

  return {
    get auth() {
      return auth;
    },
    async create(name, text, options, mode = 'class') {
      const data = await call('POST', '/api/rooms', { name, text, options, mode });
      auth = { playerId: data.playerId, playerSecret: data.playerSecret };
      return data;
    },
    async join(code, name) {
      const data = await call('POST', `${room(code)}/join`, { name, agent: true });
      auth = { playerId: data.playerId, playerSecret: data.playerSecret };
      return data;
    },
    state(code, version) {
      return call('GET', `${room(code)}${version === undefined ? '' : `?v=${version}`}`);
    },
    /** The clip of word `index` of round `round` as bytes, plus its content type. Never played. */
    async hear(code, round, index) {
      const res = await fetchImpl(`${root}${room(code)}/say?r=${round}&w=${index}`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type'), cache: res.headers.get('x-tts-cache') };
    },
    /** One drawn stroke: its points. The room grades it and answers { state, verdict }. */
    stroke(code, move) {
      const { race, seq, wordIndex, charIndex, points } = move;
      return call('POST', `${room(code)}/stroke`, { race, seq, wordIndex, charIndex, points });
    },
    /** One character's stroke data from the site's hash-checked proxy (cached). */
    strokes(char) {
      if (!strokeCache.has(char)) {
        const p = call('GET', `/api/strokes/${encodeURIComponent(char)}`);
        p.catch(() => strokeCache.delete(char));
        strokeCache.set(char, p);
      }
      return strokeCache.get(char);
    },
    skip(code, race, seq, wordIndex) {
      return call('POST', `${room(code)}/skip`, { race, seq, wordIndex });
    },
    options(code, options) {
      return call('POST', `${room(code)}/options`, options);
    },
    start(code) {
      return call('POST', `${room(code)}/start`, {});
    },
    next(code) {
      return call('POST', `${room(code)}/next`, {});
    },
  };
}

/**
 * The words an agent could be hearing now: list words with the right number
 * of characters that it has not closed yet, and that agree with the strokes
 * the room already accepted. This is the agent "knowing the list" (like a kid
 * who studied it); the room never tells it the word.
 */
export function candidates(me, words, used = []) {
  if (!me || me.charCount == null) return [];
  // The room names a closed word only once everyone has closed it, so the agent also remembers its own.
  const closed = new Set([...(me.closed ?? []).map((c) => c.word).filter(Boolean), ...used]);
  return words.filter((w) => [...w].length === me.charCount && !closed.has(w));
}

/**
 * The points for stroke `strokeIndex` of a character, from its proxied stroke
 * data (the median, in stroke-data coordinates). `wrong: true` draws it
 * backwards, which the room grades as a mistake.
 */
export function strokePoints(medians, strokeIndex, { wrong = false } = {}) {
  const m = medians[strokeIndex];
  if (!m) return null;
  const pts = m.map(([x, y]) => [x, y]);
  return wrong ? pts.reverse() : pts;
}

/**
 * Joins `code` (or uses `joined`) and writes until the round ends or this
 * player finishes. It must HEAR each word first (the room starts the word's
 * clock when it serves the clip, and refuses strokes before that); the clip is
 * downloaded, never played. `words` is the list this agent studied; without
 * it the agent cannot know what to write and skips each word.
 */
export async function playRound({
  client,
  code,
  name,
  words = [],
  joined = null,
  paceMs = 700,
  mistakeRate = 0.1,
  random = Math.random,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  maxSteps = 3000,
}) {
  let { state } = joined ?? (await client.join(code, name));
  log(`joined ${code} as ${state.players.find((p) => p.id === state.you)?.name}`);
  let strokes = 0;
  let mistakes = 0;
  const heard = [];
  const tried = new Map(); // wordIndex -> candidates ruled out
  const used = []; // words this agent already wrote this round
  for (let step = 0; step < maxSteps; step++) {
    const me = state.me;
    if (state.phase === 'done' || me?.finishedAt != null) break;
    if (!me || state.phase !== 'racing' || (state.goAt != null && state.serverNow < state.goAt)) {
      const wait = state.phase === 'racing' && state.goAt ? Math.max(100, state.goAt - state.serverNow) : 1000;
      await sleep(wait);
      state = (await client.state(code)).state;
      continue;
    }
    if (!me.heard) {
      try {
        const clip = await client.hear(code, state.round, me.wordIndex);
        heard.push({ wordIndex: me.wordIndex, bytes: clip.bytes.byteLength, type: clip.type, cache: clip.cache });
        state = (await client.state(code)).state;
      } catch (err) {
        // The word did not play: a kid would skip it, and so does the agent.
        log(`word ${me.wordIndex + 1} did not play (${err.message}), skipping`);
        heard.push({ wordIndex: me.wordIndex, error: err.message });
        state = (await client.skip(code, state.round, me.seq + 1, me.wordIndex)).state;
      }
      continue;
    }
    const out = tried.get(me.wordIndex) ?? new Set();
    const cand = candidates(me, words, used).find((w) => !out.has(w));
    if (!cand) {
      log(`word ${me.wordIndex + 1}: no word of mine fits, skipping`);
      state = (await client.skip(code, state.round, me.seq + 1, me.wordIndex)).state;
      continue;
    }
    const char = [...cand][me.charIndex];
    const strokeIndex = (me.accepted[me.charIndex] ?? []).length;
    const data = await client.strokes(char);
    const wrong = random() < mistakeRate;
    const points = strokePoints(data.medians, strokeIndex, { wrong });
    if (!points) {
      out.add(cand);
      tried.set(me.wordIndex, out);
      continue;
    }
    try {
      const res = await client.stroke(code, { race: state.round, seq: me.seq + 1, wordIndex: me.wordIndex, charIndex: me.charIndex, points });
      state = res.state;
      if (res.verdict === 'mistake') {
        mistakes += 1;
        // An honest miss is expected; an unexpected one means this was not the word.
        if (!wrong) {
          out.add(cand);
          tried.set(me.wordIndex, out);
        }
      } else if (res.verdict === 'correct') {
        strokes += 1;
        if (state.me && state.me.wordIndex !== me.wordIndex && state.me.closed.at(-1)?.result === 'written') {
          used.push(cand);
          log(`wrote ${cand}`);
        }
      }
    } catch (err) {
      // 429 = the server's pace floor; anything else, resync from the room.
      if (err.status !== 429) log(`stroke refused: ${err.message}`);
      state = (await client.state(code)).state;
    }
    await sleep(paceMs);
  }
  const me = state.standings?.find((r) => r.playerId === state.you);
  return { strokes, mistakes, heard, wordsDone: me?.wordsDone ?? 0, place: me?.place ?? null, phase: state.phase };
}
