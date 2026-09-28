#!/usr/bin/env node
// Terminal player for Stroke Reveal. Joins a live room over the same HTTP API
// the phones use, watches Momo draw (GET /drawing), and taps the word card
// that matches, after a human-ish wait, with a few honest mistakes.
//
//   node agent/play.mjs --url https://stroke-reveal.joyd-ai-2026.workers.dev --room ABCD --name "Robo"
//   STROKE_REVEAL_URL=... node agent/play.mjs --room ABCD --patience 0.6 --mistakes 0.2
//
// Options (all config, no literals in the loop):
//   --url        base URL (or STROKE_REVEAL_URL)                     required
//   --room       4-letter room code                                  required
//   --name       display name (default "Robo")
//   --patience   share of the strokes to see before guessing, 0..1 (default 0.4)
//   --mistakes   chance a guess is a wrong card, 0..0.9 (default 0.1)
//   --poll-ms    wait between looks at the screen (default 500)
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
const url = opts.url || process.env.STROKE_REVEAL_URL;
const room = String(opts.room || '').toUpperCase();
if (!url || !/^[A-Z0-9]{4}$/.test(room)) {
  console.error('usage: node agent/play.mjs --url <site> --room <CODE> [--name Robo] [--patience 0.4] [--mistakes 0.1] [--poll-ms 500] [--seed 7]');
  process.exit(2);
}
const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const random = opts.seed ? seededRandom(Number(opts.seed)) : Math.random;

const result = await playRound({
  client: createClient({ baseUrl: url }),
  code: room,
  name: opts.name || 'Robo',
  patience: clamp(Number(opts.patience ?? 0.4), 0, 1, 0.4),
  mistakeRate: clamp(Number(opts.mistakes ?? 0.1), 0, 0.9, 0.1),
  pollMs: clamp(Number(opts['poll-ms'] ?? 500), 100, 10000, 500),
  random,
  log: (line) => console.log(line),
});
console.log(JSON.stringify(result));
