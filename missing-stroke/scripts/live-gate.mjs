#!/usr/bin/env node
// Live API gate against the deployed site. Prints a JSON receipt (every check,
// status, and the fields that prove it) for docs/evidence/. Makes no sound,
// needs no browser.
//
//   node scripts/live-gate.mjs [--url https://missing-stroke.averystudio.org]
//
// The race: a room, two agents over the HTTP API that DRAW (they send points;
// the room grades them): Ava draws the missing stroke along its median, Bo
// draws it backwards. Then NOBODY sends anything or polls: only the room's own
// alarm may close the character on the clock (grace after the first right
// stroke), run the reveal, and end the race.
import { createHash } from 'node:crypto';

const argUrl = process.argv.indexOf('--url');
const U = (argUrl > 0 ? process.argv[argUrl + 1] : 'https://missing-stroke.averystudio.org').replace(/\/+$/, '');
const receipt = {
  url: U,
  deployedVersion: process.env.MISSING_STROKE_VERSION ?? null,
  deployedCommit: process.env.MISSING_STROKE_COMMIT ?? null,
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
// "Reading the character", like any agent: the full character from the public proxy, minus the strokes on screen.
async function missingStroke(turn) {
  const full = (await req('GET', `/api/strokes/${encodeURIComponent(turn.char)}`)).json;
  const shown = new Set(turn.visible);
  const k = full.strokes.findIndex((d) => !shown.has(d));
  return { k, median: full.medians[k] };
}

// 1. Site and the closed stroke proxy
const home = await req('GET', '/');
note('home page', home.status === 200 && home.text.includes('Missing Stroke'), { status: home.status });
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

// 3. One character, two agents: one right, one wrong, the clock ends it.
const made = await req('POST', '/api/rooms', { text: '1. 山 shān\n2. 𠮷\n3. 一 yī', options: { level: 'big', charsPerRound: 1 } });
const code = made.json.code;
const teacher = seatOf(made.json);
receipt.room = code;
note('room made: no-data character noted, one-stroke character skipped', made.status === 200 && made.json.state.list.missing[0] === '𠮷' && made.json.state.list.skipped[0] === '一' && made.json.state.list.chars.join('') === '山', { status: made.status, code, list: made.json.state.list, options: made.json.state.options });
const ava = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Ava', agent: true })).json);
const bo = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Bo', agent: true })).json);
const started = await req('POST', `/api/rooms/${code}/start`, {}, teacher);
const s0 = started.json.state;
note('race started: the phones get 2 of 3 strokes and never the missing number', started.status === 200 && s0.turn.char === '山' && s0.turn.visible.length === 2 && !('hidden' in s0.turn) && !('hidden' in s0) && s0.turn.answer === null && !started.text.includes('"hidden"'), {
  status: started.status, round: s0.round, goAt: s0.goAt, turnKeys: Object.keys(s0.turn), visibleCount: s0.turn.visible.length, rules: s0.rules,
});
const miss = await missingStroke(s0.turn);
const RIGHT = miss.median;
const BACKWARDS = [...miss.median].reverse();
receipt.readTheCharacter = { missingStroke: miss.k };
const late = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Late Leo' })).json);
const bare = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, result: 'correct' }, ava);
note('a bare "correct" without a drawing is refused (400)', bare.status === 400, { status: bare.status, body: bare.json });
const early = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, points: RIGHT }, ava);
note('an answer before GO is refused', early.status === 409 && early.json?.error === 'wait for GO', { status: early.status, body: early.json });
await sleep(Math.max(0, s0.goAt - Date.now()) + 150);
const fast = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, points: RIGHT }, ava);
note('pace floor: a right stroke right after GO is refused (429)', fast.status === 429, { status: fast.status, body: fast.json, goAt: s0.goAt, minAnswerMs: s0.rules.minAnswerMs });
const lateTry = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, points: RIGHT }, late);
note('late joiner waits for the next race', lateTry.status === 409, { status: lateTry.status, body: lateTry.json });

const wrong = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, points: BACKWARDS }, bo);
const wrongAgain = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, points: BACKWARDS }, bo);
const boP = wrongAgain.json?.state?.progress?.[bo.playerId];
note('Bo: the missing stroke drawn BACKWARDS is graded wrong by the room; the retry counts once', wrong.status === 200 && wrong.json?.verdict === 'mistake' && wrongAgain.json?.duplicate === true && boP?.mistakes === 1 && boP?.rightAt === null, { first: [wrong.status, wrong.json?.verdict], retry: [wrongAgain.status, wrongAgain.json?.duplicate], bo: boP });

await sleep(Math.max(0, s0.goAt + s0.rules.minAnswerMs - Date.now()) + 300);
const right = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 1, turn: 0, points: RIGHT }, ava);
const t1 = right.json?.state?.turn;
note('Ava: the missing stroke drawn along its median is graded right and wins the character', right.status === 200 && right.json?.verdict === 'correct' && t1?.winners?.[0] === ava.playerId && t1?.closedAt === null && t1?.answer != null, {
  status: right.status, verdict: right.json?.verdict, winners: t1?.winners, ava: right.json?.state?.progress?.[ava.playerId],
});
const boView = await req('GET', `/api/rooms/${code}`, undefined, bo);
note('Bo still cannot see the answer while the character is open', boView.json?.state?.turn?.answer === null, { boAnswer: boView.json?.state?.turn?.answer ?? null });
const board1 = (right.json?.state?.standings ?? []).map((r) => r.name);
note('late joiner not on this race board', !board1.includes('Late Leo'), { board: board1 });

// Nobody sends or polls now. Close = first right + grace; the race ends after the reveal.
const closeAt = Math.min(t1.closesAt, t1.firstRightAt + s0.rules.graceAfterFirstRightMs);
const endAt = closeAt + s0.rules.revealMs;
await sleep(Math.max(0, endAt - Date.now()) + 3000);
const after = await req('GET', `/api/rooms/${code}`, undefined, teacher);
const st = after.json.state;
note('the room clock closed the character (grace after the first right) and ended the race by itself', st.phase === 'done' && st.turn.closedAt === closeAt && st.endedAt === endAt, {
  phase: st.phase, expectedCloseAt: closeAt, closedAt: st.turn.closedAt, expectedEndAt: endAt, endedAt: st.endedAt,
  results: st.results, answerShownAfterClose: st.turn.answer != null, standings: st.standings.map((r) => ({ name: r.name, wins: r.wins, rights: r.rights, mistakes: r.mistakes, place: r.place })),
});
const tooLate = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 2, turn: 0, points: RIGHT }, bo);
note('an answer after the race is refused', tooLate.status === 409, { status: tooLate.status, body: tooLate.json });

// Race 2: an answer from race 1 is refused; the late joiner is in.
const again = await req('POST', `/api/rooms/${code}/next`, {}, teacher);
const stale = await req('POST', `/api/rooms/${code}/stroke`, { race: s0.round, seq: 9, turn: 0, points: RIGHT }, ava);
note('an answer from an earlier race is refused', stale.status === 409 && stale.json?.error === 'that answer was for a different race', { status: stale.status, body: stale.json, race2: again.json?.state?.round });
note('late joiner plays the next race', Boolean(again.json?.state?.progress?.[late.playerId]), { lateProgress: again.json?.state?.progress?.[late.playerId] ?? null });

receipt.finishedAt = new Date().toISOString();
receipt.allPass = receipt.checks.every((c) => c.pass);
console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.allPass ? 0 : 1);
