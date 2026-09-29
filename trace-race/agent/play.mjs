#!/usr/bin/env node
// Terminal racer for Trace Race. Joins a live room over the same HTTP API the
// phones use and traces at a human-ish pace, with a few honest mistakes.
//
//   node agent/play.mjs --url https://trace-race.averystudio.org --room ABCD --name "Robo"
//   TRACE_RACE_URL=... node agent/play.mjs --room ABCD --pace-ms 900 --mistakes 0.15
//
// Options (all config, no literals in the loop):
//   --url        base URL (or TRACE_RACE_URL)                 required
//   --room       4-letter room code                            required
//   --name       display name (default "Robo")
//   --pace-ms    wait between strokes (default 700)
//   --mistakes   chance a stroke attempt is a miss, 0..0.9 (default 0.1)
//   --seed       make the mistakes repeatable
import { createClient, playRace, seededRandom } from './lib.mjs';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const opts = args(process.argv.slice(2));
const url = opts.url || process.env.TRACE_RACE_URL;
const room = String(opts.room || '').toUpperCase();
if (!url || !/^[A-Z0-9]{4}$/.test(room)) {
  console.error('usage: node agent/play.mjs --url <site> --room <CODE> [--name Robo] [--pace-ms 700] [--mistakes 0.1] [--seed 7]');
  process.exit(2);
}
const pace = Number(opts['pace-ms'] ?? 700);
const mistakes = Math.min(0.9, Math.max(0, Number(opts.mistakes ?? 0.1)));
const random = opts.seed ? seededRandom(Number(opts.seed)) : Math.random;

const client = createClient({ baseUrl: url });
const result = await playRace({
  client,
  code: room,
  name: opts.name || 'Robo',
  paceMs: Number.isFinite(pace) && pace >= 0 ? pace : 700,
  mistakeRate: Number.isFinite(mistakes) ? mistakes : 0.1,
  random,
  log: (line) => console.log(line),
});
console.log(JSON.stringify(result));
