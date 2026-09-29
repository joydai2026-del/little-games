#!/usr/bin/env node
// Live API gate against the deployed site. Prints a JSON receipt (every
// request, status, and the fields that prove each claim) for
// docs/evidence/. Makes no sound, needs no browser.
//
//   node scripts/live-gate.mjs [--url https://trace-race.averystudio.org]
import { createHash } from 'node:crypto';

const argUrl = process.argv.indexOf('--url');
const U = (argUrl > 0 ? process.argv[argUrl + 1] : 'https://trace-race.averystudio.org').replace(/\/+$/, '');
const receipt = {
  url: U,
  deployedVersion: process.env.TRACE_RACE_VERSION ?? null,
  deployedCommit: process.env.TRACE_RACE_COMMIT ?? null,
  startedAt: new Date().toISOString(),
  checks: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (name, pass, detail) => receipt.checks.push({ name, pass, at: new Date().toISOString(), ...detail });

async function req(method, path, body, seat, rawBody) {
  const headers = { 'content-type': 'application/json' };
  if (seat) Object.assign(headers, { 'x-player-id': seat.playerId, 'x-player-secret': seat.playerSecret });
  const res = await fetch(U + path, { method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json, text };
}
const seatOf = (d) => ({ playerId: d.playerId, playerSecret: d.playerSecret });

// 1. Site and closed stroke proxy
const home = await req('GET', '/');
note('home page', home.status === 200, { status: home.status });
const wo = await fetch(`${U}/api/strokes/%E6%88%91`);
const woBytes = Buffer.from(await wo.arrayBuffer());
const woHash = createHash('sha256').update(woBytes).digest('hex');
note('stroke proxy returns manifest bytes for 我', wo.status === 200 && woHash === '08616462fc64b4c18c76a3f68a992305e98946f468bf42ec76ca9be1cd6c5ac8', {
  status: wo.status, sha256: woHash, contentType: wo.headers.get('content-type'), nosniff: wo.headers.get('x-content-type-options'), cacheControl: wo.headers.get('cache-control'),
});
for (const bad of ['..%2Fx', '%E6%88%91%E4%BB%AC', '%F0%A0%AE%B7']) {
  const r = await req('GET', `/api/strokes/${bad}`);
  note(`stroke proxy rejects ${bad}`, r.status === 400, { status: r.status, body: r.json });
}
const lic = await req('GET', '/licenses/ARPHICPL.TXT');
note('licence served', lic.status === 200 && lic.text.startsWith('ARPHIC PUBLIC LICENSE'), { status: lic.status, firstLine: lic.text.split('\n')[0] });

// 2. Input hardening
const e0 = await req('GET', '/api/rooms/%E0');
note('malformed room code is 400', e0.status === 400, { status: e0.status, body: e0.json });
const big = await req('POST', '/api/rooms', undefined, null, JSON.stringify({ text: '人'.repeat(40000) }));
note('oversized body is 413 with a plain message', big.status === 413, { status: big.status, body: big.json });
const long = await req('POST', '/api/rooms', { text: 'a'.repeat(4001) });
note('over-long paste is 400 with a plain message', long.status === 400, { status: long.status, body: long.json });

// 3. A race that ends on the clock, with idempotency, pace floor, frozen roster and race id
const made = await req('POST', '/api/rooms', { text: '1. 山 shān\n2. 水 shuǐ\n3. 𠮷', options: { secondsPerChar: 10, charsPerRound: 2 } });
const code = made.json.code;
const teacher = seatOf(made.json);
receipt.clockRoom = code;
note('room made, missing character noted', made.status === 200 && made.json.state.list.missing[0] === '𠮷', { status: made.status, code, list: made.json.state.list });
const kid = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Mia' })).json);
const started = await req('POST', `/api/rooms/${code}/start`, {}, teacher);
const { goAt, endsAt, round } = started.json.state;
note('race started', started.status === 200, { status: started.status, round, goAt, endsAt, expiresAt: started.json.state.expiresAt });
const late = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Late Leo' })).json);
await sleep(Math.max(0, goAt - Date.now()) + 400);
const lateStroke = await req('POST', `/api/rooms/${code}/stroke`, { race: round, seq: 1, charIndex: 0, strokeIndex: 0, result: 'correct' }, late);
note('late joiner waits for the next race', lateStroke.status === 409, { status: lateStroke.status, body: lateStroke.json });
const s1 = await req('POST', `/api/rooms/${code}/stroke`, { race: round, seq: 1, charIndex: 0, strokeIndex: 0, result: 'correct' }, kid);
const s1again = await req('POST', `/api/rooms/${code}/stroke`, { race: round, seq: 1, charIndex: 0, strokeIndex: 0, result: 'correct' }, kid);
note('retried stroke is a no-op', s1.status === 200 && s1again.status === 200 && s1again.json.state.version === s1.json.state.version, {
  first: s1.json.state.progress[kid.playerId], retryVersion: s1again.json.state.version, firstVersion: s1.json.state.version,
});
const cur = (s1again.json.state.progress[kid.playerId]);
const m1 = await req('POST', `/api/rooms/${code}/stroke`, { race: round, seq: cur.seq + 1, charIndex: cur.charIndex, strokeIndex: cur.strokeIndex, result: 'mistake' }, kid);
const m1again = await req('POST', `/api/rooms/${code}/stroke`, { race: round, seq: cur.seq + 1, charIndex: cur.charIndex, strokeIndex: cur.strokeIndex, result: 'mistake' }, kid);
const mistakes = m1again.json?.state?.progress?.[kid.playerId]?.mistakes;
note('retried mistake counts once', m1.status === 200 && mistakes === 1, { first: [m1.status, m1.json?.error], retry: [m1again.status, m1again.json?.error], mistakes });
const board1 = (m1again.json?.state?.standings ?? []).map((r) => r.name);
note('late joiner not on this race board', !board1.includes('Late Leo'), { board: board1 });

// Nobody polls until 3 s after the race end: only the alarm can end it.
await sleep(Math.max(0, endsAt - Date.now()) + 3000);
const after = await req('GET', `/api/rooms/${code}`, undefined, teacher);
const st = after.json.state;
note('race ended on the clock by the alarm', st.phase === 'done' && st.endedAt - endsAt < 2000, {
  phase: st.phase, endsAt, endedAt: st.endedAt, endedMinusEndsMs: st.endedAt - endsAt, expiresAt: st.expiresAt, expiresAfterEndMs: st.expiresAt - st.endedAt,
});

// Race 2: a stroke from race 1 is refused.
const again = await req('POST', `/api/rooms/${code}/next`, {}, teacher);
const stale = await req('POST', `/api/rooms/${code}/stroke`, { race: round, seq: 9, charIndex: 0, strokeIndex: 0, result: 'correct' }, kid);
note('stroke from an earlier race is refused', stale.status === 409 && stale.json?.error === 'that stroke was for a different race', { status: stale.status, body: stale.json, race2: again.json.state.round, race2Chars: again.json.state.roundChars });
const lateNow = again.json.state.progress[late.playerId];

// Pace floor probe: hammer the first stroke of race 2 from just before GO. The
// first request past GO should land inside GO + minStrokeMs and get a 429.
// Network timing decides where it lands, so this records what happened.
const round2 = again.json.state.round;
const goAt2 = again.json.state.goAt;
const probe = [];
for (const stopAt = Date.now() + 8000; Date.now() < stopAt; ) {
  const r = await req('POST', `/api/rooms/${code}/stroke`, { race: round2, seq: 1, charIndex: 0, strokeIndex: 0, result: 'correct' }, late);
  probe.push({ status: r.status, error: r.json?.error ?? null, serverTime: r.json?.serverTime ?? null });
  if (r.json?.error !== 'wait for GO') break;
}
const firstPastGo = probe.at(-1);
note('pace floor probe (first stroke right after GO)', firstPastGo.status === 429, { goAt: goAt2, attempts: probe.length, firstPastGo });

// Two-stroke boundary: keep sending stroke 1, then stroke 2, as fast as the
// network allows. The server's own clock (serverTime on every answer) must show
// stroke 1 refused before GO+250 and accepted at or after it, and stroke 2
// refused before GO+500 and accepted at or after it. The exact 499/500 ms edge
// is pinned by tests/race.test.ts; live, the network decides how close we land.
const MIN = 250;
async function hammer(seq, strokeIndex) {
  const tries = [];
  for (const stopAt = Date.now() + 8000; Date.now() < stopAt; ) {
    const r = await req('POST', `/api/rooms/${code}/stroke`, { race: round2, seq, charIndex: 0, strokeIndex, result: 'correct' }, late);
    tries.push({ status: r.status, serverTime: r.json?.serverTime ?? null, error: r.json?.error ?? null });
    if (r.status === 200) break;
  }
  const refused = tries.filter((t) => t.status === 429);
  return { attempts: tries.length, lastRefused: refused.at(-1) ?? null, accepted: tries.find((t) => t.status === 200) ?? null };
}
const p1 = await hammer(probe.length + 1, 0);
const p2 = await hammer(probe.length + 2 + p1.attempts, 1);
const edgeOk = (p, n) =>
  p.accepted && p.accepted.serverTime >= goAt2 + n * MIN && (!p.lastRefused || p.lastRefused.serverTime < goAt2 + n * MIN);
note('pace floor boundary: stroke 1 at GO+250, stroke 2 at GO+500 (server clock)', edgeOk(p1, 1) && edgeOk(p2, 2) && Boolean(p2.lastRefused), {
  goAt: goAt2,
  stroke1: { ...p1, lastRefusedAtMs: p1.lastRefused && p1.lastRefused.serverTime - goAt2, acceptedAtMs: p1.accepted && p1.accepted.serverTime - goAt2 },
  stroke2: { ...p2, lastRefusedAtMs: p2.lastRefused && p2.lastRefused.serverTime - goAt2, acceptedAtMs: p2.accepted && p2.accepted.serverTime - goAt2 },
});
note('late joiner races the next one', Boolean(lateNow), { lateProgress: lateNow });

receipt.finishedAt = new Date().toISOString();
receipt.allPass = receipt.checks.every((c) => c.pass);
console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.allPass ? 0 : 1);
