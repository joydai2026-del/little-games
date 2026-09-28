#!/usr/bin/env node
// Live API gate against the deployed site. Prints a JSON receipt (every
// check, status, and the fields that prove it) for docs/evidence/. Makes no
// sound, needs no browser.
//
//   node scripts/live-gate.mjs [--url https://stroke-reveal.joyd-ai-2026.workers.dev]
//
// Story: a teacher makes a room, two AI agents join through the API, one
// watches the drawing and guesses early, the other waits; nobody polls and the
// word closes on the clock (the room's alarm). Then round 2 checks the lock
// rule, a stale-round guess, and a late joiner.
import { createHash } from 'node:crypto';
import { firstChar, matchingCards, planGuess } from '../agent/lib.mjs';

const argUrl = process.argv.indexOf('--url');
const U = (argUrl > 0 ? process.argv[argUrl + 1] : 'https://stroke-reveal.joyd-ai-2026.workers.dev').replace(/\/+$/, '');
const receipt = {
  url: U,
  deployedVersion: process.env.STROKE_REVEAL_VERSION ?? null,
  deployedCommit: process.env.STROKE_REVEAL_COMMIT ?? null,
  startedAt: new Date().toISOString(),
  checks: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (name, pass, detail) => receipt.checks.push({ name, pass: Boolean(pass), at: new Date().toISOString(), ...detail });

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

// 1. Site, closed stroke proxy, licence
const home = await req('GET', '/');
note('home page', home.status === 200 && home.text.includes('Stroke Reveal'), { status: home.status });
const wo = await fetch(`${U}/api/strokes/%E6%88%91`);
const woHash = createHash('sha256').update(Buffer.from(await wo.arrayBuffer())).digest('hex');
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
note('malformed room code is 400', (await req('GET', '/api/rooms/%E0')).status === 400, {});
const big = await req('POST', '/api/rooms', undefined, null, JSON.stringify({ text: '人'.repeat(40000) }));
note('oversized body is 413 with a plain message', big.status === 413, { status: big.status, body: big.json });
const long = await req('POST', '/api/rooms', { text: 'a'.repeat(4001) });
note('over-long paste is 400 with a plain message', long.status === 400, { status: long.status, body: long.json });

// 3. Round 1: one agent guesses early, the other waits, the word closes on the clock
const made = await req('POST', '/api/rooms', {
  text: '第一课\n1. 大人 dàrén grown-up\n2. 山 shān\n3. 学校 xuéxiào\n4. 人 rén\n5. 𠮷野 (no data)',
  options: { charsPerRound: 1, level: 'g35' },
});
const code = made.json.code;
const teacher = seatOf(made.json);
receipt.room = code;
note('room made from a messy paste: heading skipped and reported, missing word noted', made.status === 200 && made.json.state.list.missing[0] === '𠮷野' && made.json.state.list.skipped[0] === '第一课', {
  status: made.status, code, list: made.json.state.list,
});
const early = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Robo Quick', agent: true })).json);
const slow = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Robo Slow', agent: true })).json);
const started = await req('POST', `/api/rooms/${code}/start`, {}, teacher);
const tq = started.json.state.question;
note('round started, teacher sees the drawn character', started.status === 200 && tq.char === '大', { status: started.status, round: started.json.state.round, question: tq });
const late = seatOf((await req('POST', `/api/rooms/${code}/join`, { name: 'Late Leo' })).json);
const kidView = await req('GET', `/api/rooms/${code}`, undefined, early);
const kq = kidView.json.state.question;
note('kids never see the character or the right card while the word is open', kq.char === null && kq.answer === null && !kidView.text.includes('"questions"'), { question: kq });
const tooSoon = await req('POST', `/api/rooms/${code}/guess`, { race: 1, question: 0, seq: 1, card: 0 }, early);
note('guess before Momo starts drawing is refused', tooSoon.status === 409, { status: tooSoon.status, body: tooSoon.json });

await sleep(Math.max(0, kq.startAt - Date.now()) + 300);
const drawing = await req('GET', `/api/rooms/${code}/drawing`, undefined, early);
note('/drawing shows only the strokes on the big screen, never the character', drawing.status === 200 && drawing.json.shown >= 1 && drawing.json.strokes.length === drawing.json.shown && !drawing.text.includes('"char"'), {
  status: drawing.status, shown: drawing.json.shown, complete: drawing.json.complete,
});
const cardData = await Promise.all(kq.cards.map(async (w) => (await req('GET', `/api/strokes/${encodeURIComponent(firstChar(w))}`)).json));
const now1 = (await req('GET', `/api/rooms/${code}`, undefined, early)).json.state;
const plan = planGuess(now1, drawing.json, cardData, { patience: 0, mistakeRate: 0 });
note('the agent sees exactly one card that matches the drawing', plan && matchingCards(drawing.json, cardData).length === 1, { plan, matches: matchingCards(drawing.json, cardData), cards: kq.cards });
const g1 = await req('POST', `/api/rooms/${code}/guess`, plan, early);
const g1again = await req('POST', `/api/rooms/${code}/guess`, plan, early);
note('a right guess before the drawing is complete scores above the minimum (100); the same guess again changes nothing', g1.status === 200 && g1.json.state.score.points > 100 && g1again.json.state.version === g1.json.state.version && g1again.json.state.score.points === g1.json.state.score.points, {
  points: g1.json?.state?.score?.points, guessedMsAfterStart: g1.json?.state?.mine?.correctAt - kq.startAt, drawMs: 3 * 900, version: g1.json?.state?.version, retryVersion: g1again.json?.state?.version, mine: g1.json?.state?.mine,
});
const lateGuess = await req('POST', `/api/rooms/${code}/guess`, { race: 1, question: 0, seq: 1, card: 0 }, late);
note('late joiner waits for the next round', lateGuess.status === 409, { status: lateGuess.status, body: lateGuess.json });

// Nobody polls until 3 s after the word's end: only the alarm can close it.
const endsAt = kq.endsAt;
await sleep(Math.max(0, endsAt - Date.now()) + 3000);
const afterEnd = await req('GET', `/api/rooms/${code}`, undefined, slow);
const aq = afterEnd.json.state.question;
note('the word closed on the clock (alarm), and kids now see the answer', aq.closedAt === endsAt && aq.answer != null && aq.cards[aq.answer] === '大人', {
  endsAt, closedAt: aq.closedAt, answer: aq.answer, word: aq.cards[aq.answer], phase: afterEnd.json.state.phase,
});
await sleep(Math.max(0, aq.nextAt - Date.now()) + 2500);
const end1 = await req('GET', `/api/rooms/${code}`, undefined, teacher);
const st1 = end1.json.state;
note('round ended after the answer showed; early guesser first, waiting agent second with 0', st1.phase === 'done' && st1.endedAt === aq.nextAt && st1.standings[0].name === 'Robo Quick' && st1.standings[1].points === 0, {
  phase: st1.phase, endedAt: st1.endedAt, nextAt: aq.nextAt, standings: st1.standings,
});

// 4. Round 2: stale round refused, lock rule, late joiner plays
const r2 = await req('POST', `/api/rooms/${code}/next`, {}, teacher);
const q2 = r2.json.state.question;
note('late joiner plays round 2', Object.keys(r2.json.state.standings.reduce((m, r) => ((m[r.name] = 1), m), {})).includes('Late Leo'), { standings: r2.json.state.standings.map((r) => r.name), word: q2.char });
await sleep(Math.max(0, q2.startAt - Date.now()) + 300);
const stale = await req('POST', `/api/rooms/${code}/guess`, { race: 1, question: 0, seq: 5, card: 0 }, slow);
note('a guess for round 1 is refused in round 2', stale.status === 409 && stale.json?.error === 'that guess was for a different round', { status: stale.status, body: stale.json });
const wrongCard = (q2.answer + 1) % q2.cards.length;
const w1 = await req('POST', `/api/rooms/${code}/guess`, { race: 2, question: 0, seq: 1, card: wrongCard }, slow);
const w2 = await req('POST', `/api/rooms/${code}/guess`, { race: 2, question: 0, seq: 2, card: q2.answer }, slow);
note('Grades 3-5: a wrong guess locks you out of that word', w1.status === 200 && w1.json.state.mine.locked === true && w2.status === 409, {
  wrong: [w1.status, w1.json?.state?.mine], retryRight: [w2.status, w2.json?.error],
});

receipt.finishedAt = new Date().toISOString();
receipt.allPass = receipt.checks.every((c) => c.pass);
console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.allPass ? 0 : 1);
