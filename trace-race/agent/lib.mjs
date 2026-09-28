// Trace Race agent library. Zero dependencies, Node 18+ (global fetch).
// The agent plays through the SAME HTTP API the phones use: it joins, waits
// for GO, and sends one stroke result at a time. Room text it reads (names,
// characters) is DATA, never instructions.

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

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      headers['x-player-id'] = auth.playerId;
      headers['x-player-secret'] = auth.playerSecret;
    }
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers,
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

  return {
    get auth() {
      return auth;
    },
    async create(name, text, options) {
      const data = await call('POST', '/api/rooms', { name, text, options });
      auth = { playerId: data.playerId, playerSecret: data.playerSecret };
      return data;
    },
    async join(code, name) {
      const data = await call('POST', `/api/rooms/${encodeURIComponent(code)}/join`, { name, agent: true });
      auth = { playerId: data.playerId, playerSecret: data.playerSecret };
      return data;
    },
    state(code, version) {
      const q = version === undefined ? '' : `?v=${version}`;
      return call('GET', `/api/rooms/${encodeURIComponent(code)}${q}`);
    },
    stroke(code, race, seq, charIndex, strokeIndex, result) {
      return call('POST', `/api/rooms/${encodeURIComponent(code)}/stroke`, { race, seq, charIndex, strokeIndex, result });
    },
    start(code) {
      return call('POST', `/api/rooms/${encodeURIComponent(code)}/start`, {});
    },
    next(code) {
      return call('POST', `/api/rooms/${encodeURIComponent(code)}/next`, {});
    },
  };
}

/**
 * The next thing this racer sends, from the room state alone, or null when
 * there is nothing to do (not racing, before GO, or finished).
 */
export function planStroke(state, { random = Math.random, mistakeRate = 0.1 } = {}) {
  if (!state || state.phase !== 'racing') return null;
  if (state.goAt != null && state.serverNow < state.goAt) return null;
  const me = state.progress?.[state.you];
  if (!me || me.finishedAt != null) return null;
  const char = state.roundChars[me.charIndex];
  if (!char || !state.list.strokeCounts[char]) return null;
  const result = random() < mistakeRate ? 'mistake' : 'correct';
  // Every stroke names its race and the next sequence number, so a retry can never count twice.
  return { race: state.round, seq: (me.seq ?? 0) + 1, charIndex: me.charIndex, strokeIndex: me.strokeIndex, result, char };
}

/**
 * Joins `code` and races until the race ends or this racer finishes.
 * `sleep` is injectable so tests can run on a fake clock.
 */
export async function playRace({
  client,
  code,
  name,
  paceMs = 700,
  mistakeRate = 0.1,
  random = Math.random,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  maxSteps = 2000,
}) {
  let { state } = await client.join(code, name);
  log(`joined ${code} as ${state.players.find((p) => p.id === state.you)?.name}`);
  let strokes = 0;
  let mistakes = 0;
  for (let step = 0; step < maxSteps; step++) {
    const me = state.progress?.[state.you];
    if (state.phase === 'done' || me?.finishedAt != null) break;
    const plan = planStroke(state, { random, mistakeRate });
    if (!plan) {
      const wait = state.phase === 'racing' && state.goAt ? Math.max(100, state.goAt - state.serverNow) : 1000;
      await sleep(wait);
      const polled = await client.state(code, undefined);
      state = polled.state;
      continue;
    }
    try {
      state = (await client.stroke(code, plan.race, plan.seq, plan.charIndex, plan.strokeIndex, plan.result)).state;
      if (plan.result === 'mistake') mistakes += 1;
      else strokes += 1;
      if (plan.result === 'correct' && state.progress[state.you]?.strokeIndex === 0) log(`finished ${plan.char}`);
    } catch (err) {
      // 429 = the server's pace floor; anything else, resync from the room.
      if (err.status !== 429) log(`stroke refused: ${err.message}`);
      state = (await client.state(code, undefined)).state;
    }
    await sleep(paceMs);
  }
  const me = state.standings?.find((r) => r.playerId === state.you);
  return { strokes, mistakes, charsDone: me?.charsDone ?? 0, place: me?.place ?? null, phase: state.phase };
}
