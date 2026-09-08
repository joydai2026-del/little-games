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

import { spawnSync } from 'node:child_process';
import os from 'node:os';

const DEFAULT_TIMEOUT_MS = 60000;

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
    describe: () => 'claude -p: sees the photo (told the file path, reads it with its own file tool)',
    async run({ prompt, imagePath }) {
      const fullPrompt = imagePath
        ? `Look at the image file at ${imagePath} using your file-reading tool. ${prompt}`
        : prompt;
      const r = runBrainCommand('claude', ['-p', fullPrompt]);
      if (!r.ok) return r;
      const text = lastNonEmptyParagraph(r.text) || r.text.trim();
      return { ok: true, text, error: null };
    },
  },

  codex: {
    degraded: false,
    describe: () => 'codex exec -m gpt-5.5 -i <image>: sees the photo (native image attach)',
    async run({ prompt, imagePath }) {
      const codexBin = `${os.homedir()}/.npm-global/bin/codex`;
      const args = [
        'exec',
        '-m',
        'gpt-5.5',
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
      'grok -p: DEGRADED, no image-attach flag on this CLI (checked `grok --help` 2026-09-07), captions and votes BLIND (text only, never sees the photo)',
    async run({ prompt }) {
      const r = runBrainCommand('grok', ['-p', prompt]);
      if (!r.ok) return r;
      const text = lastNonEmptyParagraph(r.text) || r.text.trim();
      return { ok: true, text, error: null };
    },
  },
};

export const BRAIN_NAMES = Object.keys(brains);
