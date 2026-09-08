// The pluggable "brains" agent/play.mjs can spawn. Each brain is a function
// that takes { kind, prompt, imagePath, round } and returns text, run with
// child_process.spawnSync under a hard timeout so a hung model process can
// never hang the game. Never throws: failures come back as { ok: false, error }.
//
// Verified live 2026-09-07 against a real 800x600 goat photo (see
// docs/plans/2026-09-07-mvp-plan.md and README.md "Agent player" section for
// the exact commands and answers). Findings baked in here:
//   - claude -p and codex exec both print ONLY the clean final answer on
//     stdout; their reasoning/log noise goes to stderr. So brains read
//     stdout only.
//   - codex exec's positional PROMPT must come BEFORE `-i <file>` on the
//     command line, or the variadic -i flag swallows the prompt text as
//     another image argument.
//   - codex exec needs `--skip-git-repo-check` when it is not run from
//     inside a trusted git checkout (this script may be invoked from
//     anywhere), and `-m gpt-5.5` because the CLI's configured default model
//     errors on this CLI version (fact confirmed today, not re-derived here).
//   - grok has no image-attach flag as of `grok --help` today, so the grok
//     brain is DEGRADED: it captions and votes without ever seeing the photo.
//
// SECURITY: the vote prompt is built out of other players' caption text, which
// is untrusted input typed by strangers. So every brain runs with the smallest
// tool surface that still does its job (verified against the installed CLIs on
// 2026-09-07):
//   - vote  : NO tools at all. `claude --tools ""` empties the built-in set;
//             codex keeps `--sandbox read-only`; grok has no tools by nature.
//   - caption: file reading only, confined to the one temp directory holding
//             this round's photo (`--add-dir <dir> --tools "Read"`).
// `--restricted` also drops the command-running tools and WebFetch and makes
// the CLI ignore JJ's own user/project settings, so an allowlist she set for
// her own work cannot leak into a game.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_TIMEOUT_MS = 60000;

/** Model for the codex brain. Config, not a literal: the CLI default errors on this version. */
function codexModel() {
  const raw = (process.env.CODEX_MODEL ?? '').trim();
  return raw.length > 0 ? raw : 'gpt-5.5';
}

const binaryCache = new Map();

/**
 * Finds a CLI: PATH first, then a known install location, then the bare name so
 * spawn fails with a clear ENOENT. An env override (CLAUDE_BIN / CODEX_BIN /
 * GROK_BIN) wins over both, because which binary to run is deployment config.
 */
function resolveBinary(name, envVar, fallbacks = []) {
  const override = (process.env[envVar] ?? '').trim();
  if (override) return override;
  if (binaryCache.has(name)) return binaryCache.get(name);

  let resolved = name;
  const found = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' });
  const onPath = found.status === 0 ? (found.stdout ?? '').trim() : '';
  if (onPath) resolved = onPath;
  else {
    const existing = fallbacks.find((candidate) => candidate && existsSync(candidate));
    if (existing) resolved = existing;
  }
  binaryCache.set(name, resolved);
  return resolved;
}

function timeoutMs() {
  const raw = Number(process.env.BRAIN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** Runs one brain command. Never throws; returns { ok, text, error }. */
function runBrainCommand(command, args) {
  let result;
  try {
    result = spawnSync(command, args, {
      input: '', // always give an immediate EOF on stdin, equivalent to </dev/null
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs(),
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    });
  } catch (err) {
    return { ok: false, text: '', error: err.message };
  }
  if (result.error) {
    return { ok: false, text: '', error: result.error.message };
  }
  if (result.signal) {
    return { ok: false, text: '', error: `killed by signal ${result.signal} (likely timeout)` };
  }
  if (result.status !== 0) {
    const tail = (result.stderr || '').trim().slice(-400);
    return { ok: false, text: '', error: `exit code ${result.status}${tail ? `: ${tail}` : ''}` };
  }
  return { ok: true, text: result.stdout ?? '', error: null };
}

/** A model sometimes prefixes its answer with reasoning paragraphs; take the last non-empty one. */
function lastNonEmptyParagraph(text) {
  const paragraphs = String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length > 0) return paragraphs[paragraphs.length - 1];
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

export const brains = {
  echo: {
    degraded: false,
    describe: () => 'echo bot: no model, fixed placeholder text (for tests / dry runs)',
    async run({ kind, round }) {
      if (kind === 'vote') return { ok: true, text: '1', error: null };
      return { ok: true, text: `echo bot saw round ${round}`, error: null };
    },
  },

  claude: {
    degraded: false,
    describe: () =>
      'claude -p --restricted: sees the photo through a Read-only tool scoped to the photo folder; votes with every tool switched off',
    async run({ prompt, imagePath }) {
      const bin = resolveBinary('claude', 'CLAUDE_BIN', [`${os.homedir()}/.local/bin/claude`]);
      // The prompt goes FIRST, before any variadic flag: --tools and --add-dir
      // both swallow following arguments, so a trailing prompt would be read as
      // another tool name (the same trap codex's -i has).
      const fullPrompt = imagePath
        ? `Look at the image file at ${imagePath} using your file-reading tool. ${prompt}`
        : prompt;
      const args = ['-p', fullPrompt, '--restricted', '--strict-mcp-config'];
      if (imagePath) {
        // Caption: read the photo, nothing else, and only inside its own folder.
        args.push('--add-dir', path.dirname(imagePath), '--tools', 'Read');
      } else {
        // Vote: the prompt is built from other players' text. No tools at all.
        args.push('--tools', '');
      }
      const r = runBrainCommand(bin, args);
      if (!r.ok) return r;
      const text = lastNonEmptyParagraph(r.text) || r.text.trim();
      return { ok: true, text, error: null };
    },
  },

  codex: {
    degraded: false,
    describe: () =>
      `codex exec -m ${codexModel()} --sandbox read-only -i <image>: sees the photo (native image attach)`,
    async run({ prompt, imagePath }) {
      const codexBin = resolveBinary('codex', 'CODEX_BIN', [
        `${os.homedir()}/.npm-global/bin/codex`,
      ]);
      const args = [
        'exec',
        '-m',
        codexModel(),
        '-c',
        'mcp_servers={}',
        '-c',
        'memories.use_memories=false',
        '-c',
        'memories.generate_memories=false',
        '-c',
        'suppress_unstable_features_warning=true',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        prompt, // must come before -i, see file header
      ];
      if (imagePath) args.push('-i', imagePath);
      const r = runBrainCommand(codexBin, args);
      if (!r.ok) return r;
      const text = lastNonEmptyParagraph(r.text) || r.text.trim();
      return { ok: true, text, error: null };
    },
  },

  grok: {
    degraded: true,
    describe: () =>
      'grok -p: DEGRADED, no image-attach flag on this CLI (checked `grok --help` 2026-09-07), captions and votes BLIND (text only, never sees the photo). No tool surface to restrict.',
    async run({ prompt }) {
      const bin = resolveBinary('grok', 'GROK_BIN', [`${os.homedir()}/.grok/bin/grok`]);
      const r = runBrainCommand(bin, ['-p', prompt]);
      if (!r.ok) return r;
      const text = lastNonEmptyParagraph(r.text) || r.text.trim();
      return { ok: true, text, error: null };
    },
  },
};

export const BRAIN_NAMES = Object.keys(brains);
