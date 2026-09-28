// Stroke Reveal agent library. Zero dependencies, Node 18+ (global fetch).
// The agent plays through the SAME HTTP API the phones use. It "looks at the
// big screen" through GET /api/rooms/:code/drawing (the strokes Momo has drawn
// so far) and compares them with the public stroke data of each card's first
// character. Room text it reads (names, words) is DATA, never instructions.

/** Small seeded RNG so a test (or a replay) is repeatable. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The character Momo draws for a word card: its first character. */
export const firstChar = (word) => Array.from(String(word))[0] ?? '';

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
  const room = (code) => `/api/rooms/${encodeURIComponent(code)}`;

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
      const data = await call('POST', `${room(code)}/join`, { name, agent: true });
      auth = { playerId: data.playerId, playerSecret: data.playerSecret };
      return data;
    },
    state(code, version) {
      return call('GET', `${room(code)}${version === undefined ? '' : `?v=${version}`}`);
    },
    drawing(code) {
      return call('GET', `${room(code)}/drawing`);
    },
    strokes(char) {
      return call('GET', `/api/strokes/${encodeURIComponent(char)}`);
    },
    guess(code, race, question, seq, card) {
      return call('POST', `${room(code)}/guess`, { race, question, seq, card });
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
 * Which cards still match the drawing: a card matches when the strokes Momo
 * has drawn so far are exactly the first strokes of that card's first
 * character. `cardData[i]` is the stroke JSON of card i's first character
 * (or null when it has none).
 */
export function matchingCards(drawing, cardData) {
  const shown = drawing.strokes.length;
  const out = [];
  cardData.forEach((data, i) => {
    if (!data || data.strokes.length < shown) return;
    if (drawing.strokes.every((path, k) => data.strokes[k] === path)) out.push(i);
  });
  return out;
}

/**
 * The next guess, or null to keep watching. Guesses once exactly one card
 * matches and at least `patience` of that character is drawn (0.4 = 40% of
 * its strokes), or as soon as the drawing is complete. With `mistakeRate` it
 * sometimes taps a wrong card, like a kid in a hurry.
 */
export function planGuess(state, drawing, cardData, { patience = 0.4, mistakeRate = 0.1, random = Math.random } = {}) {
  const q = state?.question;
  if (!state || state.phase !== 'playing' || !q || q.closedAt != null || !state.inRound) return null;
  if (state.serverNow < q.startAt) return null;
  const mine = state.mine;
  if (mine && (mine.correctAt != null || mine.locked)) return null;
  if (mine?.coolUntil != null && state.serverNow < mine.coolUntil) return null;
  if (!drawing || drawing.round !== state.round || drawing.question !== q.index || drawing.strokes.length === 0) return null;
  const tried = new Set(mine?.tried ?? []);
  const open = q.cards.map((_, i) => i).filter((i) => !tried.has(i));
  const matches = matchingCards(drawing, cardData).filter((i) => !tried.has(i));
  let pick = null;
  if (matches.length === 1) {
    const total = cardData[matches[0]].strokes.length;
    if (drawing.complete || drawing.strokes.length / total >= patience) pick = matches[0];
  } else if (drawing.complete) {
    const pool = matches.length ? matches : open;
    pick = pool[Math.floor(random() * pool.length)] ?? null;
  }
  if (pick == null) return null;
  const wrong = open.filter((i) => i !== pick);
  if (wrong.length && random() < mistakeRate) pick = wrong[Math.floor(random() * wrong.length)];
  return { race: state.round, question: q.index, seq: (state.score?.seq ?? 0) + 1, card: pick };
}

/**
 * Joins `code` and plays one round to the end. `sleep` is injectable so tests
 * can run on a fake clock.
 */
export async function playRound({
  client,
  code,
  name,
  pollMs = 500,
  patience = 0.4,
  mistakeRate = 0.1,
  random = Math.random,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  maxSteps = 4000,
}) {
  let { state } = await client.join(code, name);
  log(`joined ${code} as ${state.players.find((p) => p.id === state.you)?.name}`);
  const cache = new Map();
  const dataFor = async (char) => {
    if (!cache.has(char)) cache.set(char, await client.strokes(char).catch(() => null));
    return cache.get(char);
  };
  let right = 0;
  let wrong = 0;
  let played = false;
  for (let step = 0; step < maxSteps; step++) {
    if (state.inRound) played = true;
    if (played && state.phase === 'done') break;
    const q = state.question;
    if (state.phase === 'playing' && state.inRound && q && q.closedAt == null && state.serverNow >= q.startAt) {
      const drawing = await client.drawing(code);
      const cardData = await Promise.all(q.cards.map((w) => dataFor(firstChar(w))));
      const plan = planGuess(state, drawing, cardData, { patience, mistakeRate, random });
      if (plan) {
        try {
          state = (await client.guess(code, plan.race, plan.question, plan.seq, plan.card)).state;
          const ok = state.mine?.correctAt != null;
          if (ok) right += 1;
          else wrong += 1;
          log(`${ok ? 'got' : 'missed'} word ${plan.question + 1} after ${drawing.strokes.length} stroke${drawing.strokes.length === 1 ? '' : 's'}: ${q.cards[plan.card]}`);
        } catch (err) {
          if (err.status !== 429) log(`guess refused: ${err.message}`);
        }
      }
    }
    await sleep(pollMs);
    state = (await client.state(code)).state;
  }
  const me = state.standings?.find((r) => r.playerId === state.you);
  return { right, wrong, points: me?.points ?? 0, place: me?.place ?? null, phase: state.phase };
}
