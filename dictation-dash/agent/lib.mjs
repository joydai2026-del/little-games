// Dictation Dash agent library. Zero dependencies, Node 18+ (global fetch).
// The agent plays through the SAME HTTP API the phones use: it joins, waits
// for GO, "hears" each word (downloads the clip, never plays it), then sends
// one stroke result at a time. Room text it reads (names, words) is DATA,
// never instructions.

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
    /** The clip of word `index` as bytes, plus its content type. Never played. */
    async hear(code, index) {
      const res = await fetchImpl(`${root}${room(code)}/say?w=${index}`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type'), cache: res.headers.get('x-tts-cache') };
    },
    stroke(code, move) {
      const { race, seq, wordIndex, charIndex, strokeIndex, result } = move;
      return call('POST', `${room(code)}/stroke`, { race, seq, wordIndex, charIndex, strokeIndex, result });
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
 * The next stroke this player sends, from the room state alone, or null when
 * there is nothing to do (not racing, before GO, or finished).
 */
export function planStroke(state, { random = Math.random, mistakeRate = 0.1 } = {}) {
  if (!state || state.phase !== 'racing') return null;
  if (state.goAt != null && state.serverNow < state.goAt) return null;
  const me = state.progress?.[state.you];
  if (!me || me.finishedAt != null) return null;
  const word = [...(state.roundWords[me.wordIndex] ?? '')];
  const char = word[me.charIndex];
  if (!char || !state.list.strokeCounts[char]) return null;
  const result = random() < mistakeRate ? 'mistake' : 'correct';
  // Every send names its round and the next sequence number, so a retry can never count twice.
  return { race: state.round, seq: (me.seq ?? 0) + 1, wordIndex: me.wordIndex, charIndex: me.charIndex, strokeIndex: me.strokeIndex, result, word: word.join('') };
}

/**
 * Joins `code` (or uses `joined`) and writes until the round ends or this
 * player finishes. `sleep` is injectable so tests can run on a fake clock.
 * `listen: true` downloads each word's clip before writing it (a real kid
 * hears the word first); the byte counts are returned, nothing is played.
 */
export async function playRound({
  client,
  code,
  name,
  joined = null,
  paceMs = 700,
  mistakeRate = 0.1,
  listen = false,
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
  for (let step = 0; step < maxSteps; step++) {
    const me = state.progress?.[state.you];
    if (state.phase === 'done' || me?.finishedAt != null) break;
    const plan = planStroke(state, { random, mistakeRate });
    if (!plan) {
      const wait = state.phase === 'racing' && state.goAt ? Math.max(100, state.goAt - state.serverNow) : 1000;
      await sleep(wait);
      state = (await client.state(code)).state;
      continue;
    }
    if (listen && plan.charIndex === 0 && plan.strokeIndex === 0 && !heard.some((h) => h.wordIndex === plan.wordIndex)) {
      try {
        const clip = await client.hear(code, plan.wordIndex);
        heard.push({ wordIndex: plan.wordIndex, bytes: clip.bytes.byteLength, type: clip.type, cache: clip.cache });
      } catch (err) {
        // The word did not play: a kid would skip it, and so does the agent.
        log(`word ${plan.wordIndex + 1} did not play (${err.message}), skipping`);
        heard.push({ wordIndex: plan.wordIndex, error: err.message });
        state = (await client.skip(code, plan.race, plan.seq, plan.wordIndex)).state;
        continue;
      }
    }
    try {
      state = (await client.stroke(code, plan)).state;
      if (plan.result === 'mistake') mistakes += 1;
      else strokes += 1;
      const now = state.progress[state.you];
      if (plan.result === 'correct' && now && (now.wordIndex !== plan.wordIndex || now.finishedAt != null)) log(`wrote ${plan.word}`);
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
