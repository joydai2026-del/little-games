// Missing Stroke agent library. Zero dependencies, Node 18+ (global fetch).
// The agent plays through the SAME HTTP API the phones use: it joins, waits
// for each character to open, and sends one answer (the missing stroke drawn
// right, or a miss) at a time. Room text it reads (names, characters) is
// DATA, never instructions.

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
    stroke(code, race, seq, turn, result) {
      return call('POST', `/api/rooms/${encodeURIComponent(code)}/stroke`, { race, seq, turn, result });
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
 * The next answer this racer sends, from the room state alone, or null when
 * there is nothing to do (not racing, before the character opens, character
 * closed, or already right). `thinkMs` = how long after the character opens
 * the agent waits before its first try (the room also has a pace floor).
 */
export function planStroke(state, { random = Math.random, mistakeRate = 0.1, thinkMs = 0 } = {}) {
  if (!state || state.phase !== 'racing' || !state.turn) return null;
  const turn = state.turn;
  if (turn.closedAt != null || state.serverNow < turn.opensAt + thinkMs) return null;
  const me = state.progress?.[state.you];
  if (!me || me.turn !== turn.index || me.rightAt != null) return null;
  const result = random() < mistakeRate ? 'mistake' : 'correct';
  // Every answer names its race and the next sequence number, so a retry can never count twice.
  return { race: state.round, seq: (me.seq ?? 0) + 1, turn: turn.index, result, char: turn.char, hidden: turn.hidden };
}

/** How long to wait before looking again, from the room state (ms, at least `minMs`). */
export function waitFor(state, { thinkMs = 0, minMs = 100, idleMs = 1000 } = {}) {
  if (!state || state.phase !== 'racing' || !state.turn) return idleMs;
  const t = state.turn;
  const at = t.closedAt == null ? t.opensAt + thinkMs : t.closedAt + (state.rules?.revealMs ?? 0);
  return Math.max(minMs, Math.min(idleMs, at - state.serverNow));
}

/**
 * Joins `code` and plays until the race ends. For every character it waits
 * `paceMs` after the character opens, then sends an answer; a miss is retried
 * `paceMs` later. `sleep` is injectable so tests can run on a fake clock.
 */
export async function playRace({
  client,
  code,
  name,
  paceMs = 1500,
  mistakeRate = 0.1,
  random = Math.random,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  maxSteps = 2000,
}) {
  let { state } = await client.join(code, name);
  log(`joined ${code} as ${state.players.find((p) => p.id === state.you)?.name}`);
  let rights = 0;
  let mistakes = 0;
  let sawRace = false;
  for (let step = 0; step < maxSteps; step++) {
    if (state.phase === 'racing') sawRace = true;
    if (state.phase === 'done' && sawRace) break;
    const plan = planStroke(state, { random, mistakeRate, thinkMs: paceMs });
    if (!plan) {
      await sleep(waitFor(state, { thinkMs: paceMs }));
      state = (await client.state(code, undefined)).state;
      continue;
    }
    try {
      state = (await client.stroke(code, plan.race, plan.seq, plan.turn, plan.result)).state;
      if (plan.result === 'mistake') {
        mistakes += 1;
        log(`missed stroke ${plan.hidden + 1} of ${plan.char}`);
        await sleep(paceMs);
        state = (await client.state(code, undefined)).state;
      } else {
        rights += 1;
        log(`drew stroke ${plan.hidden + 1} of ${plan.char}`);
      }
    } catch (err) {
      // 429 = the server's pace floor; anything else, resync from the room.
      if (err.status !== 429) log(`answer refused: ${err.message}`);
      await sleep(Math.min(paceMs, 500));
      state = (await client.state(code, undefined)).state;
    }
  }
  const me = state.standings?.find((r) => r.playerId === state.you);
  return { rights, mistakes, wins: me?.wins ?? 0, place: me?.place ?? null, phase: state.phase };
}
