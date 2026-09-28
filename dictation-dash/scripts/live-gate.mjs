#!/usr/bin/env node
// Live API gate against the deployed site. Prints a JSON receipt (every
// check, status, and the fields that prove it) for docs/evidence/. Makes no
// sound: word clips are saved to docs/evidence/_audio/ (git-ignored), never
// played. Needs no browser.
//
//   node scripts/live-gate.mjs [--url https://dictation-dash.joyd-ai-2026.workers.dev]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient, playRound, seededRandom } from '../agent/lib.mjs';

const argUrl = process.argv.indexOf('--url');
const U = (argUrl > 0 ? process.argv[argUrl + 1] : 'https://dictation-dash.joyd-ai-2026.workers.dev').replace(/\/+$/, '');
const AUDIO_DIR = new URL('../docs/evidence/_audio/', import.meta.url);
const receipt = { url: U, deployedVersion: process.env.DD_VERSION ?? null, deployedCommit: process.env.DD_COMMIT ?? null, startedAt: new Date().toISOString(), checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (name, pass, detail = {}) => receipt.checks.push({ name, pass: Boolean(pass), at: new Date().toISOString(), ...detail });
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function req(method, path, body, seat, rawBody) {
  const headers = { 'content-type': 'application/json' };
  if (seat) Object.assign(headers, { 'x-player-id': seat.playerId, 'x-player-secret': seat.playerSecret });
  const res = await fetch(U + path, { method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: res.status, headers: res.headers, json, buf };
}
const seatOf = (d) => ({ playerId: d.playerId, playerSecret: d.playerSecret });

async function hearAndSave(code, seat, w, label) {
  const r = await req('GET', `/api/rooms/${code}/say?w=${w}`, undefined, seat);
  const type = r.headers.get('content-type') ?? '';
  const magic = r.buf.subarray(0, 4).toString('latin1');
  let file = null;
  if (r.status === 200) {
    mkdirSync(AUDIO_DIR, { recursive: true });
    const ext = type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'mp3';
    file = `docs/evidence/_audio/${label}.${ext}`;
    writeFileSync(new URL(`${label}.${ext}`, AUDIO_DIR), r.buf);
  }
  return { status: r.status, type, bytes: r.buf.byteLength, sha256: r.status === 200 ? sha(r.buf) : null, magic, cache: r.headers.get('x-tts-cache'), file, error: r.status === 200 ? null : r.json?.error };
}

// 1. Site, the closed stroke proxy, the licence
const home = await req('GET', '/');
note('home page', home.status === 200 && home.buf.toString().includes('Dictation Dash · Avery Studio'), { status: home.status });
const wo = await req('GET', '/api/strokes/%E6%88%91');
note('stroke proxy returns manifest bytes for 我', wo.status === 200 && sha(wo.buf) === '08616462fc64b4c18c76a3f68a992305e98946f468bf42ec76ca9be1cd6c5ac8', {
  status: wo.status, sha256: sha(wo.buf), contentType: wo.headers.get('content-type'), nosniff: wo.headers.get('x-content-type-options'),
});
for (const bad of ['..%2Fx', '%E6%88%91%E4%BB%AC', '%F0%A0%AE%B7']) {
  const r = await req('GET', `/api/strokes/${bad}`);
  note(`stroke proxy rejects ${bad}`, r.status === 400, { status: r.status });
}
const lic = await req('GET', '/licenses/ARPHICPL.TXT');
note('licence served', lic.status === 200 && lic.buf.toString().startsWith('ARPHIC PUBLIC LICENSE'), { status: lic.status });

// 2. Input hardening
note('malformed room code is 400', (await req('GET', '/api/rooms/%E0')).status === 400);
const big = await req('POST', '/api/rooms', undefined, null, JSON.stringify({ text: '人'.repeat(40000) }));
note('oversized body is 413 with a plain message', big.status === 413, { status: big.status, body: big.json });

// 3. A class room from a messy paste: two AI agents, an Easy round, then a Hard round.
const paste = '第三课 听写\n1. 朋友 péngyou friend\n2. 学校 xuéxiào school\n3. 𠮷祥 (no data)\n4. 中华人民共和国 (too long)\n5. 朋友 again\n6. 大山';
const made = await req('POST', '/api/rooms', { text: paste, options: { wordsPerRound: 2, secondsPerWord: 60, level: 'easy' } });
const code = made.json.code;
const teacher = seatOf(made.json);
receipt.room = code;
const list = made.json.state.list;
note('messy paste: words kept, the rest reported', made.status === 200 && list.words.join(',') === '第三课,听写,朋友,学校,大山' && list.missing[0] === '𠮷祥' && list.tooLong[0] === '中华人民共和国' && list.repeats === 1, { list });
// The teacher's list: use the three real vocabulary words only.
const setL = await req('POST', `/api/rooms/${code}/list`, { text: '1. 朋友 péngyou\n2. 学校 xuéxiào\n3. 大山 dàshān' }, teacher);
note('teacher replaces the list', setL.json?.state?.list?.words?.join(',') === '朋友,学校,大山', { words: setL.json?.state?.list?.words });

const clients = [createClient({ baseUrl: U }), createClient({ baseUrl: U })];
const joins = [];
for (const [i, c] of clients.entries()) joins.push(await c.join(code, ['Robo', 'Bolt'][i]));
note('two agents joined', joins.every((j) => j.state.players.find((p) => p.id === j.state.you)?.agent === true), { names: joins.map((j) => j.state.players.find((p) => p.id === j.state.you).name) });
const noRound = await req('GET', `/api/rooms/${code}/say?w=0`, undefined, seatOf(joins[0]));
note('no speech before a round starts', noRound.status === 403, { status: noRound.status, body: noRound.json });

async function runRound(action, level, players, duringRound = async () => {}) {
  const started = await req('POST', `/api/rooms/${code}/${action}`, {}, teacher);
  const st = started.json.state;
  note(`${level} round started`, started.status === 200 && st.options.level === level, { round: st.round, level: st.options.level, words: st.roundWords, roster: Object.keys(st.progress).length, goAt: st.goAt, endsAt: st.endsAt });
  await sleep(Math.max(0, st.goAt - Date.now()) + 300);
  const clip1 = await hearAndSave(code, seatOf(players[0].joined), 0, `round${st.round}-word0-first`);
  const clip2 = await hearAndSave(code, seatOf(players[1].joined), 0, `round${st.round}-word0-again`);
  note(`${level}: word 1 speech returns audio bytes (saved, never played)`, clip1.status === 200 && clip1.bytes > 1000 && /audio\//.test(clip1.type), clip1);
  note(`${level}: the next listener gets the SAME clip from room storage (no second model call)`, clip2.status === 200 && clip2.sha256 === clip1.sha256 && clip2.cache === 'HIT', { cache: clip2.cache, sha256: clip2.sha256 });
  const ahead = await req('GET', `/api/rooms/${code}/say?w=1`, undefined, seatOf(players[0].joined));
  note(`${level}: nobody can listen ahead`, ahead.status === 409, { status: ahead.status, body: ahead.json });
  const tSay = await req('GET', `/api/rooms/${code}/say?w=0`, undefined, teacher);
  note(`${level}: the teacher's board never speaks`, tSay.status === 403, { status: tSay.status });
  await duringRound(st);
  const results = await Promise.all(
    players.map((p, i) =>
      playRound({ client: p.client, code, name: '', joined: { state: p.joined.state }, paceMs: 350 + i * 150, mistakeRate: 0.15, listen: true, random: seededRandom(11 + i) })
    )
  );
  const end = (await req('GET', `/api/rooms/${code}`, undefined, teacher)).json.state;
  note(`${level} round played to the end by every agent in it`, end.phase === 'done' && end.standings.length === players.length && end.standings.every((r) => r.finished), {
    standings: end.standings,
    agentResults: results.map((r) => ({ strokes: r.strokes, mistakes: r.mistakes, wordsDone: r.wordsDone, place: r.place, heard: r.heard })),
  });
  return end;
}

const players = clients.map((client, i) => ({ client, joined: joins[i] }));
const lateClient = createClient({ baseUrl: U });
let lateJoin = null;
const easy = await runRound('start', 'easy', players, async (st) => {
  // A kid who joins mid-round waits for the next one: no word, no strokes.
  lateJoin = await lateClient.join(code, 'Late Leo');
  const s = await req('GET', `/api/rooms/${code}/say?w=0`, undefined, seatOf(lateJoin));
  const k = await req('POST', `/api/rooms/${code}/stroke`, { race: st.round, seq: 1, wordIndex: 0, charIndex: 0, strokeIndex: 0, result: 'correct' }, seatOf(lateJoin));
  note('late joiner waits: no speech, no strokes, not on this board', s.status === 403 && k.status === 409 && !lateJoin.state.standings.some((r) => r.name === 'Late Leo'), { say: s.status, stroke: [k.status, k.json?.error] });
});
const hardSet = await req('POST', `/api/rooms/${code}/options`, { level: 'hard' }, teacher);
note('teacher switches to Hard between rounds', hardSet.json?.state?.options?.level === 'hard', { options: hardSet.json?.state?.options });
const hard = await runRound('next', 'hard', [...players, { client: lateClient, joined: lateJoin }]);
note('Hard round used the next words', hard.roundWords.join(',') !== easy.roundWords.join(','), { easy: easy.roundWords, hard: hard.roundWords });
note('the late joiner wrote the Hard round', Boolean(hard.progress[lateJoin.state.you]?.finishedAt), { late: hard.progress[lateJoin.state.you] });

// 4. A round that ends on the clock (nobody writes, nobody polls): the alarm ends it.
const clockRoom = await req('POST', '/api/rooms', { text: '大', options: { secondsPerWord: 15 } });
const cTeacher = seatOf(clockRoom.json);
const cKid = createClient({ baseUrl: U });
await cKid.join(clockRoom.json.code, 'Sleepy');
const cStart = (await req('POST', `/api/rooms/${clockRoom.json.code}/start`, {}, cTeacher)).json.state;
await sleep(Math.max(0, cStart.endsAt - Date.now()) + 3000);
const cEnd = (await req('GET', `/api/rooms/${clockRoom.json.code}`, undefined, cTeacher)).json.state;
note('round ended on the clock by the alarm', cEnd.phase === 'done' && cEnd.endedAt - cStart.endsAt < 2000, { endsAt: cStart.endsAt, endedAt: cEnd.endedAt, endedMinusEndsMs: cEnd.endedAt - cStart.endsAt });

// 5. Solo practice: the host is the writer and hears the words; nobody else can join.
const solo = await req('POST', '/api/rooms', { text: '朋友', mode: 'solo', options: { level: 'hard' } });
const soloSeat = seatOf(solo.json);
const soloJoin = await req('POST', `/api/rooms/${solo.json.code}/join`, { name: 'Intruder' });
const soloStart = (await req('POST', `/api/rooms/${solo.json.code}/start`, {}, soloSeat)).json.state;
await sleep(Math.max(0, soloStart.goAt - Date.now()) + 200);
const soloClip = await hearAndSave(solo.json.code, soloSeat, 0, 'solo-word0');
note('solo practice: host writes, hears the word, joins refused', soloStart.phase === 'racing' && soloClip.status === 200 && soloJoin.status === 409, { soloClip, joinStatus: soloJoin.status });

receipt.finishedAt = new Date().toISOString();
receipt.allPass = receipt.checks.every((c) => c.pass);
console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.allPass ? 0 : 1);
