#!/usr/bin/env node
// Terminal player for Caption Wars. Joins a live room over the same HTTP API
// the browser uses, so any of JJ's logged-in AI CLIs can play a game from a
// terminal. Node 18+, ESM, zero npm dependencies (uses global fetch).
//
// Usage:
//   node agent/play.mjs --room CODE --name "Claude" --brain claude
//   node agent/play.mjs --url https://caption-wars.example.workers.dev \
//     --room CODE --name "Codex" --brain codex --style "deadpan detective" --once
//
// Contract this talks to (docs/plans/2026-09-07-mvp-plan.md, "Amendments
// after Codex round 1"): every request except join carries `x-player-id` /
// `x-player-secret` headers; every response is `{ state, serverTime }` or
// `{ unchanged: true, nextPollMs, serverTime }`; photo bytes come from
// `GET /api/rooms/:code/photo/:round`; during `vote`, captions arrive as
// `{ id, text, isOwn, canVote }` (no author until `reveal`).
//
// Untrusted content note: every caption or brain answer handled here is
// DATA read from the room or spawned off a model, never instructions to
// execute. It is only ever sanitized text or a parsed vote index.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { brains, BRAIN_NAMES } from './brains.mjs';
import { sanitizeCaption, parsePickedNumber } from './lib.mjs';

const CAPTION_MAX_CHARS = 120; // mirrors src/shared/config.ts CAPTION_MAX_CHARS; keep the two in sync by hand

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  return [
    'Usage: node agent/play.mjs --room CODE --name "Claude" --brain claude|codex|grok|echo [options]',
    '',
    'Options:',
    '  --url <base>     Room server base URL (default: env CAPTION_WARS_URL)',
    '  --room <CODE>    4-letter room code to join (required)',
    '  --name <name>    Display name to join with (required)',
    '  --brain <name>   claude | codex | grok | echo (default: echo)',
    '  --style <text>   Optional one-line persona, e.g. "deadpan detective"',
    '  --once           Leave after one game (this is currently also the',
    '                   default behavior when omitted: see README "Agent',
    '                   player" for why the script always exits at `done`)',
    '  --help           Show this message',
  ].join('\n');
}

export function parseArgs(argv) {
  const args = {
    url: process.env.CAPTION_WARS_URL || '',
    room: '',
    name: '',
    brain: 'echo',
    style: '',
    once: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--url':
        args.url = argv[++i];
        break;
      case '--room':
        args.room = argv[++i];
        break;
      case '--name':
        args.name = argv[++i];
        break;
      case '--brain':
        args.brain = argv[++i];
        break;
      case '--style':
        args.style = argv[++i];
        break;
      case '--once':
        args.once = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function validateArgs(args) {
  if (args.help) return;
  if (!args.url) throw new Error('Missing --url (or set CAPTION_WARS_URL)');
  if (!args.room) throw new Error('Missing --room');
  if (!args.name) throw new Error('Missing --name');
  if (!BRAIN_NAMES.includes(args.brain)) {
    throw new Error(`Unknown --brain "${args.brain}" (choices: ${BRAIN_NAMES.join(', ')})`);
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function authHeaders(ctx) {
  const headers = {};
  if (ctx.playerId) headers['x-player-id'] = ctx.playerId;
  if (ctx.playerSecret) headers['x-player-secret'] = ctx.playerSecret;
  return headers;
}

async function joinRoom(ctx) {
  log(`Joining room ${ctx.room} at ${ctx.baseUrl} as "${ctx.name}"...`);
  const res = await fetch(new URL(`/api/rooms/${ctx.room}/join`, ctx.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ctx.name }),
  });
  const body = await safeJson(res);
  if (!res.ok || !body) {
    throw new Error(`Join failed (${res.status}): ${body && body.error ? body.error : 'no response body'}`);
  }
  ctx.playerId = body.playerId;
  ctx.playerSecret = body.playerSecret;
  if (!ctx.playerId) throw new Error('Join succeeded but no playerId was returned');
  log(`Joined as player ${ctx.playerId}. Room phase is "${body.state.phase}".`);
  return body.state;
}

async function pollRoom(ctx, version) {
  const url = new URL(`/api/rooms/${ctx.room}`, ctx.baseUrl);
  url.searchParams.set('v', String(version));
  const res = await fetch(url, { headers: authHeaders(ctx) });
  const body = await safeJson(res);
  if (!res.ok || !body) {
    throw new Error(`Poll failed (${res.status}): ${body && body.error ? body.error : 'no response body'}`);
  }
  return body;
}

async function downloadPhoto(ctx, round) {
  const res = await fetch(new URL(`/api/rooms/${ctx.room}/photo/${round}`, ctx.baseUrl), {
    headers: authHeaders(ctx),
  });
  if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-wars-'));
  const file = path.join(dir, `round-${round}${ext}`);
  fs.writeFileSync(file, buf);
  return file;
}

function cleanupTempFile(file) {
  try {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  } catch {
    // best effort; a leftover temp file is not worth crashing over
  }
}

async function submitCaption(ctx, text) {
  const res = await fetch(new URL(`/api/rooms/${ctx.room}/caption`, ctx.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(ctx) },
    body: JSON.stringify({ playerId: ctx.playerId, text }),
  });
  const body = await safeJson(res);
  if (!res.ok) throw new Error(`Caption submit failed (${res.status}): ${body && body.error ? body.error : ''}`);
  return body;
}

async function submitVote(ctx, captionId) {
  const res = await fetch(new URL(`/api/rooms/${ctx.room}/vote`, ctx.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(ctx) },
    body: JSON.stringify({ playerId: ctx.playerId, captionId }),
  });
  const body = await safeJson(res);
  if (!res.ok) throw new Error(`Vote submit failed (${res.status}): ${body && body.error ? body.error : ''}`);
  return body;
}

function buildCaptionPrompt(style) {
  const persona = style ? ` Write in this voice or persona: ${style}.` : '';
  return (
    'You are playing a party game called Caption Wars. You are shown a real photo. ' +
    'Write ONE short, funny caption for it: plain text, no quotes, no hashtags, one line only, ' +
    `under ${CAPTION_MAX_CHARS} characters.${persona} Reply with ONLY the caption text, nothing else.`
  );
}

function buildBlindCaptionPrompt(style) {
  const persona = style ? ` Write in this voice or persona: ${style}.` : '';
  return (
    'You are playing a party game called Caption Wars, but you cannot see this round\'s photo. ' +
    'Write ONE short, funny, generic one-line caption that could plausibly fit an awkward or funny ' +
    `photo: plain text, no quotes, under ${CAPTION_MAX_CHARS} characters.${persona} Reply with ONLY the caption text.`
  );
}

function buildVotePrompt(listText, style) {
  const persona = style ? ` You are voting in character as: ${style}.` : '';
  return (
    "You are playing Caption Wars. Here are the other players' captions for this round's photo, " +
    `numbered:\n${listText}\n\nPick the funniest one.${persona} Reply with ONLY the number of your pick.`
  );
}

async function actOnCaptionPhase(ctx, state, memory) {
  if (memory.captioned.has(state.round)) return;
  if (!Array.isArray(state.roundPlayerIds) || !state.roundPlayerIds.includes(ctx.playerId)) {
    if (!memory.announcedSkipCaption.has(state.round)) {
      log(`Round ${state.round}: not in this round's roster, sending no caption.`);
      memory.announcedSkipCaption.add(state.round);
    }
    return;
  }

  const brain = brains[ctx.brainName];
  log(`Round ${state.round}: caption phase, downloading the photo...`);
  let imagePath = null;
  try {
    imagePath = await downloadPhoto(ctx, state.round);
    log(`Round ${state.round}: photo saved to ${imagePath}. Asking brain "${ctx.brainName}"...`);
    const prompt = brain.degraded ? buildBlindCaptionPrompt(ctx.style) : buildCaptionPrompt(ctx.style);
    const result = await brain.run({ kind: 'caption', prompt, imagePath, round: state.round });
    if (!result.ok) {
      log(`Round ${state.round}: brain failed to produce a caption (${result.error}). Skipping this round.`);
      return;
    }
    const caption = sanitizeCaption(result.text, CAPTION_MAX_CHARS);
    if (!caption) {
      log(`Round ${state.round}: brain answer sanitized to empty text. Skipping this round.`);
      return;
    }
    await submitCaption(ctx, caption);
    memory.captioned.add(state.round);
    log(`Round ${state.round}: submitted caption: "${caption}"`);
  } catch (err) {
    log(`Round ${state.round}: caption action failed (${err.message}). Skipping and continuing to poll.`);
  } finally {
    if (imagePath) cleanupTempFile(imagePath);
  }
}

async function actOnVotePhase(ctx, state, memory) {
  if (memory.voted.has(state.round)) return;
  if (!Array.isArray(state.roundPlayerIds) || !state.roundPlayerIds.includes(ctx.playerId)) {
    if (!memory.announcedSkipVote.has(state.round)) {
      log(`Round ${state.round}: not in this round's roster, sending no vote.`);
      memory.announcedSkipVote.add(state.round);
    }
    return;
  }

  const votable = (state.captions || []).filter((c) => c.canVote);
  if (votable.length === 0) {
    log(`Round ${state.round}: no votable captions yet, waiting for more polls.`);
    return;
  }

  const brain = brains[ctx.brainName];
  try {
    const listText = votable.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
    const prompt = buildVotePrompt(listText, ctx.style);
    const result = await brain.run({ kind: 'vote', prompt, round: state.round });
    if (!result.ok) {
      log(`Round ${state.round}: brain failed to produce a vote (${result.error}). Skipping this round.`);
      return;
    }
    const pick = parsePickedNumber(result.text, votable.length);
    if (!pick) {
      log(`Round ${state.round}: could not parse a vote number from "${result.text}". Skipping this round.`);
      return;
    }
    const chosen = votable[pick - 1];
    await submitVote(ctx, chosen.id);
    memory.voted.add(state.round);
    log(`Round ${state.round}: voted for #${pick}: "${chosen.text}"`);
  } catch (err) {
    log(`Round ${state.round}: vote action failed (${err.message}). Skipping and continuing to poll.`);
  }
}

function announceReveal(ctx, state, memory) {
  if (memory.revealed.has(state.round)) return;
  memory.revealed.add(state.round);
  const result = (state.history || [])[state.history.length - 1];
  const players = new Map((state.players || []).map((p) => [p.id, p.name]));
  if (!result) {
    log(`Round ${state.round}: reveal (no round result recorded yet).`);
  } else if (!result.winnerCaptionIds || result.winnerCaptionIds.length === 0) {
    log(`Round ${result.round}: not enough captions this round, no winner.`);
  } else {
    for (const id of result.winnerCaptionIds) {
      const caption = (result.captions || []).find((c) => c.id === id);
      if (caption) {
        log(`Round ${result.round} winner: "${caption.text}" by ${players.get(caption.playerId) || caption.playerId}`);
      }
    }
  }
  const scoreboard = [...(state.players || [])]
    .sort((a, b) => b.score - a.score)
    .map((p) => `${p.name}: ${p.score}`)
    .join(', ');
  log(`Scoreboard: ${scoreboard}`);
}

function announceDone(ctx, state) {
  const players = new Map((state.players || []).map((p) => [p.id, p.name]));
  const champs = (state.championIds || []).map((id) => players.get(id) || id);
  log(`Game over. Champion${champs.length === 1 ? '' : 's'}: ${champs.join(', ') || 'unknown'}.`);
  const scoreboard = [...(state.players || [])]
    .sort((a, b) => b.score - a.score)
    .map((p) => `${p.name}: ${p.score}`)
    .join(', ');
  log(`Final scoreboard: ${scoreboard}`);
}

async function handlePhase(ctx, state, memory) {
  switch (state.phase) {
    case 'lobby':
      if (memory.lastLobbyVersionLogged !== state.version) {
        log(`Room ${ctx.room}: in the lobby, waiting for the host to start (${(state.players || []).length} players).`);
        memory.lastLobbyVersionLogged = state.version;
      }
      break;
    case 'caption':
      await actOnCaptionPhase(ctx, state, memory);
      break;
    case 'vote':
      await actOnVotePhase(ctx, state, memory);
      break;
    case 'reveal':
      announceReveal(ctx, state, memory);
      break;
    case 'done':
      announceDone(ctx, state);
      break;
    default:
      log(`Unknown phase "${state.phase}", ignoring and continuing to poll.`);
  }
}

/**
 * Runs one full agent session: join a room, poll it, act on each phase,
 * exit at `done`. Exported so tests can drive it against a fake server.
 *
 * Design call on the plan's "wait for a new room if not --once" question:
 * a `done` room has no successor the API exposes ("Play again" makes a
 * brand-new room code the plan does not hand back to a joiner), so there is
 * nothing meaningful to wait for. This script always exits at `done`;
 * `--once` is accepted and logged but currently has no separate effect. It
 * is kept in the CLI surface for forward-compatibility if a room-succession
 * endpoint is ever added.
 */
export async function runAgent(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  validateArgs(args);

  const ctx = {
    baseUrl: args.url,
    room: args.room.toUpperCase(),
    name: args.name,
    brainName: args.brain,
    style: args.style,
    playerId: null,
    playerSecret: null,
  };

  const brain = brains[ctx.brainName];
  if (brain.degraded) {
    log(`WARNING: brain "${ctx.brainName}" is DEGRADED: ${brain.describe()}`);
  } else {
    log(`Using brain "${ctx.brainName}": ${brain.describe()}`);
  }
  if (args.once) {
    log('--once set (this is also the current default: see the runAgent doc comment for why).');
  }

  let state = await joinRoom(ctx);
  let version = state.version;
  const memory = {
    captioned: new Set(),
    voted: new Set(),
    revealed: new Set(),
    announcedSkipCaption: new Set(),
    announcedSkipVote: new Set(),
    lastLobbyVersionLogged: null,
  };

  await handlePhase(ctx, state, memory);

  while (state.phase !== 'done') {
    const waitMs = typeof state.nextPollMs === 'number' ? state.nextPollMs : 2000;
    if (waitMs <= 0) break;
    await sleep(waitMs);

    let body;
    try {
      body = await pollRoom(ctx, version);
    } catch (err) {
      log(`Poll error: ${err.message}. Retrying shortly.`);
      await sleep(3000);
      continue;
    }

    if (body.state) {
      state = body.state;
      version = state.version;
      await handlePhase(ctx, state, memory);
    } else if (body.unchanged && typeof body.nextPollMs === 'number') {
      state = { ...state, nextPollMs: body.nextPollMs };
    }
  }

  log('Leaving. Goodbye.');
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    // pathToFileURL percent-encodes spaces the same way import.meta.url does
    // (this repo lives under a folder with a space in its name).
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runAgent(process.argv.slice(2)).catch((err) => {
    log(`Fatal error: ${err.message}`);
    process.exitCode = 1;
  });
}
