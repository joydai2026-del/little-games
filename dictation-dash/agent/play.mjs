#!/usr/bin/env node
// Terminal player for Dictation Dash. Joins a live room over the same HTTP API
// the phones use, hears each word (downloads the clip, never plays it) and
// writes it stroke by stroke, sending real points (the stroke medians from the
// site's proxy) at a human-ish pace, with a few honest backwards strokes.
//
//   node agent/play.mjs --url https://dictation-dash.averystudio.org --room ABCD --name "Robo"
//   DICTATION_DASH_URL=... node agent/play.mjs --room ABCD --pace-ms 900 --mistakes 0.15
//
// Options (all config, no literals in the loop):
//   --url        base URL (or DICTATION_DASH_URL)             required
//   --room       4-letter room code                            required
//   --name       display name (default "Robo")
//   --pace-ms    wait between strokes (default 700)
//   --mistakes   chance a stroke attempt is a miss, 0..0.9 (default 0.1)
//   --words      the list this agent studied, e.g. "朋友 学校 大山" (it never sees the word;
//                without a list it cannot know what to write and skips)
//   --rounds     how many rounds to play in this room (default 1)
//   --seed       make the mistakes repeatable
import { createClient, playRound, seededRandom } from './lib.mjs';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const opts = args(process.argv.slice(2));
const url = opts.url || process.env.DICTATION_DASH_URL;
const room = String(opts.room || '').toUpperCase();
if (!url || !/^[A-Z0-9]{4}$/.test(room)) {
  console.error('usage: node agent/play.mjs --url <site> --room <CODE> [--name Robo] [--pace-ms 700] [--mistakes 0.1] [--words "朋友 学校"] [--rounds 1] [--seed 7]');
  process.exit(2);
}
const pace = Number(opts['pace-ms'] ?? 700);
const mistakes = Math.min(0.9, Math.max(0, Number(opts.mistakes ?? 0.1)));
const random = opts.seed ? seededRandom(Number(opts.seed)) : Math.random;

const rounds = Math.max(1, Math.min(20, Number(opts.rounds ?? 1) || 1));
const client = createClient({ baseUrl: url });
const common = {
  client,
  code: room,
  name: opts.name || 'Robo',
  paceMs: Number.isFinite(pace) && pace >= 0 ? pace : 700,
  mistakeRate: Number.isFinite(mistakes) ? mistakes : 0.1,
  words: String(opts.words ?? '').split(/[\s,，、]+/).filter(Boolean),
  random,
  log: (line) => console.log(line),
};
let result = await playRound(common);
console.log(JSON.stringify(result));
for (let r = 1; r < rounds; r++) {
  // Wait (polling, like a phone) for the teacher to start the next round.
  let state = (await client.state(room)).state;
  const played = state.round;
  const until = Date.now() + 10 * 60_000;
  while (!(state.round > played && state.phase === 'racing') && Date.now() < until) {
    await new Promise((res) => setTimeout(res, 1500));
    state = (await client.state(room)).state;
  }
  if (!(state.round > played)) break;
  result = await playRound({ ...common, joined: { state } });
  console.log(JSON.stringify(result));
}
